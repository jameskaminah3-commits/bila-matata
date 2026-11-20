// src/platform/routes.ts
//
// The platform's own console (platform admins only):
//
//   GET   /v1/platform/businesses      every business on the platform
//   PATCH /v1/platform/businesses/:id  { status: active | paused }: the platform team pauses or resumes one
//   GET   /v1/platform/overview        every business's day: model use against its budget, chats,
//                                      waiting handoffs, failed turns, WhatsApp; and what the platform has switched on
//   POST  /v1/platform/businesses      { id, name, allowed_origins, business_type?, time_zone?, daily_token_cap?,
//                                        retention_days?, owner: { email, name, password? } }
//                                      → the business, its settings and its first owner (a new owner without
//                                        a password is emailed a link to choose one). Never an admin's own
//                                        account; an account that already has a business only with
//                                        owner.add_to_existing (so each business gets its own dashboard)
//   GET   /v1/platform/businesses/:id/owner   its owners
//   POST  /v1/platform/businesses/:id/owner   { email, name?, password? } hand it to its owner: they become
//                                      its owner and the studio's admins stop being its members
//
// Plans, subscriptions and invoices: billing/routes.ts.
//
// A new business starts with a daily model budget and a retention period, so
// none runs with unlimited spend or keeps conversations forever by accident.

import { RESERVED_SUBDOMAINS } from "../frontdoor/subdomains.ts";
import { randomBytes } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { anyBusinessById, clearBusinessCache, everyBusiness } from "../businesses/registry.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { businessDay } from "../gateway/spend-cap.ts";
import { createBusinessWithOwner, findStaffByEmail, handOverBusiness, membershipsOf, ownersOf, setBusinessStatus } from "../db/platform-scope.ts";
import { businessTiers, businessTypes, workingType, type BusinessTier, type BusinessType } from "../db/schema.ts";
import { BillingError, choosePlan, planById, setBusinessTier, setPlatformPayments } from "../billing/store.ts";
import { createStudioInvoice } from "../studio/invoices.ts";
import { invoiceEmail, invoiceLink } from "../studio/pay.ts";
import { staffOf } from "../staff/auth.ts";
import { TYPES_WITH_OWN_CONNECTOR } from "../engine/tool-sets.ts";
import { normalizeOrigin } from "../gateway/origin.ts";
import { sendEmail } from "./mailer.ts";
import { requirePlatformAdmin, requireStaff } from "../staff/auth.ts";
import { addedEmail, canEmailLinks, inviteEmail, passwordLink, passwordLinkToken, unknownPassword } from "../staff/password-links.ts";
import { hashPassword, passwordProblem } from "../staff/passwords.ts";

export const DEFAULT_DAILY_TOKEN_CAP = 5_000_000;
const ADMIN_AS_OWNER = "That's a Bila Matata admin's account. Use the business owner's own email: admins already reach every business from Bila Matata → Businesses.";
export const DEFAULT_RETENTION_DAYS = 90;

/** A positive whole number from the request, the default when absent, or null when invalid. */
function positiveWhole(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}

export function registerPlatformRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);

  app.get("/v1/platform/businesses", staff, requirePlatformAdmin, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const businesses = await everyBusiness();
      res.json({
        businesses: businesses.map((business) => ({
          id: business.id,
          name: business.name,
          status: business.status,
          business_type: business.businessType,
          tier: business.tier,
          platform_payments: business.platformPayments,
          public_key: business.publicKey,
          allowed_origins: business.allowedOrigins,
          time_zone: business.timeZone,
          created_at: business.createdAt,
          went_live_at: business.wentLiveAt,
          source: business.source,
          pause_reason: business.pauseReason,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // Pausing a business stops its chats (website and WhatsApp) until it's resumed; its team keeps the console.
  app.patch("/v1/platform/businesses/:businessId", staff, requirePlatformAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await anyBusinessById(String(req.params.businessId));
      if (!business) return res.status(404).json({ error: "not_found" });
      // Paid through the platform's account (a subaccount): only for a business that needs it. Customers otherwise pay the business's own account.
      if (req.body?.platform_payments !== undefined) {
        if (typeof req.body.platform_payments !== "boolean") return res.status(400).json({ error: "invalid_platform_payments", message: "platform_payments is true or false." });
        await setPlatformPayments(business.id, req.body.platform_payments);
        if (req.body?.status === undefined && req.body?.plan_id === undefined && req.body?.tier === undefined) return res.json({ id: business.id, status: business.status, platform_payments: req.body.platform_payments });
      }
      // What the business gets: a plan (its tier comes with it, and its invoices go out by themselves), or the tier alone.
      const planId = req.body?.plan_id;
      const tier = req.body?.tier;
      if (planId !== undefined || tier !== undefined) {
        if (planId !== undefined) {
          if (typeof planId !== "string" || !(await planById(planId))) return res.status(404).json({ error: "plan_not_found", message: "That plan doesn't exist." });
          try {
            await choosePlan(business.id, planId, new Date(), { byTeam: true });
          } catch (error) {
            if (error instanceof BillingError && error.code !== "same_plan") return res.status(error.status).json({ error: error.code, message: error.message });
            if (!(error instanceof BillingError)) throw error;
          }
        } else {
          if (!businessTiers.includes(tier as BusinessTier)) return res.status(400).json({ error: "invalid_tier", message: "tier is starter or full." });
          await setBusinessTier(business.id, tier as BusinessTier);
        }
        if (req.body?.status === undefined) {
          const updated = await anyBusinessById(business.id);
          return res.json({ id: business.id, status: business.status, tier: updated?.tier ?? business.tier });
        }
      }
      const status = req.body?.status;
      if (status !== "active" && status !== "paused") return res.status(400).json({ error: "invalid_status", message: "status is active or paused." });
      if (status === "active" && business.status === "onboarding") {
        return res.status(409).json({ error: "setting_up", message: "The business puts itself live when its setup is done." });
      }
      // Paused for an unpaid invoice: it resumes itself when the invoice is paid (or marked paid, or waived, in Billing).
      if (status === "active" && business.status === "paused" && business.pauseReason === "billing") {
        return res.status(409).json({ error: "unpaid_invoice", message: "This business is paused for an unpaid invoice: mark it paid or waive it in Billing, and it resumes." });
      }
      // A business paused before it ever went live goes back to setting up.
      const next = status === "active" && !business.wentLiveAt ? "onboarding" : status;
      await setBusinessStatus(business.id, next, "platform");
      clearBusinessCache();
      res.json({ id: business.id, status: next });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/platform/overview", staff, requirePlatformAdmin, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const businesses = await everyBusiness();
      const rows = await Promise.all(businesses.map((business) => runForBusiness(business.id, () => inBusiness(async (_db, client) => {
        const { rows: [row] } = await client.query<{
          tokens_today: string | null; chats_7d: number; waiting: number; turns_24h: number; failed_24h: number;
          last_activity: Date | null; whatsapp: boolean; live_since: Date | null; bookings_30d: number;
          deposits_30d: Array<{ currency: string; amount: number }>; last_booking: Date | null;
        }>(
          `select
             (select input_tokens + output_tokens from usage_daily where business_id = $1 and day = $2) as tokens_today,
             (select count(*)::int from chat_sessions as s where s.business_id = $1 and s.created_at > now() - interval '7 days'
                and exists (select 1 from chat_events as e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER')) as chats_7d,
             (select count(*)::int from chat_sessions where business_id = $1 and managed_by = 'HUMAN' and assigned_agent_id is null) as waiting,
             (select count(*)::int from turn_metrics where business_id = $1 and started_at > now() - interval '24 hours') as turns_24h,
             (select count(*)::int from turn_metrics where business_id = $1 and started_at > now() - interval '24 hours'
                and outcome in ('timeout', 'model_error', 'error')) as failed_24h,
             (select max(last_activity_at) from chat_sessions where business_id = $1) as last_activity,
             exists (select 1 from whatsapp_numbers where business_id = $1 and status = 'active') as whatsapp,
             (select min(s.created_at) from chat_sessions as s where s.business_id = $1
                and exists (select 1 from chat_events as e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER')) as live_since,
             (select count(*)::int from bookings where business_id = $1 and status = 'confirmed' and created_at > now() - interval '30 days') as bookings_30d,
             (select coalesce(json_agg(json_build_object('currency', currency, 'amount', total) order by currency), '[]'::json)
                from (select currency, sum(amount_minor) / 100.0 as total from payments
                      where business_id = $1 and status = 'succeeded' and settled_at > now() - interval '30 days' group by currency) as paid) as deposits_30d,
             (select max(created_at) from bookings where business_id = $1 and status = 'confirmed') as last_booking`,
          [business.id, businessDay(business.timeZone)],
        );
        return {
          id: business.id,
          name: business.name,
          business_type: business.businessType,
          working_type: workingType(business),
          tier: business.tier,
          platform_payments: business.platformPayments,
          status: business.status,
          tokens_today: Number(row.tokens_today ?? 0),
          daily_token_cap: business.dailyTokenCap,
          chats_7d: row.chats_7d,
          waiting: row.waiting,
          turns_24h: row.turns_24h,
          failed_24h: row.failed_24h,
          last_activity_at: row.last_activity,
          whatsapp: row.whatsapp,
          // Phase 4's exit check, for a place to stay: live 30 days, with bookings and deposits in the last 30.
          stays: business.businessType === "guesthouse" ? {
            live_since: row.live_since,
            live_days: row.live_since ? Math.floor((Date.now() - row.live_since.getTime()) / 86_400_000) : 0,
            bookings_30d: row.bookings_30d,
            deposits_30d: row.deposits_30d.map((entry) => ({ currency: entry.currency, amount: Number(entry.amount) })),
            last_booking_at: row.last_booking,
            pilot_ready: Boolean(row.live_since && Date.now() - row.live_since.getTime() >= 30 * 86_400_000
              && row.bookings_30d > 0 && row.deposits_30d.some((entry) => Number(entry.amount) > 0)),
          } : null,
        };
      }, business.id))));
      res.json({
        businesses: rows,
        platform: {
          whatsapp: Boolean(config.whatsapp),
          web_push: Boolean(config.webPush),
          alert_email: Boolean(config.alertEmail),
          public_base_url: config.publicBaseUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/platform/businesses", staff, requirePlatformAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const timeZone = typeof req.body?.time_zone === "string" ? req.body.time_zone : "Africa/Nairobi";
      const origins = Array.isArray(req.body?.allowed_origins) ? req.body.allowed_origins.map((origin: unknown) => normalizeOrigin(String(origin))) : [];
      const owner = req.body?.owner ?? {};
      const dailyTokenCap = positiveWhole(req.body?.daily_token_cap, DEFAULT_DAILY_TOKEN_CAP);
      const retentionDays = positiveWhole(req.body?.retention_days, DEFAULT_RETENTION_DAYS);
      const businessType = (req.body?.business_type ?? "general") as BusinessType;
      // The plan decides the tier; without one, the tier is given (full unless said).
      const plan = typeof req.body?.plan_id === "string" ? await planById(req.body.plan_id) : undefined;
      if (req.body?.plan_id !== undefined && !plan) return res.status(404).json({ error: "plan_not_found", message: "That plan doesn't exist." });
      const tier = (plan?.tier ?? req.body?.tier ?? "full") as BusinessTier;
      if (!businessTiers.includes(tier)) return res.status(400).json({ error: "invalid_tier", message: "tier is starter or full." });
      if (!businessTypes.includes(businessType)) {
        return res.status(400).json({ error: "invalid_business_type", message: `business_type is one of ${businessTypes.join(", ")}.` });
      }
      // A type whose tools need the business's own system can't be added without its connector.
      if (TYPES_WITH_OWN_CONNECTOR.has(businessType)) {
        return res.status(400).json({ error: "connector_required", message: `A ${businessType} business needs its own connector, set up by the platform team.` });
      }
      if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) return res.status(400).json({ error: "invalid_id", message: "Ids are lowercase letters, digits and dashes." });
      // The ID becomes the business's own address (clubxo.bilamatata.com): names the service keeps aren't free.
      if (RESERVED_SUBDOMAINS.has(id)) return res.status(400).json({ error: "reserved_id", message: `"${id}" is kept for the service: choose another ID, such as the business's name.` });
      if (!name) return res.status(400).json({ error: "name_required" });
      if (origins.some((origin: string | null) => !origin)) return res.status(400).json({ error: "invalid_origin" });
      if (dailyTokenCap === null || retentionDays === null) {
        return res.status(400).json({ error: "invalid_limits", message: "daily_token_cap and retention_days are positive whole numbers." });
      }
      try {
        new Intl.DateTimeFormat("en", { timeZone });
      } catch {
        return res.status(400).json({ error: "invalid_time_zone" });
      }
      const ownerEmail = typeof owner.email === "string" ? owner.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ownerEmail)) return res.status(400).json({ error: "owner_email_required" });

      // An existing account becomes the owner as it is. A new one needs a
      // name, and either a good starting password or (left out) an emailed
      // link to choose their own.
      const existing = await findStaffByEmail(ownerEmail);
      // Each business its own dashboard: never an admin's, and another business's owner only when meant.
      if (existing?.isPlatformAdmin) return res.status(400).json({ error: "owner_is_admin", message: ADMIN_AS_OWNER });
      if (existing && owner.add_to_existing !== true) {
        const others = await membershipsOf(existing.id);
        if (others.length) {
          return res.status(409).json({
            error: "owner_has_business",
            message: `${ownerEmail} already has a dashboard, for ${others.map((entry) => entry.businessName).join(", ")}. Add this business to it only if it's the same owner; otherwise use the new business's own email.`,
            businesses: others.map((entry) => entry.businessName),
          });
        }
      }
      const invite = !existing && (owner.password === undefined || owner.password === null || owner.password === "");
      if (!existing) {
        if (typeof owner.name !== "string" || !owner.name.trim()) return res.status(400).json({ error: "owner_name_required" });
        if (invite && !canEmailLinks(config)) {
          return res.status(400).json({ error: "password_required", message: "Emails aren't set up on the platform yet: give the owner a starting password." });
        }
        const problem = invite ? null : passwordProblem(owner.password);
        if (problem) return res.status(400).json({ error: "weak_password", message: problem });
      }

      const publicKey = `pk_${id.replace(/-/g, "_")}_${randomBytes(6).toString("hex")}`;
      let ownerUser;
      try {
        ownerUser = await createBusinessWithOwner({
          business: { id, name, publicKey, allowedOrigins: origins as string[], timeZone, dailyTokenCap, retentionDays, businessType, tier },
          owner: { email: ownerEmail, name: String(owner.name ?? ""), passwordHash: existing ? null : invite ? await unknownPassword() : await hashPassword(owner.password) },
        });
      } catch (error) {
        const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
        if (database.code === "23505" && database.constraint === "businesses_pkey") return res.status(409).json({ error: "business_exists" });
        throw error;
      }
      clearBusinessCache();
      // On a plan from the start: its invoices go out by themselves, and an unpaid one pauses the business.
      if (plan) await choosePlan(id, plan.id, new Date(), { byTeam: true });
      // The plan's one-off set-up fee, as an invoice the owner pays on /pay.
      let setupInvoice: { reference: string; pay_url: string | null; emailed: boolean } | null = null;
      if (plan && req.body?.setup_invoice === true && plan.setupFeeMinor > 0) {
        const invoice = await createStudioInvoice({
          clientName: name, clientEmail: ownerEmail, description: `Zaina AI set-up: ${plan.name}`, category: "zaina_setup",
          amountMinor: plan.setupFeeMinor, currency: plan.currency, dueAt: null, notes: null,
        }, staffOf(req).user.id);
        const email = invoiceEmail(invoice);
        setupInvoice = { reference: invoice.reference, pay_url: invoiceLink(invoice), emailed: email ? await sendEmail({ to: ownerEmail, ...email }) : false };
      }
      if (invite) {
        const link = passwordLink(config.publicBaseUrl!, passwordLinkToken(config.sessionTokenSecret, ownerUser, "invite"), "invite");
        void sendEmail({ to: ownerUser.email, ...inviteEmail(ownerUser, name, "owner", link, null) });
      } else if (existing && canEmailLinks(config)) {
        void sendEmail({ to: ownerUser.email, ...addedEmail(ownerUser, name, "owner", `${config.publicBaseUrl}/app/`, null) });
      }
      res.status(201).json({
        business: {
          id, name, business_type: businessType, public_key: publicKey, allowed_origins: origins, time_zone: timeZone,
          daily_token_cap: dailyTokenCap, retention_days: retentionDays, tier, plan_id: plan?.id ?? null,
        },
        setup_invoice: setupInvoice,
        owner: { id: ownerUser.id, email: ownerUser.email, invited: invite },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/platform/businesses/:businessId/owner", staff, requirePlatformAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await anyBusinessById(String(req.params.businessId));
      if (!business) return res.status(404).json({ error: "not_found" });
      const owners = await ownersOf(business.id);
      res.json({ owners: owners.map((owner) => ({ email: owner.email, name: owner.name, is_admin: owner.isPlatformAdmin })) });
    } catch (error) {
      next(error);
    }
  });

  // A business the studio set up under an admin's own account, handed to its real owner.
  app.post("/v1/platform/businesses/:businessId/owner", staff, requirePlatformAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await anyBusinessById(String(req.params.businessId));
      if (!business) return res.status(404).json({ error: "not_found" });
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "owner_email_required" });
      const existing = await findStaffByEmail(email);
      if (existing?.isPlatformAdmin) return res.status(400).json({ error: "owner_is_admin", message: ADMIN_AS_OWNER });
      const password = req.body?.password;
      const invite = !existing && (password === undefined || password === null || password === "");
      if (!existing) {
        if (typeof req.body?.name !== "string" || !req.body.name.trim()) return res.status(400).json({ error: "owner_name_required", message: "The owner's name, please." });
        if (invite && !canEmailLinks(config)) return res.status(400).json({ error: "password_required", message: "Emails aren't set up on the platform yet: give the owner a starting password." });
        const problem = invite ? null : passwordProblem(password);
        if (problem) return res.status(400).json({ error: "weak_password", message: problem });
      }
      const handed = await handOverBusiness(business.id, { email, name: String(req.body?.name ?? ""), passwordHash: existing ? null : invite ? await unknownPassword() : await hashPassword(password) });
      if (invite) {
        const link = passwordLink(config.publicBaseUrl!, passwordLinkToken(config.sessionTokenSecret, handed.owner, "invite"), "invite");
        void sendEmail({ to: handed.owner.email, ...inviteEmail(handed.owner, business.name, "owner", link, null) });
      } else if (canEmailLinks(config)) {
        void sendEmail({ to: handed.owner.email, ...addedEmail(handed.owner, business.name, "owner", `${config.publicBaseUrl}/app/`, null) });
      }
      res.json({ owner: { email: handed.owner.email, invited: invite }, removed_admins: handed.removedAdmins });
    } catch (error) {
      next(error);
    }
  });
}

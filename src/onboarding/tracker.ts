// src/onboarding/tracker.ts
//
// The studio's onboarding tracker (Phase 6, docs/ONBOARDING.md): where each
// client is on its path to going live. Most steps are read from the
// business's real setup, so the tracker can't say "done" when it isn't; a
// few only a person can confirm (the walkthrough, the acceptance test) are
// ticked by the studio.
//
//   GET /v1/platform/onboarding                     every business, its path and its steps
//   PUT /v1/platform/onboarding/:businessId         { path?, ticks?: { id: boolean }, note? }

import type { Express, NextFunction, Request, Response } from "express";
import { anyBusinessById, everyBusiness } from "../businesses/registry.ts";
import type { PlatformConfig } from "../config.ts";
import { takesBookings, type Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { requirePlatformAdmin, requireStaff, staffOf } from "../staff/auth.ts";

export const PATHS = {
  notebook: "No website, no calendar: a notebook and a WhatsApp number",
  website: "A website, no booking system",
  calendar: "A website or booking channels, with a calendar",
  system: "Their own shop or booking system",
} as const;
export type OnboardingPath = keyof typeof PATHS;
export const isPath = (value: unknown): value is OnboardingPath => typeof value === "string" && value in PATHS;

export const MANUAL_STEPS = {
  baseline: "Week-0 baseline written down with the owner (docs/PILOTS.md)",
  walkthrough: "Owner walked through the dashboard on their own phone",
  printed: "QR poster and business cards printed or sent",
  acceptance: "Acceptance test passed: the evaluation is clean and ten real questions were answered right",
} as const;
type ManualStep = keyof typeof MANUAL_STEPS;

type Facts = {
  display_name: string | null; contact_phone: string | null; about_length: number; website_url: string | null; brand_tagline: string | null; has_logo: boolean;
  industry: string | null; answers: number; sources: number; offerings: number; price_items: number; payments: boolean; alert_emails: number; members: number;
  scans: number; whatsapp: boolean; calendars: number; integration_ok: boolean; previews: number;
};

export type Step = { id: string; label: string; done: boolean; auto: boolean; fix: string | null };

async function factsFor(business: Business): Promise<Facts> {
  return inBusiness(async (_db, client) => (await client.query<Facts>(
    `select s.display_name, s.contact_phone, coalesce(length(s.about), 0) as about_length, s.website_url, s.brand_tagline,
       exists (select 1 from brand_assets where business_id = $1 and kind = 'logo') as has_logo,
       s.industry,
       coalesce((select count(*)::int from jsonb_each_text(coalesce(s.interview -> 'answers', '{}'::jsonb)) where length(value) > 0), 0) as answers,
       (select count(*)::int from knowledge_sources where business_id = $1) as sources,
       (select count(*)::int from offerings where business_id = $1) as offerings,
       (select count(*)::int from price_items where business_id = $1) as price_items,
       (exists (select 1 from business_secrets where business_id = $1 and name in ('paystack_secret_key', 'mpesa_consumer_key', 'mpesa_manual_number'))
         or exists (select 1 from booking_settings where business_id = $1 and (mpesa_shortcode is not null or mpesa_till is not null))) as payments,
       (select count(*)::int from notification_recipients where business_id = $1) as alert_emails,
       (select count(*)::int from staff_memberships where business_id = $1) as members,
       coalesce((select sum(visits)::int from front_door_days where business_id = $1 and source = 'qr'), 0) as scans,
       exists (select 1 from whatsapp_numbers where business_id = $1 and status = 'active') as whatsapp,
       (select count(*)::int from calendar_sources where business_id = $1) + (select count(*)::int from calendar_connections where business_id = $1) as calendars,
       exists (select 1 from integrations where business_id = $1 and studio_enabled and endpoint is not null and last_ok_at is not null) as integration_ok,
       (select count(*)::int from chat_sessions where business_id = $1 and preview) as previews
     from business_settings s where s.business_id = $1`,
    [business.id],
  )).rows[0], business.id);
}

/** A path that fits what the business already has, until the studio chooses one. */
export function guessPath(facts: Pick<Facts, "integration_ok" | "calendars" | "website_url">, business: Pick<Business, "allowedOrigins">): OnboardingPath {
  if (facts.integration_ok) return "system";
  if (facts.calendars > 0) return "calendar";
  if (facts.website_url || business.allowedOrigins.length > 0) return "website";
  return "notebook";
}

export function stepsFor(business: Pick<Business, "id" | "businessType" | "tier" | "status" | "allowedOrigins">, facts: Facts, path: OnboardingPath, ticks: Record<string, boolean>): Step[] {
  const at = (page: string) => `#/b/${business.id}/${page}`;
  const books = business.tier === "full" && takesBookings(business.businessType);
  // The Menu plan is the page alone: its steps are the menu, the brand and the printed code.
  if (business.tier === "menu") {
    const menu: Step[] = [
      { id: "profile", label: "Profile: name, phone and a few lines on what they do", done: Boolean(facts.display_name && facts.contact_phone && facts.about_length >= 40), auto: true, fix: at("settings/profile") },
      { id: "brand", label: "Brand: logo or welcome line", done: facts.has_logo || Boolean(facts.brand_tagline), auto: true, fix: at("settings/brand") },
      { id: "catalogue", label: "The menu: sections, items and prices", done: facts.price_items > 0, auto: true, fix: at("prices") },
      { id: "reach", label: "Customers open the menu: QR code scanned", done: facts.scans > 0, auto: true, fix: at("settings/door") },
      { id: "walkthrough", label: MANUAL_STEPS.walkthrough, done: ticks.walkthrough === true, auto: false, fix: null },
      { id: "printed", label: MANUAL_STEPS.printed, done: ticks.printed === true, auto: false, fix: null },
      { id: "live", label: "Live: the menu is open to customers", done: business.status === "active", auto: true, fix: null },
    ];
    return menu;
  }
  const steps: Step[] = [
    { id: "profile", label: "Profile: name, phone and a few lines on what they do", done: Boolean(facts.display_name && facts.contact_phone && facts.about_length >= 40), auto: true, fix: at("settings/profile") },
    { id: "brand", label: "Brand: logo or welcome line", done: facts.has_logo || Boolean(facts.brand_tagline), auto: true, fix: at("settings/brand") },
    { id: "interview", label: "Setup interview: five or more answers", done: Boolean(facts.industry) && facts.answers >= 5, auto: true, fix: at("knowledge") },
    { id: "knowledge", label: "Knowledge: at least two sources Zaina answers from", done: facts.sources >= 2, auto: true, fix: at("knowledge") },
    { id: "catalogue", label: business.businessType === "guesthouse" ? "Rooms and rates" : "What they sell: services or a price list", done: facts.offerings > 0 || facts.price_items > 0, auto: true, fix: at(business.businessType === "guesthouse" ? "rooms" : "prices") },
  ];
  if (books) steps.push({ id: "payments", label: "Their own payment link (M-Pesa or card), paid straight to them", done: facts.payments, auto: true, fix: at("settings/bookings") });
  steps.push({ id: "alerts", label: "Someone gets every lead and booking (alert emails or a team member)", done: facts.alert_emails > 0 || facts.members > 1, auto: true, fix: at("settings/notifications") });
  if (path === "notebook") steps.push({ id: "reach", label: "Customers can reach Zaina: QR code scanned or WhatsApp connected", done: facts.scans > 0 || facts.whatsapp, auto: true, fix: at("settings/door") });
  else steps.push({ id: "reach", label: "The chat is on their website (its address allowed) or WhatsApp connected", done: business.allowedOrigins.length > 0 || facts.whatsapp, auto: true, fix: at("settings/widget") });
  if (path === "calendar") steps.push({ id: "calendar", label: "Their calendar connected, so Zaina sees what's taken", done: facts.calendars > 0, auto: true, fix: at("settings/calendars") });
  if (path === "system") steps.push({ id: "system", label: "Their system connected and answering (docs/INTEGRATION.md)", done: facts.integration_ok, auto: true, fix: at("settings/system") });
  steps.push({ id: "tried", label: "The team tried Zaina themselves (three or more test chats)", done: facts.previews >= 3, auto: true, fix: at("setup") });
  for (const [id, label] of Object.entries(MANUAL_STEPS) as Array<[ManualStep, string]>) {
    if (id === "printed" && path !== "notebook") continue;
    steps.push({ id, label, done: ticks[id] === true, auto: false, fix: null });
  }
  steps.push({ id: "live", label: "Live: customers are being answered", done: business.status === "active", auto: true, fix: null });
  return steps;
}

type Saved = { path: OnboardingPath | null; ticks: Record<string, boolean>; note: string | null; updated_at: Date | null };

async function savedFor(businessId: string): Promise<Saved> {
  const rows = await inBusiness(async (_db, client) => (await client.query<Saved>(`select path, ticks, note, updated_at from onboarding_trackers where business_id = $1`, [businessId])).rows, businessId);
  return rows[0] ?? { path: null, ticks: {}, note: null, updated_at: null };
}

async function trackerFor(business: Business) {
  const [facts, saved] = await Promise.all([factsFor(business), savedFor(business.id)]);
  const path = saved.path ?? guessPath(facts, business);
  const steps = facts ? stepsFor(business, facts, path, saved.ticks ?? {}) : [];
  return {
    business: { id: business.id, name: business.name, type: business.businessType, tier: business.tier, status: business.status },
    path,
    path_chosen: saved.path !== null,
    steps,
    done: steps.filter((step) => step.done).length,
    total: steps.length,
    note: saved.note,
    updated_at: saved.updated_at,
  };
}

export function registerOnboardingTrackerRoutes(app: Express, config: PlatformConfig): void {
  const admin = [requireStaff(config.sessionTokenSecret), requirePlatformAdmin];

  app.get("/v1/platform/onboarding", ...admin, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const businesses = await everyBusiness();
      const trackers = await Promise.all(businesses.map((business) => trackerFor(business)));
      res.json({ paths: PATHS, businesses: trackers.sort((a, b) => Number(a.business.status === "active") - Number(b.business.status === "active") || a.done / a.total - b.done / b.total) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/v1/platform/onboarding/:businessId", ...admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await anyBusinessById(String(req.params.businessId));
      if (!business) return res.status(404).json({ error: "not_found" });
      const body = req.body ?? {};
      if (body.path !== undefined && body.path !== null && !isPath(body.path)) return res.status(400).json({ error: "invalid_path", message: `Paths are: ${Object.keys(PATHS).join(", ")}.` });
      const saved = await savedFor(business.id);
      const ticks = { ...(saved.ticks ?? {}) };
      if (body.ticks && typeof body.ticks === "object") {
        for (const [id, value] of Object.entries(body.ticks)) {
          if (!(id in MANUAL_STEPS)) return res.status(400).json({ error: "unknown_step", message: `Steps to tick are: ${Object.keys(MANUAL_STEPS).join(", ")}.` });
          ticks[id] = value === true;
        }
      }
      const note = body.note === undefined ? saved.note : typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
      const path = body.path === undefined ? saved.path : body.path;
      await inBusiness((_db, client) => client.query(
        `insert into onboarding_trackers (business_id, path, ticks, note, updated_by) values ($1, $2, $3, $4, $5)
         on conflict (business_id) do update set path = excluded.path, ticks = excluded.ticks, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`,
        [business.id, path, JSON.stringify(ticks), note, staffOf(req).user.id],
      ), business.id);
      res.json({ tracker: await trackerFor(business) });
    } catch (error) {
      next(error);
    }
  });
}

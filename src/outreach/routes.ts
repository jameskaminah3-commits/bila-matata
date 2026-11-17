// src/outreach/routes.ts
//
// Outreach in the dashboard, under /v1/staff/businesses/:businessId:
//
//   GET  /outreach                     settings, consent, recent messages, ratings, campaigns, suggestions   manager
//   PUT  /outreach/settings            { reminders, reminder_hours, follow_ups, feedback, feedback_hours, offers, templates }   manager
//   POST /campaigns                    { title, message, audience }  a draft                                 manager
//   GET  /campaigns/:id/preview        who it would reach now, and how                                       manager
//   POST /campaigns/:id/approve        { confirm: <the number shown> }  starts sending                       manager
//   POST /campaigns/:id/cancel                                                                               manager
//   POST /customers/:id/consent        { offers?: boolean, source?: string, stopped?: boolean }              manager
//
// And for customers: GET /u/:businessId/:token, the unsubscribe link in emails.

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { anyBusinessById } from "../businesses/registry.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import type { Business, OutreachSettings } from "../db/schema.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { AUDIENCES, audiencePreview, type Audience } from "./jobs.ts";
import { getOutreachSettings } from "./send.ts";
import { getNumber } from "../channels/whatsapp/numbers.ts";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;

export function validateOutreach(input: Record<string, any>, current: OutreachSettings): { ok: true; value: OutreachSettings } | { ok: false; error: string } {
  const next: OutreachSettings = { ...current, templates: { ...current.templates } };
  for (const [key, field] of [["reminders", "reminders"], ["follow_ups", "followUps"], ["feedback", "feedback"], ["offers", "offers"]] as const) {
    if (key in input) {
      if (typeof input[key] !== "boolean") return { ok: false, error: `${key} is true or false.` };
      next[field] = input[key];
    }
  }
  if ("reminder_hours" in input) {
    const hours = Number(input.reminder_hours);
    if (!Number.isInteger(hours) || hours < 2 || hours > 72) return { ok: false, error: "Reminders go 2 to 72 hours before." };
    next.reminderHours = hours;
  }
  if ("feedback_hours" in input) {
    const hours = Number(input.feedback_hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 72) return { ok: false, error: "Feedback is asked 1 to 72 hours after." };
    next.feedbackHours = hours;
  }
  if (input.templates && typeof input.templates === "object") {
    for (const key of ["reminder", "feedback", "offer"] as const) {
      if (!(key in input.templates)) continue;
      const name = typeof input.templates[key] === "string" ? input.templates[key].trim() : "";
      if (name && !TEMPLATE_NAME.test(name)) return { ok: false, error: "A template's name is as Meta shows it: lowercase letters, numbers and underscores." };
      next.templates[key] = name || null;
    }
    if ("language" in input.templates) {
      const language = String(input.templates.language ?? "").trim();
      if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) return { ok: false, error: "The templates' language code, like en or sw or en_GB." };
      next.templates.language = language;
    }
  }
  return { ok: true, value: next };
}

const publicSettings = (settings: OutreachSettings) => ({
  reminders: settings.reminders, reminder_hours: settings.reminderHours, follow_ups: settings.followUps,
  feedback: settings.feedback, feedback_hours: settings.feedbackHours, offers: settings.offers, templates: settings.templates,
});

export function registerOutreachRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId";
  const manager = [staff, requireBusinessRole("manager")];
  const handle = (fn: (req: Request, res: Response, business: Business, userId: string) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      await fn(req, res, business!, user.id);
    } catch (error) {
      next(error);
    }
  };
  const campaignOf = (business: Business, id: string) => inBusiness(async (_db, client) => (/^[0-9a-f-]{36}$/i.test(id)
    ? (await client.query("select * from campaigns where business_id = $1 and id = $2", [business.id, id])).rows[0] : undefined), business.id);

  app.get(`${base}/outreach`, ...manager, handle(async (_req, res, business) => {
    const settings = await getOutreachSettings(business.id);
    const data = await inBusiness(async (_db, client) => {
      const { rows: [consent] } = await client.query(
        `select count(*) filter (where offers_agreed_at is not null and outreach_stopped_at is null)::int as offers,
                count(*) filter (where outreach_stopped_at is not null)::int as stopped, count(*)::int as customers
         from customers where business_id = $1`, [business.id]);
      const { rows: recent } = await client.query(
        `select m.kind, m.status, m.channel, m.reason, m.text, m.rating, m.created_at, c.name as customer, c.id as customer_id
         from outreach_messages m left join customers c on c.id = m.customer_id where m.business_id = $1 order by m.created_at desc limit 40`, [business.id]);
      const { rows: [ratings] } = await client.query(
        `select count(rating)::int as count, round(avg(rating)::numeric, 1)::float as average, count(*) filter (where rating <= 3)::int as low
         from outreach_messages where business_id = $1 and kind = 'feedback' and created_at > now() - interval '90 days'`, [business.id]);
      const { rows: campaigns } = await client.query(
        `select c.id, c.title, c.message, c.audience, c.status, c.created_at, c.approved_at, c.finished_at,
                (select count(*) filter (where status = 'sent') from outreach_messages m where m.campaign_id = c.id)::int as sent,
                (select count(*) filter (where status <> 'sent') from outreach_messages m where m.campaign_id = c.id)::int as skipped
         from campaigns c where c.business_id = $1 order by c.created_at desc limit 20`, [business.id]);
      return { consent, recent, ratings, campaigns };
    }, business.id);
    const suggestions = await Promise.all((["lapsed", "regulars", "everyone"] as Audience[]).map(async (audience) => ({ audience, label: AUDIENCES[audience], ...(await audiencePreview(business, audience)) })));
    res.json({ settings: publicSettings(settings), ...data, suggestions, whatsapp_connected: Boolean(await getNumber(business.id)) });
  }));

  app.put(`${base}/outreach/settings`, ...manager, handle(async (req, res, business, userId) => {
    const checked = validateOutreach(req.body && typeof req.body === "object" ? req.body : {}, await getOutreachSettings(business.id));
    if (!checked.ok) return res.status(400).json({ error: "invalid_settings", message: checked.error });
    await updateBusinessSettings(business.id, { outreach: checked.value }, userId);
    res.json(publicSettings(checked.value));
  }));

  app.post(`${base}/campaigns`, ...manager, handle(async (req, res, business, userId) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 120) : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const audience = req.body?.audience as Audience;
    if (!title) return res.status(400).json({ error: "title_required", message: "Give the campaign a name, for you." });
    if (message.length < 10 || message.length > 700) return res.status(400).json({ error: "message_length", message: "The message is 10 to 700 characters." });
    if (!(audience in AUDIENCES)) return res.status(400).json({ error: "invalid_audience", message: "audience is everyone, lapsed or regulars." });
    const row = await inBusiness(async (_db, client) => (await client.query(
      "insert into campaigns (business_id, title, message, audience, created_by) values ($1, $2, $3, $4, $5) returning *", [business.id, title, message, audience, userId])).rows[0], business.id);
    res.status(201).json(row);
  }));

  app.get(`${base}/campaigns/:id/preview`, ...manager, handle(async (req, res, business) => {
    const campaign = await campaignOf(business, String(req.params.id));
    if (!campaign) return res.status(404).json({ error: "not_found" });
    const settings = await getOutreachSettings(business.id);
    const preview = await audiencePreview(business, campaign.audience);
    res.json({
      ...preview,
      reachable: preview.inWindow + (settings.templates.offer ? preview.needTemplate : 0),
      template: settings.templates.offer,
      offers_on: settings.offers,
      sample: campaign.message.replace(/\{name\}/g, "Achieng"),
    });
  }));

  app.post(`${base}/campaigns/:id/approve`, ...manager, handle(async (req, res, business, userId) => {
    const campaign = await campaignOf(business, String(req.params.id));
    if (!campaign) return res.status(404).json({ error: "not_found" });
    if (campaign.status !== "draft") return res.status(409).json({ error: "wrong_status", message: "Only a draft can be approved." });
    const settings = await getOutreachSettings(business.id);
    if (!settings.offers) return res.status(409).json({ error: "offers_off", message: "Turn on offers first (Outreach settings)." });
    const preview = await audiencePreview(business, campaign.audience);
    const reachable = preview.inWindow + (settings.templates.offer ? preview.needTemplate : 0);
    if (!reachable) return res.status(409).json({ error: "nobody", message: "Nobody in this audience can be reached now." });
    // The person approving confirms how many it goes to, as shown to them.
    if (Number(req.body?.confirm) !== reachable) return res.status(409).json({ error: "confirm_count", message: `Confirm the number of customers it goes to: ${reachable}.`, reachable });
    await inBusiness((_db, client) => client.query("update campaigns set status = 'sending', approved_by = $3, approved_at = now() where business_id = $1 and id = $2", [business.id, campaign.id, userId]), business.id);
    res.json({ status: "sending", reachable });
  }));

  app.post(`${base}/campaigns/:id/cancel`, ...manager, handle(async (req, res, business) => {
    const campaign = await campaignOf(business, String(req.params.id));
    if (!campaign) return res.status(404).json({ error: "not_found" });
    if (!["draft", "sending"].includes(campaign.status)) return res.status(409).json({ error: "wrong_status", message: "It's already finished." });
    await inBusiness((_db, client) => client.query("update campaigns set status = 'cancelled', finished_at = now() where business_id = $1 and id = $2", [business.id, campaign.id]), business.id);
    res.json({ status: "cancelled" });
  }));

  app.post(`${base}/customers/:id/consent`, ...manager, handle(async (req, res, business) => {
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(404).json({ error: "not_found" });
    const offers = req.body?.offers;
    const stopped = req.body?.stopped;
    const source = typeof req.body?.source === "string" ? req.body.source.trim().slice(0, 200) : "";
    if (offers === true && source.length < 5) return res.status(400).json({ error: "source_required", message: "Say how they agreed, like \"Signed up at the counter on 3 Nov\"." });
    const row = await inBusiness(async (_db, client) => (await client.query(
      `update customers set
         offers_agreed_at = case when $3::boolean is null then offers_agreed_at when $3 then now() else null end,
         offers_source = case when $3::boolean is true then $4 else offers_source end,
         outreach_stopped_at = case when $5::boolean is null then outreach_stopped_at when $5 then now() else null end,
         updated_at = now()
       where business_id = $1 and id = $2 returning offers_agreed_at, offers_source, outreach_stopped_at`,
      [business.id, id, typeof offers === "boolean" ? offers : null, `${source} (recorded by the team)`, typeof stopped === "boolean" ? stopped : null])).rows[0], business.id);
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json(row);
  }));

  // ── For customers: the unsubscribe link in an email ──
  app.get("/u/:businessId/:token", async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex");
      const business = await anyBusinessById(String(req.params.businessId));
      const token = String(req.params.token);
      const done = business && /^[0-9a-f]{32}$/.test(token) ? await runForBusiness(business.id, () => inBusiness(async (_db, client) => (await client.query(
        "update customers set outreach_stopped_at = coalesce(outreach_stopped_at, now()), offers_agreed_at = null where business_id = $1 and unsubscribe_token = $2 returning id", [business.id, token])).rowCount, business.id)) : 0;
      const name = business ? (await getBusinessSettings(business.id))?.displayName ?? business.name : "";
      res.status(done ? 200 : 404).type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${done ? "Unsubscribed" : "Link not valid"}</title><link rel="stylesheet" href="/pay-assets/pay.css"></head><body><main class="pay"><h1>${done ? "You're unsubscribed" : "This link isn't valid"}</h1><p>${done ? `You won't get reminders or offers from ${escapeHtml(name)}. You can still write to them any time.` : "Please check the link in the email."}</p></main></body></html>`);
    } catch (error) {
      next(error);
    }
  });
}


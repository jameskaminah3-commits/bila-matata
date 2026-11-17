// src/outreach/jobs.ts
//
// What goes out on its own, every few minutes, between 08:00 and 20:00 in
// each business's time, for what the business turned on (Outreach):
//
//   reminders    before a confirmed booking (its start within the hours the
//                business chose, 24 by default)
//   follow-ups   a WhatsApp chat that asked about prices or availability and
//                didn't book, order or leave details: once, 2 to 20 hours
//                after their last message, while the window is still open
//   feedback     after a delivered order or a stay or appointment that ended:
//                "how was it? 1 to 5" (replies.ts records the answer)
//   campaigns    offers the business approved, to customers who said yes,
//                a few at a time
//
// Each message goes through send.ts, which applies every rule and logs it.

import { formatDay, slotTime } from "../booking/notices.ts";
import { everyBusiness } from "../businesses/registry.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import type { Business, ChatLanguage } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { getOutreachSettings, reachOf, sendOutreach, type Outcome } from "./send.ts";

const CUSTOMER_COLUMNS = "c.id, c.name, c.email, c.outreach_stopped_at, c.offers_agreed_at, c.unsubscribe_token";
export const CAMPAIGN_BATCH = 30;

/** The hour in the business's time (0 to 23). */
export const localHour = (now: Date, timeZone: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
export const quietHours = (now: Date, timeZone: string) => {
  // Tests run at any hour (OUTREACH_QUIET_HOURS=off); businesses never do.
  if (process.env.OUTREACH_QUIET_HOURS === "off") return false;
  const hour = localHour(now, timeZone);
  return hour < 8 || hour >= 20;
};

// ── The words ─────────────────────────────────────────────────────────

export function reminderText(language: ChatLanguage, name: string, what: string, when: string, business: string): string {
  return language === "sw"
    ? `Habari ${name}, tunakukumbusha ${what} yako katika ${business}, ${when}. Jibu hapa ikiwa kuna mabadiliko.`
    : `Hi ${name}, a reminder of your ${what} at ${business}, ${when}. Reply here if anything changes.`;
}
export function followUpText(language: ChatLanguage, name: string): string {
  return language === "sw"
    ? `Habari ${name}, umepata ulichokuwa ukitafuta? Niko hapa ukitaka kuagiza au kuweka nafasi.`
    : `Hi ${name}, did you find what you were looking for? I'm here if you'd like to book or order.`;
}
export function feedbackText(language: ChatLanguage, name: string, what: string, business: string): string {
  return language === "sw"
    ? `Habari ${name}, asante kwa ${what} kutoka ${business}. Ilikuwaje? Jibu kwa namba kutoka 1 (mbaya) hadi 5 (bora kabisa).`
    : `Hi ${name}, thank you for your ${what} with ${business}. How was it? Reply with a number from 1 (poor) to 5 (excellent).`;
}
export const offerText = (message: string, name: string) => message.replace(/\{name\}/g, name);

// ── Service messages ──────────────────────────────────────────────────

type Due = Record<string, any>;

async function due(business: Business, sql: string, values: unknown[]): Promise<Due[]> {
  return inBusiness(async (_db, client) => (await client.query(sql, [business.id, ...values])).rows, business.id);
}

async function reminders(business: Business, hours: number, name: string, now: Date): Promise<number> {
  const rows = await due(business,
    `select ${CUSTOMER_COLUMNS}, b.id as booking_id, b.reference, b.starts_at, b.check_in::text as check_in, coalesce(o.name, 'booking') as what
     from bookings b join customers c on c.business_id = b.business_id and c.id = b.customer_id
     left join offerings o on o.business_id = b.business_id and o.id = b.offering_id
     where b.business_id = $1 and b.status = 'confirmed'
       and coalesce(b.starts_at, (b.check_in::timestamp + time '12:00') at time zone $2) > $3::timestamptz
       and coalesce(b.starts_at, (b.check_in::timestamp + time '12:00') at time zone $2) <= $3::timestamptz + make_interval(hours => $4::int)
       and not exists (select 1 from outreach_messages m where m.business_id = b.business_id and m.kind = 'reminder' and m.ref = 'booking:' || b.id)
     limit 50`, [business.timeZone, now, hours]);
  let sent = 0;
  for (const row of rows) {
    const reach = await reachOf(business.id, row as any, now);
    const when = row.starts_at ? slotTime(row.starts_at, business.timeZone) : `from ${formatDay(row.check_in)}`;
    const what = row.starts_at ? row.what : `stay (${row.what})`;
    const outcome = await sendOutreach(business, row as any, {
      kind: "reminder", ref: `booking:${row.booking_id}`, text: reminderText(reach.language, reach.firstName, what, when, name),
      template: { key: "reminder", params: [reach.firstName, `${what}, ${when}`] }, email: { subject: `Reminder: ${what}, ${when} (${row.reference})` },
    }, now);
    if (outcome.status === "sent") sent += 1;
  }
  return sent;
}

async function followUps(business: Business, now: Date): Promise<number> {
  const rows = await due(business,
    `select ${CUSTOMER_COLUMNS}, s.id as session_id
     from chat_sessions s join customers c on c.business_id = s.business_id and c.id = s.customer_id
     where s.business_id = $1 and s.channel = 'whatsapp' and not s.preview and s.managed_by = 'AI'
       and s.customer_last_message_at between $2::timestamptz - interval '20 hours' and $2::timestamptz - interval '2 hours'
       and exists (select 1 from chat_events e where e.business_id = s.business_id and e.session_id = s.id
                   and e.tool_name in ('get_prices', 'check_availability', 'check_times', 'list_rooms', 'list_services', 'store_search', 'store_item'))
       and not exists (select 1 from leads l where l.business_id = s.business_id and l.session_id = s.id)
       and not exists (select 1 from bookings b where b.business_id = s.business_id and b.session_id = s.id)
       and not exists (select 1 from orders o where o.business_id = s.business_id and o.session_id = s.id)
       and not exists (select 1 from outreach_messages m where m.business_id = s.business_id and m.kind = 'follow_up' and m.ref = 'chat:' || s.id)
     limit 50`, [now]);
  let sent = 0;
  for (const row of rows) {
    const reach = await reachOf(business.id, row as any, now);
    const outcome = await sendOutreach(business, row as any, { kind: "follow_up", ref: `chat:${row.session_id}`, text: followUpText(reach.language, reach.firstName), template: null, email: null }, now);
    if (outcome.status === "sent") sent += 1;
  }
  return sent;
}

async function feedback(business: Business, hours: number, name: string, now: Date): Promise<number> {
  const rows = await due(business,
    `select * from (
       select ${CUSTOMER_COLUMNS}, 'order:' || o.id as ref, 'order ' || o.reference as what
       from orders o join customers c on c.business_id = o.business_id and c.id = o.customer_id
       where o.business_id = $1 and o.status = 'completed' and o.completed_at between $2::timestamptz - interval '7 days' and $2::timestamptz - make_interval(hours => $3::int)
       union all
       select ${CUSTOMER_COLUMNS}, 'booking:' || b.id, case when b.starts_at is null then 'stay' else coalesce(f.name, 'visit') end
       from bookings b join customers c on c.business_id = b.business_id and c.id = b.customer_id
       left join offerings f on f.business_id = b.business_id and f.id = b.offering_id
       where b.business_id = $1 and b.status = 'confirmed'
         and coalesce(b.ends_at, (b.check_out::timestamp + time '11:00') at time zone $4) between $2::timestamptz - interval '7 days' and $2::timestamptz - make_interval(hours => $3::int)
     ) t where not exists (select 1 from outreach_messages m where m.business_id = $1 and m.kind = 'feedback' and m.ref = t.ref)
     limit 50`, [now, hours, business.timeZone]);
  let sent = 0;
  for (const row of rows) {
    const reach = await reachOf(business.id, row as any, now);
    const outcome = await sendOutreach(business, row as any, {
      kind: "feedback", ref: row.ref, text: feedbackText(reach.language, reach.firstName, row.what, name),
      template: { key: "feedback", params: [reach.firstName, row.what] }, email: { subject: `How was your ${row.what}?` },
    }, now);
    if (outcome.status === "sent") sent += 1;
  }
  return sent;
}

// ── Campaigns ─────────────────────────────────────────────────────────

export type Audience = "everyone" | "lapsed" | "regulars";
export const AUDIENCES: Record<Audience, string> = {
  everyone: "Everyone who said yes to offers",
  lapsed: "Customers who haven't bought in 60 days",
  regulars: "Regulars (two or more orders) due to order again (21 days since their last)",
};

/** Customers a campaign may go to: said yes to offers, didn't reply STOP, and fit the audience. */
export function audienceSql(audience: Audience): string {
  const bought = `(select max(t.at) from (
      select o.created_at as at from orders o where o.business_id = c.business_id and o.customer_id = c.id and o.status in ('confirmed', 'out_for_delivery', 'ready_for_collection', 'completed')
      union all select b.created_at from bookings b where b.business_id = c.business_id and b.customer_id = c.id and b.status = 'confirmed') t)`;
  const extra = audience === "lapsed"
    ? `and ${bought} < now() - interval '60 days'`
    : audience === "regulars"
      ? `and (select count(*) from orders o where o.business_id = c.business_id and o.customer_id = c.id and o.status = 'completed') >= 2 and ${bought} < now() - interval '21 days'`
      : "";
  return `from customers c where c.business_id = $1 and c.offers_agreed_at is not null and c.outreach_stopped_at is null ${extra}`;
}

/** Who'd get a campaign now, and how. */
export async function audiencePreview(business: Business, audience: Audience): Promise<{ eligible: number; inWindow: number; needTemplate: number; noWhatsapp: number }> {
  const rows = await inBusiness(async (_db, client) => (await client.query<{ window_open: boolean | null }>(
    `select (select max(s.customer_last_message_at) > now() - interval '23 hours' from chat_sessions s
               where s.business_id = c.business_id and s.customer_id = c.id and s.channel = 'whatsapp') as window_open
     ${audienceSql(audience)}`, [business.id])).rows, business.id);
  return {
    eligible: rows.length,
    inWindow: rows.filter((row) => row.window_open === true).length,
    needTemplate: rows.filter((row) => row.window_open === false).length,
    noWhatsapp: rows.filter((row) => row.window_open === null).length,
  };
}

async function campaigns(business: Business, now: Date): Promise<number> {
  const running = await due(business, "select id, message, audience from campaigns where business_id = $1 and status = 'sending' order by approved_at", []);
  let sent = 0;
  for (const campaign of running) {
    const rows = await due(business,
      `select ${CUSTOMER_COLUMNS} ${audienceSql(campaign.audience)}
         and not exists (select 1 from outreach_messages m where m.business_id = c.business_id and m.kind = 'offer' and m.ref = 'campaign:' || $2 || ':' || c.id)
       limit ${CAMPAIGN_BATCH}`, [campaign.id]);
    for (const row of rows) {
      const reach = await reachOf(business.id, row as any, now);
      const text = offerText(campaign.message, reach.firstName);
      const outcome: Outcome = await sendOutreach(business, row as any, { kind: "offer", ref: `campaign:${campaign.id}:${row.id}`, campaignId: campaign.id, text, template: { key: "offer", params: [reach.firstName, offerText(campaign.message, reach.firstName)] }, email: null }, now);
      if (outcome.status === "sent") sent += 1;
    }
    // Finished once nobody is left (anyone held back because they were messaged recently is tried again next run).
    if (!rows.length) await inBusiness((_db, client) => client.query("update campaigns set status = 'sent', finished_at = now() where business_id = $1 and id = $2 and status = 'sending'", [business.id, campaign.id]), business.id);
  }
  return sent;
}

// ── The job ───────────────────────────────────────────────────────────

/** One run over every business: what's due goes out, within quiet hours. */
export async function runOutreach(now = new Date()): Promise<number> {
  let sent = 0;
  for (const business of await everyBusiness()) {
    if (business.status !== "active" || business.businessType === "custom" || quietHours(now, business.timeZone)) continue;
    try {
      const settings = await getOutreachSettings(business.id);
      const name = (await getBusinessSettings(business.id))?.displayName ?? business.name;
      if (settings.reminders) sent += await reminders(business, settings.reminderHours, name, now);
      if (settings.followUps) sent += await followUps(business, now);
      if (settings.feedback) sent += await feedback(business, settings.feedbackHours, name, now);
      if (settings.offers) sent += await campaigns(business, now);
    } catch (error) {
      console.error(`[outreach] ${business.id}: a run failed:`, error);
    }
  }
  return sent;
}

// src/outreach/send.ts
//
// One message to a customer who isn't chatting, under every rule at once.
// The rules, in order:
//
//   once     each message is about something (a booking, an order, a chat,
//            a campaign) and goes once (outreach_messages, unique by kind and
//            what it's about), sent or skipped, with the reason
//   STOP     a customer who replied STOP gets nothing (outreach_stopped_at)
//   offers   only to a customer who said yes to offers (offers_agreed_at),
//            at most one a week
//   pace     no more than one message a day to the same customer (a
//            reminder excepted); a message held back waits for a later run
//   channel  WhatsApp only to a customer who has written to the business on
//            WhatsApp: as a normal message while their 24-hour window is
//            open, otherwise only with a template Meta has approved for it.
//            Email (with an unsubscribe link) for service messages, never
//            offers. A follow-up on an enquiry goes only inside the window.
//
// Quiet hours (08:00 to 20:00 in the business's time) are the job's (jobs.ts).

import { sendCustomerEmail } from "../booking/notices.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import type { WhatsappContext } from "../channels/whatsapp/context.ts";
import { sendTemplate } from "../channels/whatsapp/graph.ts";
import { connectionFor } from "../channels/whatsapp/numbers.ts";
import { requestDelivery, whatsappRuntime } from "../channels/whatsapp/runtime.ts";
import { appendEvent } from "../conversations/store.ts";
import type { Business, ChatLanguage, OutreachSettings } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";

export type OutreachKind = "reminder" | "follow_up" | "feedback" | "offer";
export type Outcome = { status: "sent" | "skipped" | "failed" | "held"; channel?: string; reason?: string };

export const DEFAULT_OUTREACH: OutreachSettings = {
  reminders: true, reminderHours: 24, followUps: false, feedback: false, feedbackHours: 24, offers: false,
  templates: { reminder: null, feedback: null, offer: null, language: "en" },
};

export async function getOutreachSettings(businessId: string): Promise<OutreachSettings> {
  const saved = (await getBusinessSettings(businessId))?.outreach;
  return { ...DEFAULT_OUTREACH, ...(saved ?? {}), templates: { ...DEFAULT_OUTREACH.templates, ...(saved?.templates ?? {}) } };
}

const WINDOW_MS = 24 * 3_600_000;
const base = () => process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
export const unsubscribeLink = (businessId: string, token: string) => `${base()}/u/${encodeURIComponent(businessId)}/${token}`;

type CustomerRow = { id: string; name: string | null; email: string | null; outreach_stopped_at: Date | null; offers_agreed_at: Date | null; unsubscribe_token: string };
export type Reach = { whatsapp: { address: string; sessionId: string; windowOpen: boolean } | null; email: string | null; language: ChatLanguage; firstName: string };

/** How a customer can be reached now, and in which language. */
export async function reachOf(businessId: string, customer: CustomerRow, now = new Date()): Promise<Reach> {
  return inBusiness(async (_db, client) => {
    const { rows: [chat] } = await client.query<{ id: string; customer_address: string; customer_last_message_at: Date | null }>(
      `select id, customer_address, customer_last_message_at from chat_sessions
       where business_id = $1 and customer_id = $2 and channel = 'whatsapp' and customer_address is not null and not preview
       order by last_activity_at desc limit 1`, [businessId, customer.id]);
    const { rows: [latest] } = await client.query<{ language: ChatLanguage }>(
      "select language from chat_sessions where business_id = $1 and customer_id = $2 order by last_activity_at desc limit 1", [businessId, customer.id]);
    return {
      whatsapp: chat ? { address: chat.customer_address, sessionId: chat.id, windowOpen: Boolean(chat.customer_last_message_at && now.getTime() - chat.customer_last_message_at.getTime() < WINDOW_MS - 10 * 60_000) } : null,
      email: customer.email,
      language: latest?.language ?? "en",
      firstName: (customer.name ?? "").trim().split(/\s+/)[0] || "there",
    };
  }, businessId);
}

/** Whether this customer was messaged too recently for another (offers: a week; anything else: a day). */
async function tooSoon(businessId: string, customerId: string, kind: OutreachKind, now: Date): Promise<boolean> {
  if (kind === "reminder") return false;
  return inBusiness(async (_db, client) => {
    const { rows: [row] } = await client.query<{ n: number }>(
      `select count(*)::int as n from outreach_messages where business_id = $1 and customer_id = $2 and status = 'sent'
         and created_at > $3 ${kind === "offer" ? "and kind = 'offer'" : ""}`,
      [businessId, customerId, new Date(now.getTime() - (kind === "offer" ? 7 * 24 : 20) * 3_600_000)]);
    return row.n > 0;
  }, businessId);
}

async function record(businessId: string, input: { customerId: string; kind: OutreachKind; ref: string; campaignId?: string | null; outcome: Outcome; text: string }): Promise<boolean> {
  return inBusiness(async (_db, client) => (await client.query(
    `insert into outreach_messages (business_id, customer_id, kind, ref, campaign_id, status, channel, reason, text)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (business_id, kind, ref) do nothing returning id`,
    [businessId, input.customerId, input.kind, input.ref, input.campaignId ?? null, input.outcome.status, input.outcome.channel ?? null, input.outcome.reason?.slice(0, 300) ?? null, input.text.slice(0, 1000)])).rowCount === 1, businessId);
}

export async function alreadyDone(businessId: string, kind: OutreachKind, ref: string): Promise<boolean> {
  return inBusiness(async (_db, client) => (await client.query("select 1 from outreach_messages where business_id = $1 and kind = $2 and ref = $3", [businessId, kind, ref])).rowCount === 1, businessId);
}

/** Puts a message sent outside the chat (a template, an email) into the WhatsApp chat's history, as already delivered. */
async function intoChat(businessId: string, sessionId: string, text: string, delivered: boolean): Promise<void> {
  const eventId = await appendEvent({ businessId, sessionId, actor: "ZAINA_REASONING", content: text });
  if (delivered) await inBusiness((_db, client) => client.query("update chat_sessions set delivered_event_id = greatest(delivered_event_id, $3) where business_id = $1 and id = $2", [businessId, sessionId, eventId]), businessId);
}

export type Message = {
  kind: OutreachKind;
  ref: string;
  campaignId?: string | null;
  /** The message as written to the customer (English or Swahili, already filled in). */
  text: string;
  /** For an approved WhatsApp template, when the window has closed: which one, and its body's values. */
  template: { key: "reminder" | "feedback" | "offer"; params: string[] } | null;
  email: { subject: string } | null;
};

/** Sends one message to a customer under all the rules; what happened (held: try again on a later run). */
export async function sendOutreach(business: Business, customer: CustomerRow, message: Message, now = new Date()): Promise<Outcome> {
  if (await alreadyDone(business.id, message.kind, message.ref)) return { status: "skipped", reason: "Already done" };
  const done = async (outcome: Outcome) => {
    if (outcome.status !== "held") await record(business.id, { customerId: customer.id, kind: message.kind, ref: message.ref, campaignId: message.campaignId, outcome, text: message.text });
    return outcome;
  };
  if (customer.outreach_stopped_at) return done({ status: "skipped", reason: "They replied STOP" });
  if (message.kind === "offer" && !customer.offers_agreed_at) return done({ status: "skipped", reason: "They haven't said yes to offers" });
  if (await tooSoon(business.id, customer.id, message.kind, now)) return { status: "held", reason: "Messaged recently" };

  const reach = await reachOf(business.id, customer, now);
  const settings = await getOutreachSettings(business.id);
  if (reach.whatsapp?.windowOpen) {
    await appendEvent({ businessId: business.id, sessionId: reach.whatsapp.sessionId, actor: "ZAINA_REASONING", content: message.text });
    void requestDelivery(business.id, reach.whatsapp.sessionId, 0);
    return done({ status: "sent", channel: "whatsapp" });
  }
  if (message.kind === "follow_up") return done({ status: "skipped", reason: "Their WhatsApp window had closed" });
  const templateName = message.template ? settings.templates[message.template.key] : null;
  const ctx: WhatsappContext | null = whatsappRuntime();
  if (reach.whatsapp && templateName && message.template && ctx) {
    const connection = await connectionFor(business.id);
    if (connection) {
      const sent = await sendTemplate({ version: ctx.whatsapp.graphVersion, phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken }, reach.whatsapp.address, {
        name: templateName, language: settings.templates.language || "en", bodyParameter: null, bodyParameters: message.template.params.map((value) => value.slice(0, 900)),
      });
      if (sent.ok) {
        await intoChat(business.id, reach.whatsapp.sessionId, message.text, true);
        return done({ status: "sent", channel: "whatsapp_template" });
      }
      if (!reach.email || message.kind === "offer") return done({ status: "failed", channel: "whatsapp_template", reason: `WhatsApp refused the template: ${sent.title}`.slice(0, 300) });
    }
  }
  if (reach.email && message.email && message.kind !== "offer") {
    const settingsRow = await getBusinessSettings(business.id);
    const name = settingsRow?.displayName ?? business.name;
    await sendCustomerEmail(reach.email, message.email.subject, `${message.text}\n\n— ${name}\n\nDon't want these messages? ${unsubscribeLink(business.id, customer.unsubscribe_token)}`, settingsRow?.supportEmail ?? null);
    return done({ status: "sent", channel: "email" });
  }
  return done({
    status: "skipped",
    reason: reach.whatsapp ? `Their WhatsApp window had closed and there's no approved ${message.template?.key ?? ""} template`.replace("  ", " ") : message.kind === "offer" ? "Offers go by WhatsApp only, and they haven't written on WhatsApp" : "No WhatsApp chat or email to reach them",
  });
}

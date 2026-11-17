// src/outreach/replies.ts
//
// Replies on WhatsApp the server answers itself, before Zaina, so they work
// the same every time:
//
//   STOP (or UNSUBSCRIBE, ACHA)   no more reminders, follow-ups or offers;
//                                 the customer can still write any time
//   START (or ANZA)               reminders and follow-ups again (offers
//                                 need a new yes)
//   1 to 5                        the answer to a feedback request sent in
//                                 the last week; 3 or less tells the team
//
// Each goes into the chat's history with its answer, like any message.

import { requestDelivery } from "../channels/whatsapp/runtime.ts";
import type { InboundMessage } from "../channels/whatsapp/webhook.ts";
import { alertTeam } from "../conversations/team-alerts.ts";
import { appendEvent } from "../conversations/store.ts";
import { customerFor } from "../customers/store.ts";
import type { Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";

const STOP = /^\s*(stop|unsubscribe|acha|sitaki)\s*[.!]*\s*$/i;
const START = /^\s*(start|anza)\s*[.!]*\s*$/i;
const RATING = /^\s*([1-5])\s*(\/\s*5)?\s*[.!]*\s*$/;

/** True when the message was one of these and is answered here (Zaina doesn't see it). */
export async function takeOutreachReply(business: Business, sessionId: string, message: InboundMessage, inboundId: string): Promise<boolean> {
  const text = message.text ?? "";
  const kind = STOP.test(text) ? "stop" : START.test(text) ? "start" : RATING.test(text) ? "rating" : null;
  if (!kind || message.kind !== "text") return false;
  const answer = await inBusiness(async (_db, client) => {
    // WhatsApp proves the number: this is the customer's own record.
    const customerId = await customerFor(client, business.id, { phone: `+${message.from}`, name: message.profileName });
    if (!customerId) return null;
    await client.query("update chat_sessions set customer_id = coalesce(customer_id, $3) where business_id = $1 and id = $2", [business.id, sessionId, customerId]);
    const { rows: [session] } = await client.query<{ language: string }>("select language from chat_sessions where business_id = $1 and id = $2", [business.id, sessionId]);
    const sw = session?.language === "sw";
    if (kind === "stop") {
      await client.query("update customers set outreach_stopped_at = now(), offers_agreed_at = null, updated_at = now() where business_id = $1 and id = $2", [business.id, customerId]);
      return { text: sw ? "Sawa: hutapokea vikumbusho wala matangazo kutoka kwetu. Bado unaweza kutuandikia wakati wowote. Jibu START kuyapata tena." : "Done: you won't get reminders or offers from us. You can still write to us any time. Reply START to get reminders again." };
    }
    if (kind === "start") {
      await client.query("update customers set outreach_stopped_at = null, updated_at = now() where business_id = $1 and id = $2", [business.id, customerId]);
      return { text: sw ? "Karibu tena: utapokea vikumbusho kuhusu nafasi na oda zako." : "Welcome back: you'll get reminders about your bookings and orders again." };
    }
    const { rows: [asked] } = await client.query<{ id: string; ref: string }>(
      `select id, ref from outreach_messages where business_id = $1 and customer_id = $2 and kind = 'feedback' and status = 'sent'
         and channel like 'whatsapp%' and rating is null and created_at > now() - interval '7 days' order by created_at desc limit 1`, [business.id, customerId]);
    if (!asked) return null;
    const rating = Number(RATING.exec(text)![1]);
    await client.query("update outreach_messages set rating = $3, rated_at = now() where business_id = $1 and id = $2", [business.id, asked.id, rating]);
    return { text: rating >= 4 ? (sw ? "Asante sana! Tunafurahi kukuhudumia." : "Thank you! We're glad you enjoyed it.") : (sw ? "Asante kwa kutuambia. Mtu wa timu yetu atawasiliana nawe." : "Thank you for telling us. Someone from the team will get in touch."), rating, ref: asked.ref, customerId };
  }, business.id);
  if (!answer) return false;
  await appendEvent({ businessId: business.id, sessionId, actor: "USER", content: text });
  await appendEvent({ businessId: business.id, sessionId, actor: "ZAINA_REASONING", content: answer.text });
  await inBusiness((_db, client) => client.query("update whatsapp_inbound set status = 'done', processed_at = now(), body = null where business_id = $1 and id = $2", [business.id, inboundId]), business.id);
  void requestDelivery(business.id, sessionId, 0);
  if ("rating" in answer && answer.rating !== undefined && answer.rating <= 3) {
    // A low rating is for the team to follow up, like any request.
    const lead = await inBusiness(async (_db, client) => (await client.query<{ id: number }>(
      `insert into leads (business_id, session_id, kind, name, phone, interest, customer_id)
       values ($1, $2, 'request', coalesce((select name from customers where id = $5), 'WhatsApp customer'), $3, $4, $5) returning id`,
      [business.id, sessionId, `+${message.from}`, `Rated their ${answer.ref.startsWith("order:") ? "order" : "visit"} ${answer.rating}/5: please get in touch`, answer.customerId])).rows[0], business.id);
    void alertTeam(business, { kind: "lead", leadId: lead.id, sessionId, summary: `A customer rated their ${answer.ref.startsWith("order:") ? "order" : "visit"} ${answer.rating} out of 5.` } as any).catch(() => {});
  }
  return true;
}

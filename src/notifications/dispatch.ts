// src/notifications/dispatch.ts
//
// Emailing a business's added addresses (notification_recipients) when
// something happens in its chats: a customer waiting (with a link to open the
// chat and take over), a callback to make, a new lead, a booking, a chat
// closed. Each address gets what it chose: the alert, the conversation written
// out, or both, in one email. Only as many addresses as the plan allows are
// emailed (the oldest first), so a business that moved to a smaller plan
// doesn't keep what it no longer pays for.

import { inBusiness } from "../db/tenant.ts";
import type { Business } from "../db/schema.ts";
import { sendEmail } from "../platform/mailer.ts";
import { notificationAllowance, recipientsOf, type Recipient } from "./store.ts";

export type RecipientAlert = { title: string; body: string; sessionId: string | null; bookingId?: string; leadId?: number; orderId?: string; takeover: boolean };

const WHO: Record<string, string> = { USER: "Customer", ZAINA_REASONING: "", AGENT: "Team" };
const MAX_LINES = 80;
const MAX_CHARS = 14_000;

/** The conversation written out, the way the team reads it: who said what, and when. */
export async function conversationText(businessId: string, sessionId: string, assistant: string, timeZone: string): Promise<string> {
  const rows = await inBusiness(async (_db, client) => (await client.query<{ actor: string; content: string; created_at: Date }>(
    `select actor, content, created_at from chat_events
     where business_id = $1 and session_id = $2 and actor in ('USER', 'ZAINA_REASONING', 'AGENT') and content is not null and btrim(content) <> ''
     order by id`,
    [businessId, sessionId],
  )).rows, businessId);
  if (!rows.length) return "";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const lines = rows.slice(-MAX_LINES).map((row) => `${WHO[row.actor] || assistant} · ${time.format(row.created_at)}\n${row.content.trim()}`);
  const text = lines.join("\n\n");
  const cut = text.length > MAX_CHARS ? `…${text.slice(-MAX_CHARS)}` : text;
  return `${rows.length > MAX_LINES || text.length > MAX_CHARS ? "(The start of the conversation is left out.)\n\n" : ""}${cut}`;
}

/** The email one address gets for an alert: what it chose, with a link to the chat. */
export function recipientEmail(recipient: Recipient, input: { business: string; alert: RecipientAlert; link: string | null; conversation: string }): { subject: string; text: string } {
  const { alert } = input;
  const parts: string[] = [];
  if (recipient.notifyAlerts || !input.conversation) {
    parts.push(alert.body);
    if (input.link) parts.push(`${alert.takeover ? "Take over this chat" : alert.bookingId ? "Open the booking" : alert.orderId ? "Open the order" : alert.leadId ? "Open your leads" : "Open the chat"}: ${input.link}`);
  } else {
    parts.push(alert.body);
  }
  if (recipient.sendTranscripts && input.conversation) parts.push(`The conversation\n──────────────\n${input.conversation}`);
  parts.push(`You get this because ${input.business} added ${recipient.email} to its notification emails. To stop, ask the person who manages Zaina for ${input.business} to remove it (Settings → Notifications).`);
  return { subject: `[${input.business}] ${alert.title}`, text: parts.join("\n\n") };
}

/** Emails the business's added addresses about an event. Never throws. */
export async function notifyRecipients(business: Business, businessName: string, assistant: string, alert: RecipientAlert, link: string | null): Promise<number> {
  try {
    const { limit } = await notificationAllowance(business);
    const all = (await recipientsOf(business.id)).slice(0, limit);
    // A closed chat is only for those who asked for transcripts.
    const wanted = alert.title === "Conversation closed" ? all.filter((row) => row.sendTranscripts) : all;
    if (!wanted.length) return 0;
    const conversation = wanted.some((row) => row.sendTranscripts) && alert.sessionId
      ? await conversationText(business.id, alert.sessionId, assistant, business.timeZone)
      : "";
    let sent = 0;
    for (const recipient of wanted) {
      const email = recipientEmail(recipient, { business: businessName, alert, link, conversation });
      if (await sendEmail({ to: recipient.email, ...email })) sent += 1;
    }
    return sent;
  } catch (error) {
    console.error(`[notifications] ${business.id} recipient emails failed:`, error);
    return 0;
  }
}

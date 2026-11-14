// src/leads/extra-tools.ts
//
// Two things a good receptionist does instead of saying "no" or "call back
// later", for every business:
//
//   pass_request_to_team   the customer wants something the business
//                          doesn't list (an event, a custom order, a special
//                          arrangement): their request and details go to the
//                          team, who decide
//   schedule_callback      the customer wants a call at a time they choose:
//                          the team sees it in Leads and is reminded when
//                          it's due
//
// Both are leads (kind request or callback), so they sit with the rest in
// Leads. Only details the customer typed are kept.

import { Type, type FunctionDeclaration } from "@google/genai";
import { and, eq, isNull, lte } from "drizzle-orm";
import { everyBusiness } from "../businesses/registry.ts";
import { slotTime } from "../booking/notices.ts";
import { TIME_PATTERN, zonedInstant } from "../booking/local-time.ts";
import { alertTeam } from "../conversations/team-alerts.ts";
import { customerMessages } from "../conversations/store.ts";
import { leads, type Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { addExtras, type ExtraContext, type ExtraTool } from "../engine/extras.ts";
import { resolveCustomerContact, sharesPhoneNumber, textArg } from "../engine/tool-args.ts";

export const PASS_REQUEST = "pass_request_to_team";
export const SCHEDULE_CALLBACK = "schedule_callback";

const requestDeclaration: FunctionDeclaration = {
  name: PASS_REQUEST,
  description: "Pass the team a request for something the business doesn't list or your tools can't do (an event, a custom order, a special arrangement, a product or service not in the information). Use it instead of saying no. Only with details the customer typed.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "The customer's name exactly as they typed it." },
      phone: { type: Type.STRING, description: "Their phone number exactly as they typed it." },
      email: { type: Type.STRING, description: "Their email exactly as they typed it, if they gave one." },
      request: { type: Type.STRING, description: "What exactly they want, in a sentence or two." },
      when: { type: Type.STRING, description: "When they need it, in their words, if they said." },
      budget: { type: Type.STRING, description: "Their budget in their words, if they said. Never your own figure." },
    },
    required: ["name", "request"],
  },
};

const callbackDeclaration: FunctionDeclaration = {
  name: SCHEDULE_CALLBACK,
  description: "Arrange for the team to phone the customer at a time they choose. Work out the date and time on the business's clock from the turn context; if they gave only a rough time (\"tomorrow morning\"), pass it as when_text and leave date and time empty.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "The customer's name exactly as they typed it." },
      phone: { type: Type.STRING, description: "The number to call, exactly as they typed it." },
      date: { type: Type.STRING, description: "The day, YYYY-MM-DD, on the business's clock." },
      time: { type: Type.STRING, description: "The time, HH:MM in 24 hours, on the business's clock." },
      when_text: { type: Type.STRING, description: "When they want the call, in their words." },
      topic: { type: Type.STRING, description: "What the call is about, in a few words." },
    },
    required: ["name", "phone"],
  },
};

/** The customer's name, and a phone (and email) they typed themselves; or what to ask for. */
async function contactOf(args: any, sessionId: string, needPhone: boolean) {
  const typed = await customerMessages(sessionId);
  const name = textArg(args?.name);
  const phone = textArg(args?.phone);
  const phoneTyped = phone && sharesPhoneNumber(phone, typed.join("\n")) ? phone : null;
  const contact = resolveCustomerContact({ name, email: args?.email, phone }, typed);
  const nameMissing = !contact.ok && contact.missing.includes("name");
  if (nameMissing || (needPhone ? !phoneTyped : !phoneTyped && !contact.ok)) {
    return {
      ok: false as const,
      error: "customer_contact_required",
      tell_customer: nameMissing
        ? `Happy to arrange that. May I have your name${needPhone ? " and the number to call" : ", and a phone number or email for the team"}?`
        : needPhone ? "What's the best number for the team to call?" : "What's the best phone number or email for the team to reach you on?",
    };
  }
  return { ok: true as const, name: contact.ok ? contact.name : name, email: contact.ok ? contact.email : null, phone: phoneTyped };
}

async function passRequest(args: any, context: ExtraContext) {
  const request = textArg(args?.request).slice(0, 500);
  if (request.length < 3) return { ok: false, error: "request_required", message: "Ask what exactly they'd like." };
  const contact = await contactOf(args, context.sessionId, false);
  if (!contact.ok) return contact;
  const when = textArg(args?.when).slice(0, 120);
  const budget = textArg(args?.budget).slice(0, 120);
  const notes = [when && `When: ${when}`, budget && `Budget: ${budget} (the customer's words)`].filter(Boolean).join("\n") || null;
  const [row] = await inBusiness((db) => db.insert(leads).values({
    businessId: context.business.id, sessionId: context.sessionId, kind: "request",
    name: contact.name, email: contact.email, phone: contact.phone, interest: request, notes,
  }).returning({ id: leads.id }), context.business.id);
  void alertTeam(context.business, { kind: "lead", leadId: row.id, sessionId: context.sessionId, title: "A request for something you don't list", summary: `${contact.name} asks: ${request}${when ? ` (${when})` : ""}.`.slice(0, 300) })
    .catch((error) => console.error("[leads] request alert failed:", error));
  return { ok: true, lead_id: row.id, next_step: "Tell the customer you've passed their request to the team, who will get back to them. Don't promise it can be done, a price or a time." };
}

async function scheduleCallback(args: any, context: ExtraContext) {
  const contact = await contactOf(args, context.sessionId, true);
  if (!contact.ok) return contact;
  const { business } = context;
  const date = textArg(args?.date);
  const time = textArg(args?.time);
  const whenText = textArg(args?.when_text).slice(0, 120);
  let callAt: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && TIME_PATTERN.test(time)) {
    const instant = zonedInstant(date, time, business.timeZone);
    const ahead = instant.getTime() - Date.now();
    if (ahead < -5 * 60_000) return { ok: false, error: "time_in_the_past", message: "That time has passed on the business's clock: ask for another." };
    if (ahead > 30 * 24 * 60 * 60_000) return { ok: false, error: "too_far_ahead", message: "Callbacks are arranged up to 30 days ahead: ask for a nearer time." };
    callAt = instant;
  }
  if (!callAt && !whenText) return { ok: false, error: "when_required", message: "Ask when they'd like the call." };
  const topic = textArg(args?.topic).slice(0, 200) || null;
  const [row] = await inBusiness((db) => db.insert(leads).values({
    businessId: business.id, sessionId: context.sessionId, kind: "callback",
    name: contact.name, email: contact.email, phone: contact.phone, interest: topic,
    callbackAt: callAt, callbackWindow: whenText || null,
  }).returning({ id: leads.id }), business.id);
  const when = callAt ? slotTime(callAt, business.timeZone) : whenText;
  void alertTeam(business, { kind: "lead", leadId: row.id, sessionId: context.sessionId, title: "A customer wants a call back", summary: `Call ${contact.name} on ${contact.phone} ${callAt ? "on" : ""} ${when}${topic ? ` about ${topic}` : ""}.`.replace(/\s+/g, " ").slice(0, 300) })
    .catch((error) => console.error("[leads] callback alert failed:", error));
  return { ok: true, lead_id: row.id, call_at: when, next_step: `Tell the customer the team will call them ${callAt ? "on" : ""} ${when}. Don't promise a particular person.`.replace(/\s+/g, " ") };
}

const TOOLS: ExtraTool[] = [
  { declaration: requestDeclaration, readOnly: false, run: passRequest },
  { declaration: callbackDeclaration, readOnly: false, run: scheduleCallback },
];

const GUIDANCE = `\n\nWhen the answer is "we don't do that" or "not through me":
- If the customer wants something the business doesn't list or your tools can't do, don't stop at no: offer to pass their request to the team (${PASS_REQUEST}) with their name and number. Never promise it can be done.
- If they'd like a phone call at a particular time, arrange it (${SCHEDULE_CALLBACK}) with the date and time on the business's clock.`;

export function registerLeadExtras(): void {
  addExtras(async (_business: Business) => ({ prompt: GUIDANCE, tools: TOOLS }));
}

/** Reminds the team of callbacks that are due within five minutes (once each). Never throws. */
export async function sweepCallbacks(now = new Date()): Promise<number> {
  let reminded = 0;
  for (const business of await everyBusiness()) {
    if (business.status === "paused") continue;
    try {
      const due = await inBusiness((db) => db.update(leads)
        .set({ callbackRemindedAt: now })
        .where(and(eq(leads.businessId, business.id), eq(leads.kind, "callback"), eq(leads.status, "new"), isNull(leads.callbackRemindedAt), lte(leads.callbackAt, new Date(now.getTime() + 5 * 60_000))))
        .returning({ id: leads.id, name: leads.name, phone: leads.phone, interest: leads.interest, callbackAt: leads.callbackAt, sessionId: leads.sessionId }), business.id);
      for (const lead of due) {
        reminded += 1;
        void alertTeam(business, { kind: "lead", leadId: lead.id, sessionId: lead.sessionId, title: `Time to call ${lead.name}`, urgent: true, summary: `${lead.name} asked for a call ${lead.callbackAt ? slotTime(lead.callbackAt, business.timeZone) : "now"} on ${lead.phone ?? "their number"}${lead.interest ? ` about ${lead.interest}` : ""}.`.slice(0, 300) })
          .catch((error) => console.error("[leads] callback reminder failed:", error));
      }
    } catch (error) {
      console.error(`[leads] ${business.id} callback sweep failed:`, error);
    }
  }
  return reminded;
}


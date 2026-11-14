// src/studio/requests.ts
//
// A request from the website's "Book" buttons (/start): someone wants a
// Zaina plan or a project. It is saved with the studio's own leads, so the
// studio's team sees it in its dashboard (Leads) next to the leads its Zaina
// takes, follows it up there, and is alerted the way it is for any lead.

import { anyBusinessById } from "../businesses/registry.ts";
import { alertTeam } from "../conversations/team-alerts.ts";
import { leads } from "../db/schema.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { sendEmail } from "../platform/mailer.ts";
import { STUDIO } from "./brand.ts";
import { requestTopic } from "./services.ts";

export type ProjectRequest = { name: string; business: string; phone: string; email: string; topic: string; details: string };
export type RequestProblems = Partial<Record<keyof ProjectRequest, string>>;

const line = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** What the form sent, tidied; and what's wrong with it, by field. */
export function readRequest(body: any): { value: ProjectRequest; problems: RequestProblems } {
  const value: ProjectRequest = {
    name: line(body?.name, 120),
    business: line(body?.business, 120),
    phone: line(body?.phone, 30),
    email: line(body?.email, 200).toLowerCase(),
    topic: requestTopic(body?.service)?.id ?? "",
    details: typeof body?.details === "string" ? body.details.replace(/\r\n?/g, "\n").trim().slice(0, 2000) : "",
  };
  const problems: RequestProblems = {};
  if (value.name.length < 2) problems.name = "Please tell us your name.";
  const phoneOk = /^\+?[\d\s()-]{9,20}$/.test(value.phone) && value.phone.replace(/\D/g, "").length >= 9;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value.email);
  if (value.phone && !phoneOk) problems.phone = "That phone number doesn't look right. Include the country code, like +254 7…";
  if (value.email && !emailOk) problems.email = "That email address doesn't look right.";
  if (!value.phone && !value.email) problems.phone = "Give a WhatsApp or phone number, or an email, so we can reach you.";
  if (!value.topic) problems.topic = "Choose what you'd like to start.";
  if (value.details.length < 10) problems.details = "Tell us a little about what you need (a sentence or two is enough).";
  return { value, problems };
}

/** Saves the request with the studio's leads and tells the studio's team. The lead's number. */
export async function saveRequest(request: ProjectRequest, notifyEmail: string | null): Promise<number> {
  const topic = requestTopic(request.topic)!;
  const notes = [request.business ? `Business: ${request.business}` : null, request.details, "Sent from the website's request form."].filter(Boolean).join("\n\n");
  const [row] = await runForBusiness(STUDIO.businessId, () => inBusiness((db) => db.insert(leads).values({
    businessId: STUDIO.businessId,
    sessionId: null,
    name: request.name,
    email: request.email || null,
    phone: request.phone || null,
    interest: topic.label,
    notes,
  }).returning({ id: leads.id }), STUDIO.businessId));
  const summary = `${request.name}${request.business ? ` (${request.business})` : ""} wants: ${topic.label}`;
  const business = await anyBusinessById(STUDIO.businessId);
  if (business) void alertTeam(business, { kind: "lead", leadId: row.id, sessionId: null, summary }).catch((error) => console.error("[studio] request alert failed:", error));
  if (notifyEmail) {
    void sendEmail({
      to: notifyEmail,
      subject: `New request: ${summary}`,
      text: [`${request.name}${request.business ? `, ${request.business}` : ""}`, request.phone ? `Phone: ${request.phone}` : null, request.email ? `Email: ${request.email}` : null, "", `Wants: ${topic.label}`, "", request.details, "", "It's in the dashboard under Leads."].filter((part) => part !== null).join("\n"),
    });
  }
  return row.id;
}

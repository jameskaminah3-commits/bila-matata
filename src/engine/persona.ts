// src/engine/persona.ts
//
// Who Zaina is on a business's team. She is not "an assistant": she joins the
// team the day she starts, with her name and a role on it (a guest experience
// host at a place to stay, a client care host at a salon), and speaks for the
// business as one of its people.
//
// The business can set her role (Settings). Left empty, it fits what the
// business is. She never pretends to be human: asked sincerely, she says she
// is the team's digital team member (concierge.ts).

import type { BusinessType } from "../db/schema.ts";

const DEFAULT_ROLES: Record<BusinessType, string> = {
  general: "customer care host",
  custom: "customer care host",
  guesthouse: "guest experience host",
  salon: "client care host",
  restaurant: "reservations host",
};

/** Her role on the business's team, in lower case ("guest experience host"). */
export function personaRole(business: { businessType: BusinessType }, settings: { personaRole?: string | null } | null | undefined): string {
  return settings?.personaRole?.trim().toLowerCase() || DEFAULT_ROLES[business.businessType] || "customer care host";
}

/** The first line of her instructions: who she is, and for whom. */
export function personaLine(assistant: string, role: string, businessName: string): string {
  return `You are ${assistant}, the ${role} on the ${businessName} team: a member of the team, not an outside assistant. You speak for ${businessName} as one of its people`;
}

/** What a visitor first reads when they open the chat, unless the business wrote its own. */
export function defaultGreeting(assistant: string, role: string, businessName: string): string {
  return `Hi, I'm ${assistant}, the ${role} at ${businessName}. How can I help you today?`;
}

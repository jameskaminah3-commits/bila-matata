// src/capabilities/of-business.ts
//
// A business's capabilities and what they mean for its offerings, read from
// its settings (cached briefly with them).

import { getBusinessSettings } from "../businesses/settings.ts";
import type { Business, Offering, OfferingKind } from "../db/schema.ts";
import { bookingModules, capabilitiesOf, type BookingModules, type Capability } from "./catalog.ts";

export async function businessCapabilities(business: Pick<Business, "id" | "businessType">): Promise<{ enabled: Capability[]; chosen: boolean }> {
  const settings = await getBusinessSettings(business.id);
  return { enabled: capabilitiesOf(business, settings), chosen: Boolean(settings?.capabilities) };
}

export async function businessBookingModules(business: Pick<Business, "id" | "businessType" | "tier">): Promise<BookingModules> {
  return bookingModules(business, (await businessCapabilities(business)).enabled);
}

/**
 * The time-slot kinds Zaina lists and books for a business: those of the
 * capabilities it switched on. A business that hasn't chosen keeps both, as
 * before (a salon's services, a restaurant's tables).
 */
export async function slotKindsOf(business: Pick<Business, "id" | "businessType">): Promise<Array<"service" | "table">> {
  const { enabled, chosen } = await businessCapabilities(business);
  if (!chosen) return ["service", "table"];
  return [...(enabled.includes("appointments") ? (["service"] as const) : []), ...(enabled.includes("tables") ? (["table"] as const) : [])];
}

/** Only the room types: a business's other offerings (a spa treatment, a table) are never offered as rooms. */
export const roomTypesOf = (offerings: Offering[]) => offerings.filter((offering) => offering.kind === "room_type");

export const ofKinds = (offerings: Offering[], kinds: readonly OfferingKind[]) => offerings.filter((offering) => kinds.includes(offering.kind));

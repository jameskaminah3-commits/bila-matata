// src/capabilities/catalog.ts
//
// What a business does through Zaina, in pieces it can combine. A hotel can
// take room bookings, table reservations and spa appointments, and arrange
// airport transfers; a salon takes appointments; a shop takes orders.
//
// The shared core (businesses, staff and their roles, customers' chats,
// bookings, payments, leads) is the same for every business. Each capability
// belongs to a module that knows how that kind of thing is sold:
//
//   stays          rooms booked by the night (offerings of kind room_type)
//   dining         tables booked for a time and a party (kind table)
//   appointments   services booked for a time (kind service)
//   arranged       things the team arranges: Zaina quotes the price list and
//                  passes the request on (transfers, activities, orders, jobs)
//
// Zaina gets the tools of the modules a business has switched on, and the
// business's own rules for them (policies.ts). What a business sells, and
// its rules, are its own: nothing here is a default policy.

import { type Business, type BusinessSettings, type BusinessType, type OfferingKind } from "../db/schema.ts";
import type { Industry } from "../engine/playbooks.ts";

export const capabilityKeys = ["rooms", "tables", "appointments", "transfers", "activities", "orders", "quotes"] as const;
export type Capability = (typeof capabilityKeys)[number];
export type CapabilityModule = "stays" | "dining" | "appointments" | "arranged";

export type CapabilityInfo = {
  label: string;
  /** For the owner choosing: what switching it on means. */
  what: string;
  module: CapabilityModule;
  /** The offerings this capability books on the platform. */
  offeringKind?: OfferingKind;
  /** For Zaina: what the team needs to arrange one (arranged capabilities). */
  details?: string;
  /** Industries it is usually part of: offered first in setup, never switched on by itself. */
  usualFor: Industry[];
};

export const CAPABILITIES: Record<Capability, CapabilityInfo> = {
  rooms: {
    label: "Rooms and stays",
    what: "Guests book rooms by the night: Zaina checks what's free, gives the exact total and books.",
    module: "stays",
    offeringKind: "room_type",
    usualFor: ["stays"],
  },
  tables: {
    label: "Table reservations",
    what: "Guests book a table for a time and a party size.",
    module: "dining",
    offeringKind: "table",
    usualFor: ["restaurant", "stays"],
  },
  appointments: {
    label: "Appointments",
    what: "Clients book a service for a time: a spa treatment, a haircut, a consultation.",
    module: "appointments",
    offeringKind: "service",
    usualFor: ["salon", "clinic", "services", "stays"],
  },
  transfers: {
    label: "Airport and SGR transfers",
    what: "Zaina quotes your listed transfer prices and passes each request to your team to arrange.",
    module: "arranged",
    details: "the date, the flight or train time, where from and to, how many people and bags",
    usualFor: ["stays"],
  },
  activities: {
    label: "Tours and activities",
    what: "Zaina quotes your listed activities and passes each request to your team to arrange.",
    module: "arranged",
    details: "the activity, the date, how many people, and where to pick them up",
    usualFor: ["stays", "other"],
  },
  orders: {
    label: "Orders and delivery",
    what: "Customers order products or food; Zaina takes the order details for your team to confirm.",
    module: "arranged",
    details: "what they want and how many, delivery or collection, the area and the time",
    usualFor: ["shop", "restaurant"],
  },
  quotes: {
    label: "Jobs you quote",
    what: "Zaina collects what your team needs to quote a job and passes it on.",
    module: "arranged",
    details: "what the job is, where, when, and how big",
    usualFor: ["services"],
  },
};

export const isCapability = (value: unknown): value is Capability => capabilityKeys.includes(value as Capability);

/** What a business's settings keep: the capabilities it switched on. */
export type CapabilitySettings = { enabled: Capability[]; updatedAt: string };

/** Before a business chooses, its capabilities follow from its type, so it works as it always has. */
export function capabilitiesFromType(type: BusinessType): Capability[] {
  return type === "guesthouse" ? ["rooms"] : type === "salon" ? ["appointments"] : type === "restaurant" ? ["tables"] : [];
}

const MAIN: Record<Industry, Capability | null> = {
  stays: "rooms", restaurant: "tables", salon: "appointments", clinic: "appointments", shop: "orders", services: "quotes", other: null,
};

/**
 * The capability a business of an industry is mainly set up with (a hotel's
 * rooms): suggested in setup, never switched on by itself. The others usual
 * for it (a restaurant, a spa, transfers) are offered, not assumed.
 */
export function usualCapabilities(industry: Industry): Capability[] {
  const main = MAIN[industry];
  return main ? [main] : [];
}

/** A business's capabilities: those it chose, or those its type has always meant. In catalog order. */
export function capabilitiesOf(business: Pick<Business, "businessType">, settings: Pick<BusinessSettings, "capabilities"> | null | undefined): Capability[] {
  const chosen = settings?.capabilities?.enabled;
  const list = Array.isArray(chosen) ? chosen.filter(isCapability) : capabilitiesFromType(business.businessType);
  return capabilityKeys.filter((key) => list.includes(key));
}

/** Cleans a list of capabilities sent by staff. */
export function cleanCapabilities(input: unknown): { ok: true; value: Capability[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length > capabilityKeys.length) return { ok: false, error: `enabled lists capabilities: ${capabilityKeys.join(", ")}` };
  const unknown = input.find((key) => !isCapability(key));
  if (unknown !== undefined) return { ok: false, error: `${String(unknown)} isn't a capability (${capabilityKeys.join(", ")})` };
  return { ok: true, value: capabilityKeys.filter((key) => input.includes(key)) };
}

export type BookingModules = {
  /** Rooms booked by the night, on the platform. */
  rooms: boolean;
  /** The time-slot kinds booked on the platform: services and/or tables. */
  slotKinds: Array<"service" | "table">;
};

/**
 * What a business books on the platform. On the Starter plan nothing is
 * booked here: Zaina answers, quotes the price list and takes requests
 * (bookings are what Full adds), whatever the business offers.
 */
export function bookingModules(business: Pick<Business, "businessType" | "tier">, capabilities: Capability[]): BookingModules {
  if (business.businessType === "custom" || business.tier === "starter") return { rooms: false, slotKinds: [] };
  return {
    rooms: capabilities.includes("rooms"),
    slotKinds: [
      ...(capabilities.includes("appointments") ? (["service"] as const) : []),
      ...(capabilities.includes("tables") ? (["table"] as const) : []),
    ],
  };
}

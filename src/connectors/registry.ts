// src/connectors/registry.ts
//
// Which connector serves which business. The server registers the connectors
// it runs at start-up (TBM's, when TBM's database is configured); tests
// register scripted ones. Any other business gets the platform's own
// connector for what it books here (its capabilities and plan): rooms
// (hospitality), services or tables (appointments), both (a hotel with a
// restaurant or a spa), or nothing booked here, answering from its settings
// and taking leads for its team (basic).

import { businessBookingModules } from "../capabilities/of-business.ts";
import type { Business } from "../db/schema.ts";
import { platformConnectorFor } from "./platform/index.ts";
import type { BusinessConnector } from "./types.ts";

const connectors = new Map<string, BusinessConnector>();
// Businesses that must have their own connector (TBM): never the basic one.
const expected = new Set<string>();

/** Marks a business as needing its own connector: without it, its chats fail instead of falling back. */
export function expectConnector(businessId: string): void {
  expected.add(businessId);
}

export function registerConnector(businessId: string, connector: BusinessConnector): void {
  connectors.set(businessId, connector);
}

export function hasConnector(businessId: string): boolean {
  return connectors.has(businessId);
}

export async function connectorFor(business: Pick<Business, "id" | "businessType"> & Partial<Pick<Business, "tier">>): Promise<BusinessConnector> {
  const connector = connectors.get(business.id);
  if (connector) return connector;
  if (expected.has(business.id)) throw new Error(`The connector for "${business.id}" isn't configured on this server`);
  // On the Starter tier there are no booking tools: Zaina answers, quotes the price list and takes requests.
  if (business.tier === "starter" || business.businessType === "custom") return platformConnectorFor({ rooms: false, slotKinds: [] });
  return platformConnectorFor(await businessBookingModules({ id: business.id, businessType: business.businessType, tier: business.tier ?? "full" }));
}

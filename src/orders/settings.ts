// src/orders/settings.ts
//
// How a business takes orders (business_settings.order_settings, migration
// 0032). Every value is the business's own choice; until it chooses, orders
// are collected only (no delivery zones yet), confirmed once paid, and an
// unpaid order keeps its stock for 30 minutes.
//
//   delivery, zones      delivery only to the zones it lists, each with its
//                        fee (0: free); the fee is added to the order by the
//                        server, never by the model
//   collection           customers may collect, at the collection point
//   minimumMinor         the smallest order it takes (0: none)
//   payOnDelivery        customers may pay cash or M-Pesa on delivery or
//                        collection instead of paying online first
//   confirm              auto: confirmed once paid (or chosen to pay on
//                        delivery); team: the team accepts each order first
//   holdMinutes          how long an unpaid order keeps its stock

import { toMinor } from "../booking/money.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import type { OrderSettings } from "../db/schema.ts";

export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  delivery: false,
  zones: [],
  collection: true,
  collectionPoint: null,
  minimumMinor: 0,
  payOnDelivery: false,
  confirm: "auto",
  holdMinutes: 30,
};

export async function getOrderSettings(businessId: string): Promise<OrderSettings> {
  const saved = (await getBusinessSettings(businessId))?.orderSettings;
  return { ...DEFAULT_ORDER_SETTINGS, ...(saved ?? {}) };
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Checks settings the team sent (amounts in major units: "300"); returns them or the first problem. */
export function validateOrderSettings(input: Record<string, unknown>, current: OrderSettings): { ok: true; value: OrderSettings } | { ok: false; error: string } {
  const next: OrderSettings = { ...current };
  if ("delivery" in input) {
    if (typeof input.delivery !== "boolean") return { ok: false, error: "delivery is true or false." };
    next.delivery = input.delivery;
  }
  if ("zones" in input) {
    if (!Array.isArray(input.zones) || input.zones.length > 40) return { ok: false, error: "zones is a list of up to 40 areas." };
    const zones: OrderSettings["zones"] = [];
    for (const raw of input.zones as Array<Record<string, unknown>>) {
      const name = clean(raw?.name, 80);
      const fee = toMinor(raw?.fee ?? 0);
      if (!name) return { ok: false, error: "Each delivery area needs a name, like \"CBD\" or \"Westlands\"." };
      if (fee === null) return { ok: false, error: `The delivery fee for ${name}, like 200 (0 for free).` };
      if (zones.some((zone) => zone.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `${name} is listed twice.` };
      zones.push({ name, feeMinor: fee });
    }
    next.zones = zones;
  }
  if ("collection" in input) {
    if (typeof input.collection !== "boolean") return { ok: false, error: "collection is true or false." };
    next.collection = input.collection;
  }
  if ("collection_point" in input) next.collectionPoint = clean(input.collection_point, 200) || null;
  if ("minimum" in input) {
    const minimum = input.minimum === null || input.minimum === "" ? 0 : toMinor(input.minimum);
    if (minimum === null) return { ok: false, error: "The smallest order, like 500 (0 for none)." };
    next.minimumMinor = minimum;
  }
  if ("pay_on_delivery" in input) {
    if (typeof input.pay_on_delivery !== "boolean") return { ok: false, error: "pay_on_delivery is true or false." };
    next.payOnDelivery = input.pay_on_delivery;
  }
  if ("confirm" in input) {
    if (input.confirm !== "auto" && input.confirm !== "team") return { ok: false, error: "confirm is auto or team." };
    next.confirm = input.confirm;
  }
  if ("hold_minutes" in input) {
    const minutes = Number(input.hold_minutes);
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 1440) return { ok: false, error: "An unpaid order keeps its stock for 10 to 1,440 minutes." };
    next.holdMinutes = minutes;
  }
  if (next.delivery && !next.zones.length) return { ok: false, error: "Add the areas you deliver to, each with its fee (0 for free)." };
  if (!next.delivery && !next.collection) return { ok: false, error: "Offer delivery, collection, or both." };
  return { ok: true, value: next };
}

export const publicOrderSettings = (settings: OrderSettings) => ({
  delivery: settings.delivery,
  zones: settings.zones.map((zone) => ({ name: zone.name, fee: zone.feeMinor / 100 })),
  collection: settings.collection,
  collection_point: settings.collectionPoint,
  minimum: settings.minimumMinor / 100,
  pay_on_delivery: settings.payOnDelivery,
  confirm: settings.confirm,
  hold_minutes: settings.holdMinutes,
});

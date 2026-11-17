// src/orders/tool.ts
//
// place_order: a customer orders from the business's own catalogue (its price
// list) through Zaina, for a business that takes orders and has no system of
// its own connected for them. Each line is an item the catalogue lists (by its
// id from get_prices), in stock, with a quantity; the server adds up the total
// from the catalogue's prices (never the model), or says the team confirms it
// when a price is a range. Delivery or collection, the area and the time are
// the customer's words. The order is a lead of kind "order" the team confirms;
// the customer pays the business directly, as the team tells them. Zaina never
// collects money.

import { randomBytes } from "node:crypto";
import { Type, type FunctionDeclaration } from "@google/genai";
import { formatMoney } from "../booking/money.ts";
import { businessCapabilities } from "../capabilities/of-business.ts";
import { alertTeam } from "../conversations/team-alerts.ts";
import { leads, type Business, type OrderDetails, type PriceItem } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { addExtras, type ExtraContext, type ExtraTool } from "../engine/extras.ts";
import { textArg } from "../engine/tool-args.ts";
import { liveIntegration } from "../integrations/store.ts";
import { contactOf } from "../leads/extra-tools.ts";
import { getPriceItem, priceText } from "../prices/price-list.ts";

export const PLACE_ORDER = "place_order";
const MAX_LINES = 30;

export const placeOrderDeclaration: FunctionDeclaration = {
  name: PLACE_ORDER,
  description:
    "Place the customer's order from the business's catalogue, once they've confirmed the items, how many, delivery or collection, and their name and phone. " +
    "The team confirms it and tells them how to pay; you never take payment.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      items: {
        type: Type.ARRAY,
        description: "What they're ordering.",
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING, description: "The item's id from get_prices." },
            quantity: { type: Type.INTEGER, description: "How many." },
          },
          required: ["id", "quantity"],
        },
      },
      fulfilment: { type: Type.STRING, enum: ["delivery", "collection"], description: "Delivered to them, or they collect it." },
      area: { type: Type.STRING, description: "For delivery: where to, in the customer's words." },
      when: { type: Type.STRING, description: "When they'd like it, in the customer's words." },
      name: { type: Type.STRING, description: "The customer's name exactly as they typed it." },
      phone: { type: Type.STRING, description: "Their phone number exactly as they typed it." },
      email: { type: Type.STRING, description: "Their email, if they gave one." },
      notes: { type: Type.STRING, description: "Anything else they asked for, in their words." },
    },
    required: ["items"],
  },
};

const reference = () => `ORD-${randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`;

export type OrderLineInput = { id: string; quantity: number };

/** The order's lines from the catalogue, and its total when every price is fixed; or what's wrong. */
export function priceOrder(lines: Array<{ item: PriceItem; quantity: number }>):
  { ok: true; lines: OrderDetails["lines"]; currency: string; totalMinor: number | null; totalText: string } | { ok: false; error: string; message: string } {
  const currencies = new Set(lines.map((line) => line.item.currency));
  if (currencies.size > 1) return { ok: false, error: "mixed_currencies", message: "These items are priced in different currencies: place them as two orders, or pass the request to the team." };
  const currency = lines[0].item.currency;
  const priced = lines.map(({ item, quantity }) => ({
    itemId: item.id,
    name: item.name,
    quantity,
    priceText: priceText(item),
    lineTotalMinor: item.priceMaxMinor === null ? item.priceMinor * quantity : null,
  }));
  const fixed = priced.every((line) => line.lineTotalMinor !== null);
  const totalMinor = fixed ? priced.reduce((sum, line) => sum + line.lineTotalMinor!, 0) : null;
  return { ok: true, lines: priced, currency, totalMinor, totalText: totalMinor !== null ? formatMoney(totalMinor, currency) : "to be confirmed by the team (some prices depend on the details)" };
}

async function placeOrder(args: any, context: ExtraContext) {
  const wanted: OrderLineInput[] = (Array.isArray(args?.items) ? args.items : []).slice(0, MAX_LINES).map((entry: any) => ({
    id: textArg(entry?.id).slice(0, 60),
    quantity: Number.isInteger(entry?.quantity) ? entry.quantity : Number.parseInt(String(entry?.quantity ?? ""), 10),
  })).filter((entry: OrderLineInput) => entry.id);
  if (!wanted.length) return { ok: false, error: "items_required", message: "Find each item with get_prices first, then place the order with their ids." };
  if (wanted.some((entry) => !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 9999)) {
    return { ok: false, error: "quantity_required", message: "Ask how many of each they'd like (a whole number)." };
  }
  const businessId = context.business.id;
  const found: Array<{ item: PriceItem; quantity: number }> = [];
  for (const entry of wanted) {
    const item = await getPriceItem(businessId, entry.id);
    if (!item || item.status !== "active") return { ok: false, error: "unknown_item", message: `There's no item ${entry.id} in the catalogue: look it up with get_prices and use its id.` };
    const same = found.find((line) => line.item.id === item.id);
    if (same) same.quantity += entry.quantity;
    else found.push({ item, quantity: entry.quantity });
  }
  const out = found.filter((line) => !line.item.available).map((line) => line.item.name);
  if (out.length) return { ok: false, error: "out_of_stock", items: out, message: `Out of stock right now: ${out.join(", ")}. Tell the customer, and offer something similar from get_prices.` };

  const fulfilment = args?.fulfilment === "delivery" || args?.fulfilment === "collection" ? args.fulfilment : null;
  if (!fulfilment) return { ok: false, error: "fulfilment_required", message: "Ask whether they'd like it delivered or will collect it." };
  const area = textArg(args?.area).slice(0, 160) || null;
  if (fulfilment === "delivery" && !area) return { ok: false, error: "area_required", message: "Ask where it should be delivered." };
  const contact = await contactOf(args, context.sessionId, true);
  if (!contact.ok) return contact;

  const priced = priceOrder(found);
  if (!priced.ok) return priced;
  const when = textArg(args?.when).slice(0, 120) || null;
  const notes = textArg(args?.notes).slice(0, 500) || null;
  const details: OrderDetails = { reference: reference(), lines: priced.lines, currency: priced.currency, totalMinor: priced.totalMinor, totalText: priced.totalText, fulfilment, area, when };
  const summary = priced.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ");
  const [row] = await inBusiness((db) => db.insert(leads).values({
    businessId, sessionId: context.sessionId, kind: "order",
    name: contact.name, email: contact.email, phone: contact.phone,
    interest: summary.slice(0, 500), notes, details,
  }).returning({ id: leads.id }), businessId);
  void alertTeam(context.business, {
    kind: "lead", leadId: row.id, sessionId: context.sessionId, title: `A new order (${details.reference})`,
    summary: `${contact.name}: ${summary}. Total ${priced.totalText}. ${fulfilment === "delivery" ? `Deliver to ${area}` : "Collection"}${when ? `, ${when}` : ""}.`.slice(0, 300),
  }).catch((error) => console.error("[orders] alert failed:", error));
  return {
    ok: true,
    reference: details.reference,
    lines: priced.lines.map((line) => ({ item: line.name, quantity: line.quantity, price: line.priceText, ...(line.lineTotalMinor !== null ? { line_total: formatMoney(line.lineTotalMinor, priced.currency) } : {}) })),
    total: priced.totalText,
    next_step: "Give the customer the reference and read back the items and total. The team confirms the order (and any delivery charge) and tells them how to pay the business. Don't take payment details, and don't promise a delivery time the customer didn't agree.",
  };
}

const TOOLS: ExtraTool[] = [{ declaration: placeOrderDeclaration, readOnly: false, run: placeOrder }];

const GUIDANCE = `\n\nTaking orders from the catalogue:
- Find each item with get_prices and use its id. Confirm how many of each, delivery or collection (and where to, for delivery), when they'd like it, and their name and phone, then read the order back before you place it (${PLACE_ORDER}).
- The total comes from ${PLACE_ORDER}: never add it up yourself. If an item is out of stock, say so and suggest a similar one.`;

/** For a business that takes orders on the Full tier, with no system of its own connected for them. */
export function registerOrderExtras(): void {
  addExtras(async (business: Business) => {
    if (business.tier !== "full" || business.businessType === "custom") return {};
    const { enabled } = await businessCapabilities(business);
    if (!enabled.includes("orders")) return {};
    const live = await liveIntegration(business.id).catch(() => null);
    if (live && (live.actions.includes("checkout.link") || (live.allowWrites && live.actions.includes("order.create")))) return {};
    return { prompt: GUIDANCE, tools: TOOLS };
  });
}

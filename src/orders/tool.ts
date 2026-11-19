// src/orders/tool.ts
//
// Zaina's order tools, for a business that takes orders (the "orders"
// capability, Full tier) and has no system of its own connected for them:
//
//   place_order   the customer's order from the catalogue (item ids from
//                 get_prices): the server prices it, adds the delivery
//                 area's fee, reserves the stock and either sends the
//                 business's own payment link, confirms it to be paid on
//                 delivery, or passes it to the team to accept (store.ts)
//   check_order   where an order stands, for the customer who placed it
//
// From then on the customer hears every step by themselves (notices.ts):
// paid and confirmed, on its way or ready to collect, delivered. Zaina never
// collects money and never adds up totals herself.

import { sessionSpot } from "../frontdoor/spot.ts";
import { createHash } from "node:crypto";
import { Type, type FunctionDeclaration } from "@google/genai";
import { formatMoney } from "../booking/money.ts";
import { holdUntil } from "../booking/notices.ts";
import { businessCapabilities } from "../capabilities/of-business.ts";
import type { Business, Order } from "../db/schema.ts";
import { addExtras, type ExtraContext, type ExtraTool } from "../engine/extras.ts";
import { sharesPhoneNumber, textArg } from "../engine/tool-args.ts";
import { liveIntegration } from "../integrations/store.ts";
import { contactOf } from "../leads/extra-tools.ts";
import { orderPayLink, tellOrderTeam } from "./notices.ts";
import { getOrderSettings } from "./settings.ts";
import { getOrderByReference, orderAmountDue, ordersOfSession, placeOrder } from "./store.ts";

export const PLACE_ORDER = "place_order";
export const CHECK_ORDER = "check_order";

export const placeOrderDeclaration: FunctionDeclaration = {
  name: PLACE_ORDER,
  description:
    "Place the customer's order from the business's catalogue once they've confirmed the items, how many, delivery or collection (or, when your instructions say where they are, that it's brought to them there), and their name and phone. " +
    "The server works out the total (delivery included) and returns the business's own payment link, or confirms it. You never take payment.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      items: {
        type: Type.ARRAY,
        description: "What they're ordering.",
        items: { type: Type.OBJECT, properties: { id: { type: Type.STRING, description: "The item's id from get_prices." }, quantity: { type: Type.INTEGER, description: "How many." } }, required: ["id", "quantity"] },
      },
      fulfilment: { type: Type.STRING, enum: ["delivery", "collection", "on_site"], description: "Delivered to them, they collect it, or on_site: brought to them where they are (their table or room), only when your instructions say where the customer is." },
      delivery_area: { type: Type.STRING, description: "For delivery: which of the business's delivery areas, exactly as listed in your instructions." },
      address: { type: Type.STRING, description: "For delivery: the address or a landmark, in the customer's words." },
      when: { type: Type.STRING, description: "When they'd like it, in the customer's words." },
      pay_on_delivery: { type: Type.BOOLEAN, description: "True only if the customer chose to pay on delivery or collection and the business allows it." },
      name: { type: Type.STRING, description: "The customer's name exactly as they typed it." },
      phone: { type: Type.STRING, description: "Their phone number exactly as they typed it." },
      email: { type: Type.STRING, description: "Their email, if they gave one (for receipts)." },
      notes: { type: Type.STRING, description: "Anything else they asked for, in their words." },
    },
    required: ["items"],
  },
};

export const checkOrderDeclaration: FunctionDeclaration = {
  name: CHECK_ORDER,
  description: "Where the customer's order stands: confirmed, paid, on its way, ready to collect. Without a reference, the orders placed in this chat.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      reference: { type: Type.STRING, description: "The order reference, like ORD-3F9A21." },
      phone: { type: Type.STRING, description: "The phone the order was placed with, as the customer typed it (needed for an order from another chat)." },
    },
  },
};

const STATUS_WORDS: Record<Order["status"], string> = {
  requested: "waiting for the business to accept it",
  awaiting_payment: "waiting for payment",
  confirmed: "confirmed and being prepared",
  out_for_delivery: "out for delivery",
  ready_for_collection: "ready to collect",
  completed: "delivered or collected",
  cancelled: "cancelled",
  expired: "lapsed: it wasn't paid in time",
};

/** An order as Zaina tells it to the customer. */
function orderView(order: Order, timeZone: string) {
  const due = orderAmountDue(order);
  return {
    reference: order.reference,
    status: order.spot && order.status === "ready_for_collection" ? `ready: being brought to ${order.spot}` : order.spot && order.status === "completed" ? `brought to ${order.spot}` : STATUS_WORDS[order.status],
    items: order.lines.map((line) => `${line.quantity} × ${line.name}`),
    ...(order.deliveryFeeMinor ? { delivery_fee: formatMoney(order.deliveryFeeMinor, order.currency) } : {}),
    total: order.pricedByTeam && order.status === "requested" ? "to be confirmed by the business" : formatMoney(order.totalMinor, order.currency),
    ...(order.paidMinor ? { paid: formatMoney(order.paidMinor, order.currency) } : {}),
    fulfilment: order.fulfilment === "delivery" ? `delivery to ${order.zone}${order.address ? ` (${order.address})` : ""}` : order.spot ? `brought to ${order.spot}` : "collection",
    ...(order.payOnDelivery && due > 0 ? { pay_on_delivery: formatMoney(due, order.currency) } : {}),
    ...(order.status === "awaiting_payment" ? { payment_link: orderPayLink(order), pay_by: order.holdExpiresAt ? holdUntil(order.holdExpiresAt, timeZone) : null } : {}),
    ...(order.cancelReason ? { reason: order.cancelReason } : {}),
  };
}

async function runPlaceOrder(args: any, context: ExtraContext) {
  const items = (Array.isArray(args?.items) ? args.items : []).slice(0, 30).map((entry: any) => ({
    id: textArg(entry?.id).slice(0, 60),
    quantity: Number.isInteger(entry?.quantity) ? entry.quantity : Number.parseInt(String(entry?.quantity ?? ""), 10),
  })).filter((entry: { id: string }) => entry.id);
  // A customer at a table or room (the code they scanned said where) has it brought to them: no address, no delivery fee.
  const spot = await sessionSpot(context.business.id, context.sessionId).catch(() => null);
  const asked = args?.fulfilment;
  if (asked === "on_site" && !spot) return { ok: false, error: "no_spot", message: "It isn't known where the customer is: ask whether they'd like it delivered or will collect it." };
  const onSite = Boolean(spot) && (asked === "on_site" || !asked);
  const fulfilment = onSite ? "collection" : asked === "delivery" || asked === "collection" ? asked : null;
  if (!fulfilment) return { ok: false, error: "fulfilment_required", message: "Ask whether they'd like it delivered or will collect it." };
  const contact = await contactOf(args, context.sessionId, true);
  if (!contact.ok) return contact;
  // The same order asked twice in a chat (a retried call) is placed once.
  const key = createHash("sha256").update(JSON.stringify([context.sessionId, [...items].sort((a, b) => a.id.localeCompare(b.id)), fulfilment, onSite ? spot : null, textArg(args?.delivery_area), textArg(args?.address)])).digest("hex").slice(0, 40);
  const placed = await placeOrder({
    business: context.business,
    sessionId: context.sessionId,
    customer: { name: contact.name, phone: contact.phone ?? null, email: contact.email ?? null },
    items,
    fulfilment,
    zone: textArg(args?.delivery_area) || null,
    address: textArg(args?.address) || null,
    wanted: textArg(args?.when) || null,
    notes: textArg(args?.notes) || null,
    payOnDelivery: args?.pay_on_delivery === true,
    idempotencyKey: key,
    spot: onSite ? spot : null,
  });
  if (!placed.ok) return placed;
  const { order } = placed;
  if (placed.created && (order.status === "requested" || order.status === "confirmed")) {
    void tellOrderTeam(context.business, order, order.status === "requested" ? "request" : "new");
  }
  const next = order.status === "awaiting_payment"
    ? "Read back the items and total, then send the payment link exactly as it is: paying there confirms the order, and the customer hears every step after that here. Say until when their items are kept."
    : order.status === "confirmed"
      ? order.spot
        ? `Tell the customer the order is confirmed and will be brought to ${order.spot}${order.payOnDelivery ? ", to be paid when it arrives" : ""}.`
        : `Tell the customer the order is confirmed, to be paid on ${order.fulfilment === "delivery" ? "delivery" : "collection"}, and that they'll hear here when it's ${order.fulfilment === "delivery" ? "on its way" : "ready to collect"}.`
      : "Tell the customer the business will confirm the order here shortly (and the total, if a price depends on the details). Don't promise a time.";
  return { ok: true, ...orderView(order, context.business.timeZone), ...(placed.note ? { note: placed.note } : {}), next_step: next };
}

async function runCheckOrder(args: any, context: ExtraContext) {
  const { business, sessionId } = context;
  const reference = textArg(args?.reference).toUpperCase();
  if (!reference) {
    const mine = await ordersOfSession(business.id, sessionId);
    if (!mine.length) return { ok: false, error: "no_order_here", message: "No order was placed in this chat: ask for the order reference and the phone it was placed with." };
    return { ok: true, orders: mine.slice(0, 3).map((order) => orderView(order, business.timeZone)) };
  }
  const order = await getOrderByReference(business.id, reference);
  // An order from another chat is shown only to someone who also knows its phone number.
  const phone = textArg(args?.phone);
  if (!order || (order.sessionId !== sessionId && !(phone && order.customerPhone && sharesPhoneNumber(phone, order.customerPhone)))) {
    return { ok: false, error: "not_found", message: "No order matches that reference and phone. Ask them to check both." };
  }
  return { ok: true, ...orderView(order, business.timeZone) };
}

const TOOLS: ExtraTool[] = [
  { declaration: placeOrderDeclaration, readOnly: false, run: runPlaceOrder, trustsLinks: true },
  { declaration: checkOrderDeclaration, readOnly: true, run: runCheckOrder, trustsLinks: true },
];

/** How this business takes orders, in Zaina's instructions: its own delivery areas and fees, never invented ones. */
export async function orderGuidance(businessId: string): Promise<string> {
  const settings = await getOrderSettings(businessId);
  const money = (minor: number) => formatMoney(minor, "KES");
  const how = settings.delivery && settings.collection ? "delivery or collection" : settings.delivery ? "delivery (no collection)" : "collection (this business doesn't deliver)";
  return [
    "\n\nTaking orders from the catalogue:",
    `- Find each item with get_prices and use its id. Confirm how many of each, ${how}, when they'd like it, and their name and phone, then read the order back and place it (${PLACE_ORDER}).`,
    settings.delivery ? `- Delivery areas and fees (${PLACE_ORDER} adds the fee): ${settings.zones.map((zone) => `${zone.name} ${zone.feeMinor ? money(zone.feeMinor) : "free"}`).join("; ")}. Anywhere else isn't delivered to.` : "",
    settings.collection ? `- Collection is ${settings.collectionPoint ? `at ${settings.collectionPoint}` : "from the business"}.` : "",
    settings.minimumMinor ? `- The smallest order is ${money(settings.minimumMinor)} (before delivery).` : "",
    settings.payOnDelivery ? "- Customers may pay on delivery or collection instead of paying online first, if they ask." : "- Orders are paid online first, through the payment link.",
    settings.confirm === "team" ? "- The business accepts each order before it's paid: the customer hears here once it does." : "",
    `- The total comes from ${PLACE_ORDER}: never add it up yourself. If an item is out of stock or there's not enough left, say so and suggest something similar.`,
    `- For "where's my order?", use ${CHECK_ORDER}. The customer hears every change to their order here by themselves.`,
  ].filter(Boolean).join("\n");
}

/** For a business that takes orders on the Full tier, with no system of its own connected for them. */
export function registerOrderExtras(): void {
  addExtras(async (business: Business) => {
    if (business.tier !== "full" || business.businessType === "custom") return {};
    const { enabled } = await businessCapabilities(business);
    if (!enabled.includes("orders")) return {};
    const live = await liveIntegration(business.id).catch(() => null);
    if (live && (live.actions.includes("checkout.link") || (live.allowWrites && live.actions.includes("order.create")))) return {};
    return { prompt: await orderGuidance(business.id), tools: TOOLS };
  });
}

// src/orders/store.ts
//
// An order from the catalogue, from the chat to the customer's door (orders,
// migration 0032). Everything that must be exactly right is done here, in
// one transaction each: the lines are priced from the catalogue, the
// delivery zone's fee is added, the stock it takes is reserved, and a
// payment confirms it.
//
//   requested           the team accepts it first: the business asked to
//                       (confirm: team), a price is a range, or there's no
//                       way to pay online and no paying on delivery. Its
//                       stock is kept for a day while the team decides.
//   awaiting_payment    the payment link is out; its stock is kept until
//                       hold_expires_at (the business's hold), then it expires
//   confirmed           paid, or to be paid on delivery or collection
//   out_for_delivery / ready_for_collection    the team moved it on
//   completed           delivered or collected
//   cancelled, expired  its stock goes back
//
// Stock is only counted for items with a stock_quantity; the rest are in or
// out of stock by hand (price_items.available).

import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { formatMoney } from "../booking/money.ts";
import { newPayToken } from "../booking/bookings.ts";
import { getBookingSettings, onlineWays, paymentOptionsOf } from "../booking/settings.ts";
import { everyBusiness } from "../businesses/registry.ts";
import { orders, payments, type Business, type Order, type OrderLine, type OrderSettings, type OrderStatus, type Payment, type PaymentMethod, type PriceItem } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { priceText } from "../prices/price-list.ts";
import { getOrderSettings } from "./settings.ts";

/** How long a request waits for the team before it lapses (its stock goes back). */
export const REQUEST_HOLD_MS = 24 * 60 * 60 * 1000;
const MAX_LINES = 30;

export const newOrderReference = () => `ORD-${randomBytes(3).toString("hex").toUpperCase()}`;

export type PlaceOrderInput = {
  business: Business;
  sessionId: string | null;
  customer: { name: string; phone: string | null; email: string | null };
  items: Array<{ id: string; quantity: number }>;
  fulfilment: "delivery" | "collection";
  zone?: string | null;
  address?: string | null;
  wanted?: string | null;
  notes?: string | null;
  payOnDelivery?: boolean;
  idempotencyKey?: string | null;
  /** Where the customer is ("Table 5"), from the code they scanned: the order is brought to them (no address, no delivery fee). */
  spot?: string | null;
  now?: Date;
};
export type OrderProblem = { ok: false; error: string; message: string; items?: string[]; zones?: string[] };
export type PlacedOrder = { ok: true; order: Order; created: boolean; note: string | null };

const problem = (error: string, message: string, extra: Partial<OrderProblem> = {}): OrderProblem => ({ ok: false, error, message, ...extra });

/** Whether customers can pay this order online now: a way the business offers that takes its currency and amount. */
export async function canPayOnline(businessId: string, currency: string, amountMinor: number): Promise<boolean> {
  const options = paymentOptionsOf(await getBookingSettings(businessId));
  return onlineWays(options, amountMinor).some((way) => way === "paystack" || currency === "KES");
}

/** The order's first status, from the business's choices, the lines and how the customer pays. */
export function firstStatus(input: { settings: OrderSettings; pricedByTeam: boolean; online: boolean; wantsPayOnDelivery: boolean }): { status: OrderStatus; payOnDelivery: boolean } {
  const { settings } = input;
  if (input.pricedByTeam || settings.confirm === "team") return { status: "requested", payOnDelivery: input.wantsPayOnDelivery && settings.payOnDelivery };
  if (input.wantsPayOnDelivery && settings.payOnDelivery) return { status: "confirmed", payOnDelivery: true };
  if (input.online) return { status: "awaiting_payment", payOnDelivery: false };
  if (settings.payOnDelivery) return { status: "confirmed", payOnDelivery: true };
  return { status: "requested", payOnDelivery: false };
}

/** The delivery fee for a zone the customer named; null when the business doesn't deliver there. */
export function zoneFee(settings: OrderSettings, zone: string | null | undefined): { name: string; feeMinor: number } | null {
  const wanted = (zone ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return settings.zones.find((entry) => entry.name.toLowerCase() === wanted) ?? null;
}

/** An order from the catalogue: priced, its stock reserved, in one transaction. */
export async function placeOrder(input: PlaceOrderInput): Promise<PlacedOrder | OrderProblem> {
  const now = input.now ?? new Date();
  const businessId = input.business.id;
  const settings = await getOrderSettings(businessId);
  const wanted = input.items.slice(0, MAX_LINES);
  if (!wanted.length) return problem("items_required", "Find each item with get_prices first, then place the order with their ids.");
  if (wanted.some((entry) => !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 9999)) {
    return problem("quantity_required", "Ask how many of each they'd like (a whole number).");
  }

  // Fulfilment first: it decides the fee and whether this order can be taken at all.
  let zone: { name: string; feeMinor: number } | null = null;
  if (input.fulfilment === "delivery") {
    if (!settings.delivery) {
      return problem("no_delivery", settings.collection
        ? `This business doesn't deliver: offer collection${settings.collectionPoint ? ` at ${settings.collectionPoint}` : ""}.`
        : "This business doesn't deliver.");
    }
    zone = zoneFee(settings, input.zone);
    if (!zone) {
      return problem("zone_required", `Ask which of the delivery areas they're in: ${settings.zones.map((entry) => entry.name).join(", ")}. If none, say the business doesn't deliver there${settings.collection ? " and offer collection" : ""}.`, { zones: settings.zones.map((entry) => entry.name) });
    }
    if (!(input.address ?? "").trim()) return problem("address_required", "Ask for the delivery address or a landmark.");
  } else if (!settings.collection && !input.spot) {
    return problem("no_collection", "This business delivers only: ask which delivery area they're in.");
  }

  return inBusiness(async (_db, client) => {
    if (input.idempotencyKey) {
      const { rows } = await client.query("select * from orders where business_id = $1 and idempotency_key = $2", [businessId, input.idempotencyKey]);
      if (rows[0]) return { ok: true as const, order: rowToOrder(rows[0]), created: false, note: null };
    }
    // The items, locked so two orders can't both take the last one.
    const ids = [...new Set(wanted.map((entry) => entry.id))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const { rows: found } = await client.query<PriceItemRow>(
      "select id, name, section, price_minor, price_max_minor, currency, unit, status, available, stock_quantity from price_items where business_id = $1 and id = any($2::uuid[]) for update",
      [businessId, ids],
    );
    const byId = new Map(found.map((row) => [row.id, row]));
    const merged = new Map<string, number>();
    for (const entry of wanted) {
      const row = byId.get(entry.id);
      if (!row || row.status !== "active") return problem("unknown_item", `There's no item ${entry.id} in the catalogue: look it up with get_prices and use its id.`);
      merged.set(row.id, (merged.get(row.id) ?? 0) + entry.quantity);
    }
    const out = [...merged].filter(([id, quantity]) => {
      const row = byId.get(id)!;
      return !row.available || (row.stock_quantity !== null && row.stock_quantity < quantity);
    }).map(([id, quantity]) => {
      const row = byId.get(id)!;
      return row.available && row.stock_quantity !== null && row.stock_quantity > 0 ? `${row.name} (only ${row.stock_quantity} left, asked for ${quantity})` : row.name;
    });
    if (out.length) return problem("out_of_stock", `Not enough in stock: ${out.join(", ")}. Tell the customer, and offer what's left or something similar from get_prices.`, { items: out });
    const currencies = new Set([...merged.keys()].map((id) => byId.get(id)!.currency));
    if (currencies.size > 1) return problem("mixed_currencies", "These items are priced in different currencies: place them as two orders.");

    const lines: OrderLine[] = [...merged].map(([id, quantity]) => {
      const row = byId.get(id)!;
      const item = { priceMinor: Number(row.price_minor), priceMaxMinor: row.price_max_minor === null ? null : Number(row.price_max_minor), currency: row.currency, unit: row.unit };
      return {
        itemId: id, name: row.name, quantity, unitMinor: item.priceMinor, priceText: priceText(item as PriceItem),
        lineTotalMinor: item.priceMaxMinor === null ? item.priceMinor * quantity : null,
        counted: row.stock_quantity !== null,
      };
    });
    const currency = lines.length ? byId.get(lines[0].itemId)!.currency : "KES";
    const pricedByTeam = lines.some((line) => line.lineTotalMinor === null);
    const subtotal = lines.reduce((sum, line) => sum + (line.lineTotalMinor ?? line.unitMinor * line.quantity), 0);
    if (!pricedByTeam && subtotal < settings.minimumMinor) {
      return problem("below_minimum", `The smallest order is ${formatMoney(settings.minimumMinor, currency)}; this one is ${formatMoney(subtotal, currency)}. Ask if they'd like to add something.`);
    }
    const fee = zone?.feeMinor ?? 0;
    const total = subtotal + fee;
    const online = await canPayOnline(businessId, currency, total);
    const { status, payOnDelivery } = firstStatus({ settings, pricedByTeam, online, wantsPayOnDelivery: input.payOnDelivery === true });
    const note = input.payOnDelivery && !settings.payOnDelivery && status === "awaiting_payment"
      ? "This business takes payment before delivery: send the payment link."
      : null;

    // Stock for counted items comes out now; it goes back if the order lapses or is cancelled.
    for (const line of lines) {
      if (!line.counted) continue;
      await client.query("update price_items set stock_quantity = stock_quantity - $3, updated_at = now() where business_id = $1 and id = $2", [businessId, line.itemId, line.quantity]);
    }
    const hold = status === "awaiting_payment" ? new Date(now.getTime() + settings.holdMinutes * 60_000) : status === "requested" ? new Date(now.getTime() + REQUEST_HOLD_MS) : null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await client.query("savepoint new_order");
        const { rows } = await client.query(
          `insert into orders (business_id, reference, session_id, status, customer_name, customer_phone, customer_email, customer_notes, lines, currency,
             subtotal_minor, delivery_fee_minor, total_minor, pay_on_delivery, priced_by_team, fulfilment, zone, address, wanted, pay_token, hold_expires_at,
             stock_reserved, idempotency_key, confirmed_at, created_at, updated_at, spot)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $25, $26)
           returning *`,
          [businessId, newOrderReference(), input.sessionId, status, input.customer.name.slice(0, 120), input.customer.phone, input.customer.email,
            input.notes?.slice(0, 500) || null, JSON.stringify(lines), currency, subtotal, fee, total, payOnDelivery, pricedByTeam, input.fulfilment,
            zone?.name ?? null, input.fulfilment === "delivery" ? (input.address ?? "").trim().slice(0, 200) : null, input.wanted?.slice(0, 120) || null,
            newPayToken(), hold, lines.some((line) => line.counted), input.idempotencyKey ?? null, status === "confirmed" ? now : null, now, input.fulfilment === "collection" ? input.spot ?? null : null],
        );
        await client.query("release savepoint new_order");
        return { ok: true as const, order: rowToOrder(rows[0]), created: true, note };
      } catch (error) {
        await client.query("rollback to savepoint new_order");
        const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
        if (database.code === "23505" && attempt < 3 && database.constraint !== "orders_idempotency_idx") continue;
        throw error;
      }
    }
  }, businessId);
}

type PriceItemRow = { id: string; name: string; section: string | null; price_minor: string | number; price_max_minor: string | number | null; currency: "KES" | "USD"; unit: string | null; status: string; available: boolean; stock_quantity: number | null };

/** A raw orders row as the typed record. */
function rowToOrder(row: Record<string, any>): Order {
  const number = (value: unknown) => (value === null || value === undefined ? value : Number(value));
  return {
    id: row.id, businessId: row.business_id, reference: row.reference, sessionId: row.session_id, status: row.status,
    customerName: row.customer_name, customerPhone: row.customer_phone, customerEmail: row.customer_email, customerNotes: row.customer_notes,
    lines: row.lines, currency: row.currency, subtotalMinor: number(row.subtotal_minor) as number, deliveryFeeMinor: number(row.delivery_fee_minor) as number,
    totalMinor: number(row.total_minor) as number, paidMinor: number(row.paid_minor) as number, payOnDelivery: row.pay_on_delivery, pricedByTeam: row.priced_by_team,
    fulfilment: row.fulfilment, zone: row.zone, address: row.address, wanted: row.wanted, payToken: row.pay_token, holdExpiresAt: row.hold_expires_at,
    stockReserved: row.stock_reserved, conflict: row.conflict, staffNote: row.staff_note, cancelReason: row.cancel_reason, idempotencyKey: row.idempotency_key,
    customerId: row.customer_id ?? null, spot: row.spot ?? null, createdAt: row.created_at, updatedAt: row.updated_at, confirmedAt: row.confirmed_at, completedAt: row.completed_at,
  };
}

// ── Reading ───────────────────────────────────────────────────────────

export async function getOrder(businessId: string, id: string): Promise<Order | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await inBusiness((db) => db.select().from(orders).where(and(eq(orders.businessId, businessId), eq(orders.id, id))).limit(1), businessId);
  return row;
}

export async function getOrderByReference(businessId: string, reference: string): Promise<Order | undefined> {
  const ref = reference.trim().toUpperCase();
  if (!/^ORD-[0-9A-F]{6}$/.test(ref)) return undefined;
  const [row] = await inBusiness((db) => db.select().from(orders).where(and(eq(orders.businessId, businessId), eq(orders.reference, ref))).limit(1), businessId);
  return row;
}

export async function ordersOfSession(businessId: string, sessionId: string): Promise<Order[]> {
  return inBusiness((db) => db.select().from(orders).where(and(eq(orders.businessId, businessId), eq(orders.sessionId, sessionId))).orderBy(desc(orders.createdAt)).limit(10), businessId);
}

export async function orderByPayToken(businessId: string, token: string): Promise<Order | undefined> {
  const [row] = await inBusiness((db) => db.select().from(orders).where(and(eq(orders.businessId, businessId), eq(orders.payToken, token))).limit(1), businessId);
  return row;
}

export async function paymentsOfOrder(businessId: string, orderId: string): Promise<Payment[]> {
  return inBusiness((db) => db.select().from(payments).where(and(eq(payments.businessId, businessId), eq(payments.orderId, orderId))).orderBy(desc(payments.createdAt)), businessId);
}

export type OrderFilter = "needs_you" | "active" | "done" | "cancelled" | "all";
export const orderFilters: OrderFilter[] = ["needs_you", "active", "done", "cancelled", "all"];

/** A business's orders by what they need: the team (requests, codes, problems), on their way, done, cancelled. */
export async function listOrders(businessId: string, filter: OrderFilter, limit = 200): Promise<Array<Order & { codeToCheck: boolean }>> {
  return inBusiness(async (db) => {
    // The outer row named in full: in a selected field Drizzle would leave the table off, and the subquery would compare payments with itself.
    const codes = sql<boolean>`exists (select 1 from payments p where p.business_id = "orders"."business_id" and p.order_id = "orders"."id" and p.method = 'mpesa_code' and p.status = 'pending')`;
    const where = filter === "needs_you"
      ? or(eq(orders.status, "requested"), sql`${orders.conflict} is not null`, codes)
      : filter === "active" ? inArray(orders.status, ["awaiting_payment", "confirmed", "out_for_delivery", "ready_for_collection"])
        : filter === "done" ? eq(orders.status, "completed")
          : filter === "cancelled" ? inArray(orders.status, ["cancelled", "expired"]) : undefined;
    const rows = await db.select({ order: orders, codeToCheck: codes }).from(orders)
      .where(where ? and(eq(orders.businessId, businessId), where) : eq(orders.businessId, businessId))
      .orderBy(desc(orders.createdAt)).limit(limit);
    return rows.map((row) => ({ ...row.order, codeToCheck: Boolean(row.codeToCheck) }));
  }, businessId);
}

export async function orderCounts(businessId: string): Promise<{ needsYou: number; active: number }> {
  const [row] = await inBusiness((_db, client) => client.query<{ needs_you: number; active: number }>(
    `select count(*) filter (where status = 'requested' or conflict is not null or exists (select 1 from payments p where p.business_id = o.business_id and p.order_id = o.id and p.method = 'mpesa_code' and p.status = 'pending'))::int as needs_you,
            count(*) filter (where status in ('awaiting_payment', 'confirmed', 'out_for_delivery', 'ready_for_collection'))::int as active
       from orders o where business_id = $1`, [businessId]).then((result) => result.rows), businessId);
  return { needsYou: row?.needs_you ?? 0, active: row?.active ?? 0 };
}

// ── Changing ──────────────────────────────────────────────────────────

type Client = { query: <T = any>(text: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }> };

async function lockedOrder(client: Client, businessId: string, id: string): Promise<Order | undefined> {
  const { rows } = await client.query("select * from orders where business_id = $1 and id = $2 for update", [businessId, id]);
  return rows[0] ? rowToOrder(rows[0]) : undefined;
}

/** Puts an order's counted stock back. */
async function releaseStock(client: Client, order: Order): Promise<void> {
  if (!order.stockReserved) return;
  for (const line of order.lines) {
    if (!line.counted) continue;
    await client.query("update price_items set stock_quantity = stock_quantity + $3, updated_at = now() where business_id = $1 and id = $2 and stock_quantity is not null", [order.businessId, line.itemId, line.quantity]);
  }
}

/** Takes an order's counted stock again (a payment after its hold lapsed). False when an item has run out. */
async function retakeStock(client: Client, order: Order): Promise<boolean> {
  for (const line of order.lines) {
    if (!line.counted) continue;
    const { rowCount } = await client.query("update price_items set stock_quantity = stock_quantity - $3, updated_at = now() where business_id = $1 and id = $2 and stock_quantity >= $3", [order.businessId, line.itemId, line.quantity]);
    if (!rowCount) return false;
  }
  return true;
}

async function save(client: Client, order: Order, patch: Record<string, unknown>, now: Date): Promise<Order> {
  const columns = Object.keys(patch);
  const sets = columns.map((column, index) => `${column} = $${index + 3}`).join(", ");
  const { rows } = await client.query(`update orders set ${sets}, updated_at = $${columns.length + 3} where business_id = $1 and id = $2 returning *`, [order.businessId, order.id, ...columns.map((column) => patch[column]), now]);
  return rowToOrder(rows[0]);
}

export type OrderChange = { ok: true; order: Order; before: OrderStatus } | { ok: false; error: string; message: string };
const refuse = (error: string, message: string): OrderChange => ({ ok: false, error, message });

/**
 * The team accepts a request: at its total, or at the total they set when a
 * price was a range. It then waits for payment (the link goes out), or is
 * confirmed when the customer pays on delivery or there's no way to pay online.
 */
export async function acceptOrder(businessId: string, id: string, input: { totalMinor?: number | null; note?: string | null } = {}, now = new Date()): Promise<OrderChange> {
  const settings = await getOrderSettings(businessId);
  return inBusiness(async (_db, client) => {
    const order = await lockedOrder(client, businessId, id);
    if (!order) return refuse("not_found", "No such order.");
    if (order.status !== "requested") return refuse("wrong_status", "Only an order waiting for you can be accepted.");
    if (order.pricedByTeam && !(input.totalMinor && input.totalMinor > 0)) return refuse("total_required", "A price on this order is a range: give the total, delivery included.");
    const total = order.pricedByTeam ? input.totalMinor! : order.totalMinor;
    const online = await canPayOnline(businessId, order.currency, total);
    const payLater = order.payOnDelivery || !online;
    const status: OrderStatus = payLater ? "confirmed" : "awaiting_payment";
    const updated = await save(client, order, {
      status, total_minor: total, pay_on_delivery: payLater,
      hold_expires_at: status === "awaiting_payment" ? new Date(now.getTime() + settings.holdMinutes * 60_000) : null,
      confirmed_at: status === "confirmed" ? now : null,
      staff_note: input.note?.slice(0, 500) || order.staffNote,
    }, now);
    return { ok: true, order: updated, before: order.status };
  }, businessId);
}

/** The team declines a request, or cancels an order: its stock goes back. */
export async function cancelOrder(businessId: string, id: string, reason: string | null, now = new Date()): Promise<OrderChange> {
  return inBusiness(async (_db, client) => {
    const order = await lockedOrder(client, businessId, id);
    if (!order) return refuse("not_found", "No such order.");
    if (["completed", "cancelled", "expired"].includes(order.status)) return refuse("wrong_status", "This order is already finished.");
    await releaseStock(client, order);
    const updated = await save(client, order, { status: "cancelled", cancel_reason: reason?.slice(0, 300) || null, hold_expires_at: null, stock_reserved: false }, now);
    return { ok: true, order: updated, before: order.status };
  }, businessId);
}

const NEXT: Record<string, OrderStatus[]> = {
  confirmed: ["out_for_delivery", "ready_for_collection", "completed"],
  out_for_delivery: ["completed"],
  ready_for_collection: ["completed"],
};

/** The team moves a confirmed order on: out for delivery, ready for collection, delivered or collected. */
export async function advanceOrder(businessId: string, id: string, to: OrderStatus, now = new Date()): Promise<OrderChange> {
  return inBusiness(async (_db, client) => {
    const order = await lockedOrder(client, businessId, id);
    if (!order) return refuse("not_found", "No such order.");
    if (!(NEXT[order.status] ?? []).includes(to)) return refuse("wrong_status", `An order that's ${order.status.replace(/_/g, " ")} can't go to ${to.replace(/_/g, " ")}.`);
    if (to === "out_for_delivery" && order.fulfilment !== "delivery") return refuse("wrong_status", "This order is being collected.");
    if (to === "ready_for_collection" && order.fulfilment !== "collection") return refuse("wrong_status", "This order is being delivered.");
    const updated = await save(client, order, { status: to, completed_at: to === "completed" ? now : null, ...(to === "completed" ? { stock_reserved: false } : {}) }, now);
    return { ok: true, order: updated, before: order.status };
  }, businessId);
}

// ── Payments ──────────────────────────────────────────────────────────

/** What the customer can pay now: the rest of the total, once it's been accepted. */
export function orderAmountDue(order: Pick<Order, "status" | "totalMinor" | "paidMinor" | "payOnDelivery">): number {
  if (["awaiting_payment", "expired"].includes(order.status)) return Math.max(0, order.totalMinor - order.paidMinor);
  if (["confirmed", "out_for_delivery", "ready_for_collection"].includes(order.status) && order.payOnDelivery) return Math.max(0, order.totalMinor - order.paidMinor);
  return 0;
}

export async function recordOrderPayment(input: {
  businessId: string; orderId: string; method: PaymentMethod; amountMinor: number; currency: string;
  providerReference?: string | null; callbackToken?: string | null; payerPhone?: string | null; payerEmail?: string | null;
}): Promise<Payment> {
  const [row] = await inBusiness((db) => db.insert(payments).values({
    businessId: input.businessId, orderId: input.orderId, method: input.method, amountMinor: input.amountMinor, currency: input.currency as "KES" | "USD",
    status: "pending", providerReference: input.providerReference ?? null, callbackToken: input.callbackToken ?? null,
    payerPhone: input.payerPhone ?? null, payerEmail: input.payerEmail ?? null,
  }).returning(), input.businessId);
  return row;
}

/** Keeps an order's stock while the team checks an M-Pesa code the customer sent. */
export async function holdOrderWhileChecking(businessId: string, orderId: string, hours: number, now = new Date()): Promise<void> {
  await inBusiness((db) => db.update(orders).set({ holdExpiresAt: new Date(now.getTime() + hours * 3_600_000), updatedAt: now })
    .where(and(eq(orders.businessId, businessId), eq(orders.id, orderId), eq(orders.status, "awaiting_payment"))), businessId);
}

export type OrderSettlement = { changed: boolean; payment: Payment; order: Order; confirmed: boolean; conflict: boolean };

/**
 * A payment for an order settles: the order is confirmed once it's paid in
 * full. Paid after its hold lapsed, it's confirmed if its stock can still be
 * taken; otherwise the team is asked to sort it out (refund or replace).
 */
export async function settleOrderPayment(
  businessId: string,
  paymentId: string,
  outcome: { succeeded: true; receipt?: string | null; payerPhone?: string | null; recordedBy?: string | null } | { succeeded: false; failure: string; rejected?: boolean; recordedBy?: string | null },
  now = new Date(),
): Promise<OrderSettlement | undefined> {
  return inBusiness(async (db, client) => {
    const [payment] = await db.select().from(payments).where(and(eq(payments.businessId, businessId), eq(payments.id, paymentId))).for("update").limit(1);
    if (!payment?.orderId) return undefined;
    const order = await lockedOrder(client, businessId, payment.orderId);
    if (!order) return undefined;
    if (payment.status !== "pending") return { changed: false, payment, order, confirmed: false, conflict: false };
    if (!outcome.succeeded) {
      const [failed] = await db.update(payments).set({ status: outcome.rejected ? "rejected" : "failed", failure: outcome.failure.slice(0, 300), recordedBy: outcome.recordedBy ?? payment.recordedBy, settledAt: now, updatedAt: now })
        .where(eq(payments.id, payment.id)).returning();
      return { changed: true, payment: failed, order, confirmed: false, conflict: false };
    }
    const [paid] = await db.update(payments).set({ status: "succeeded", receipt: outcome.receipt ?? payment.receipt, payerPhone: outcome.payerPhone ?? payment.payerPhone, recordedBy: outcome.recordedBy ?? payment.recordedBy, settledAt: now, updatedAt: now })
      .where(eq(payments.id, payment.id)).returning();
    const paidMinor = order.paidMinor + payment.amountMinor;
    const patch: Record<string, unknown> = { paid_minor: paidMinor };
    let confirmed = false;
    let conflict = false;
    if (paidMinor >= order.totalMinor && (order.status === "awaiting_payment" || order.status === "expired")) {
      const stockKept = order.status === "awaiting_payment" || !order.lines.some((line) => line.counted) || (await retakeStock(client, order));
      if (stockKept) {
        Object.assign(patch, { status: "confirmed", confirmed_at: now, hold_expires_at: null, stock_reserved: order.lines.some((line) => line.counted) });
        confirmed = true;
      } else {
        Object.assign(patch, { status: "confirmed", confirmed_at: now, hold_expires_at: null, conflict: "Paid after the order's hold ended, and an item ran out meanwhile. Replace it or refund." });
        confirmed = true;
        conflict = true;
      }
    } else if (order.status === "cancelled") {
      patch.conflict = "Paid after the order was cancelled. Reinstate it or refund.";
      conflict = true;
    }
    const updated = await save(client, order, patch, now);
    return { changed: true, payment: paid, order: updated, confirmed, conflict };
  }, businessId);
}

/**
 * Unpaid orders past their hold, and requests the team never answered,
 * lapse: their stock goes back. A code being checked keeps its order held.
 */
export async function expireOrders(now = new Date()): Promise<Array<{ business: Business; order: Order }>> {
  const lapsed: Array<{ business: Business; order: Order }> = [];
  for (const business of await everyBusiness()) {
    const due = await inBusiness((db) => db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.businessId, business.id), inArray(orders.status, ["awaiting_payment", "requested"]), lt(orders.holdExpiresAt, now))).limit(100), business.id).catch(() => []);
    for (const { id } of due) {
      const order = await inBusiness(async (_db, client) => {
        const locked = await lockedOrder(client, business.id, id);
        if (!locked || !["awaiting_payment", "requested"].includes(locked.status) || !locked.holdExpiresAt || locked.holdExpiresAt >= now) return undefined;
        const { rows } = await client.query("select 1 from payments where business_id = $1 and order_id = $2 and status = 'pending' and method = 'mpesa_code' limit 1", [business.id, id]);
        if (rows.length) return undefined;
        await releaseStock(client, locked);
        return save(client, locked, { status: "expired", hold_expires_at: null, stock_reserved: false }, now);
      }, business.id);
      if (order) lapsed.push({ business, order });
    }
  }
  return lapsed;
}

/** One line for the team: "ORD-3F9A21 · 10 × Golden Fry 20L, 2 × Rice 25kg · KSh 51,700 · deliver to Westlands · Achieng". */
export function orderSummary(order: Order): string {
  const items = order.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ");
  const where = order.fulfilment === "delivery" ? `deliver to ${order.zone}${order.address ? ` (${order.address})` : ""}` : "collection";
  return `${order.reference} · ${items} · ${formatMoney(order.totalMinor, order.currency)}${order.payOnDelivery ? " on delivery" : ""} · ${where} · ${order.customerName}`.slice(0, 400);
}

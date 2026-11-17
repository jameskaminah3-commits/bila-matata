// src/integrations/events.ts
//
// What Zaina tells the business's own system as it happens, when it asked
// for events: a lead, a booking request, a confirmed booking, a confirmed
// order, a chat that needs a person. Signed like Zaina's calls (docs/INTEGRATION.md), sent at
// least once (three tries), each with an id to ignore repeats by.

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getSecret } from "../businesses/secrets.ts";
import type { TeamEvent } from "../connectors/types.ts";
import { bookings, leads, type Business, type Order } from "../db/schema.ts";
import { getOrder } from "../orders/store.ts";
import { inBusiness } from "../db/tenant.ts";
import { signedPost, type EventName } from "./client.ts";
import { liveIntegration, recordCall, SECRET_NAME } from "./store.ts";

type AlertLike =
  | TeamEvent
  | { kind: "booking"; what: string; bookingId: string; sessionId: string | null; summary: string }
  | { kind: "lead"; leadId: number; sessionId: string | null; summary: string }
  | { kind: string; [key: string]: unknown };

const RETRY_MS = (process.env.INTEGRATION_EVENT_RETRY_MS ?? "2000,8000").split(",").map(Number);

async function payloadFor(business: Business, event: AlertLike): Promise<{ name: EventName; data: Record<string, unknown> } | null> {
  if (event.kind === "lead") {
    const [lead] = await inBusiness((db) => db.select().from(leads).where(and(eq(leads.businessId, business.id), eq(leads.id, (event as any).leadId))).limit(1), business.id);
    if (!lead) return null;
    return { name: "lead.created", data: { lead: { kind: lead.kind, name: lead.name, phone: lead.phone, email: lead.email, interest: lead.interest, notes: lead.notes, callback_at: lead.callbackAt?.toISOString() ?? null, callback_when: lead.callbackWindow, created_at: lead.createdAt.toISOString() } } };
  }
  if (event.kind === "booking" && ((event as any).what === "request" || (event as any).what === "confirmed")) {
    const [booking] = await inBusiness((db) => db.select().from(bookings).where(and(eq(bookings.businessId, business.id), eq(bookings.id, (event as any).bookingId))).limit(1), business.id);
    if (!booking) return null;
    return {
      name: (event as any).what === "request" ? "booking.requested" : "booking.confirmed",
      data: { booking: { reference: booking.reference, status: booking.status, summary: String((event as any).summary ?? "").slice(0, 300), customer: { name: booking.customerName, phone: booking.customerPhone, email: booking.customerEmail } } },
    };
  }
  // An order from the catalogue, confirmed: paid, or to be paid on delivery or collection.
  if (event.kind === "order" && ["new", "paid"].includes(String((event as any).what))) {
    const order = await getOrder(business.id, String((event as any).orderId));
    return order && order.status === "confirmed" ? { name: "order.confirmed", data: { order: orderPayload(order) } } : null;
  }
  if (event.kind === "handoff") return { name: "chat.handoff", data: { reason: String((event as any).reason ?? "").slice(0, 300) } };
  return null;
}

/** An order as the business's system hears it: priced as it was placed. */
export const orderPayload = (order: Order) => ({
  reference: order.reference, status: order.status,
  lines: order.lines.map((line) => ({ item_id: line.itemId, name: line.name, quantity: line.quantity, line_total_minor: line.lineTotalMinor })),
  subtotal_minor: order.subtotalMinor, delivery_fee_minor: order.deliveryFeeMinor, total_minor: order.totalMinor, paid_minor: order.paidMinor, currency: order.currency,
  pay_on_delivery: order.payOnDelivery, fulfilment: order.fulfilment, zone: order.zone, address: order.address, wanted: order.wanted,
  customer: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail },
});

/** Sends the matching event, if the business asked for it. Never throws. */
export async function sendIntegrationEvent(business: Business, event: AlertLike): Promise<void> {
  try {
    const integration = await liveIntegration(business.id);
    if (!integration?.eventsUrl || !integration.events.length) return;
    const payload = await payloadFor(business, event);
    if (!payload || !integration.events.includes(payload.name)) return;
    const secret = await getSecret(business.id, SECRET_NAME);
    if (!secret) return;
    const body = { id: randomUUID(), event: payload.name, at: new Date().toISOString(), data: payload.data };
    for (let attempt = 0; attempt <= RETRY_MS.length; attempt += 1) {
      const started = Date.now();
      try {
        const { ms } = await signedPost(integration.eventsUrl, secret, business.id, body);
        await recordCall(business.id, `event:${payload.name}`, true, ms, null);
        return;
      } catch (error) {
        await recordCall(business.id, `event:${payload.name}`, false, Date.now() - started, (error as Error).message);
        if (attempt < RETRY_MS.length) await new Promise((resolve) => setTimeout(resolve, RETRY_MS[attempt]));
      }
    }
  } catch (error) {
    console.error(`[integrations] ${business.id} event failed:`, error);
  }
}

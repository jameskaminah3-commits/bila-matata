// src/orders/routes.ts
//
// An order's own page, for the customer (the link Zaina sends):
//
//   GET  /pay/o/:token                 what was ordered, where it stands, the ways to pay
//   GET  /pay/o/:token/status          the same, as JSON
//   POST /pay/o/:token/paystack        card or M-Pesa on Paystack's page (redirects there)
//   GET  /pay/o/:token/done            back from Paystack: ask how it went
//   POST /pay/o/:token/mpesa           a payment prompt on the customer's phone
//   POST /pay/o/:token/mpesa-code      an M-Pesa code, for the team to check
//
// And the team's side, under /v1/staff/businesses/:businessId:
//
//   GET  /orders?filter=needs_you|active|done|cancelled|all
//   GET  /orders/:id                   with its payments
//   POST /orders/:id/accept            { total?, note? }  a request goes on to payment (or is confirmed)
//   POST /orders/:id/decline           { reason? }
//   POST /orders/:id/status            { to: out_for_delivery | ready_for_collection | completed }
//   POST /orders/:id/cancel            { reason? }
//   POST /order-payments/:id/confirm   an M-Pesa code the team found in its statement
//   POST /order-payments/:id/reject    { reason? }
//   GET  /order-settings, PUT /order-settings
//
// Every change the team makes is told to the customer by itself (notices.ts).

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import type { PlatformConfig } from "../config.ts";
import { brandAssetUrl, brandAssetsOf } from "../brand/assets.ts";
import { businessForToken } from "../booking/bookings.ts";
import { formatMoney, toMinor } from "../booking/money.ts";
import { getBookingSettings, paymentOptionsOf } from "../booking/settings.ts";
import { anyBusinessById } from "../businesses/registry.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import { connectorFor } from "../connectors/registry.ts";
import { orderStatuses, payments, type Business, type Order, type OrderStatus, type Payment } from "../db/schema.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { visitorKey } from "../gateway/visitor.ts";
import { sendIntegrationEvent } from "../integrations/events.ts";
import { checkMpesaPayment, checkPaystackPayment } from "../payments/checkout.ts";
import { mpesaCode } from "../payments/mpesa.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { afterOrderSettlement, orderPayLink, tellOrderCustomer } from "./notices.ts";
import { ORDER_MESSAGES, renderOrderPage } from "./page.ts";
import { startOrderMpesa, startOrderPaystack, submitOrderCode } from "./pay.ts";
import { getOrderSettings, publicOrderSettings, validateOrderSettings } from "./settings.ts";
import {
  acceptOrder, advanceOrder, cancelOrder, getOrder, holdOrderWhileChecking, listOrders, orderAmountDue, orderByPayToken, orderCounts, orderFilters,
  paymentsOfOrder, settleOrderPayment, type OrderChange, type OrderFilter,
} from "./store.ts";

const PAGE_CSP = ["default-src 'none'", "style-src 'self'", "img-src 'self' data:", "form-action 'self' https://checkout.paystack.com", "frame-ancestors 'none'", "base-uri 'none'"].join("; ");

function pageHeaders(res: Response) {
  res.setHeader("Content-Security-Policy", PAGE_CSP);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
}

const NOT_FOUND_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Order not found</title><link rel="stylesheet" href="/pay-assets/pay.css"><link rel="icon" href="data:,"></head><body><main class="pay"><h1>Order not found</h1><p>This order link isn't valid. Please check the link you were sent, or ask the business.</p></main></body></html>`;

/** The order behind a link's token, and its business, found without any business in scope. */
export async function orderForPage(token: string): Promise<{ business: Business; order: Order } | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const businessId = await businessForToken("order", token);
  const business = businessId ? await anyBusinessById(businessId) : undefined;
  if (!business) return null;
  const order = await orderByPayToken(business.id, token);
  return order ? { business, order } : null;
}

function paymentState(list: Payment[], now: Date, returned: boolean): { pending: Payment | null; lastFailure: Payment | null } {
  const pending = list.find((payment) => payment.status === "pending" && (
    payment.method === "mpesa_code"
    || (payment.method === "mpesa_express" && now.getTime() - payment.createdAt.getTime() < 5 * 60_000)
    || (payment.method === "paystack" && returned && now.getTime() - payment.createdAt.getTime() < 10 * 60_000)
  )) ?? null;
  const latest = list[0];
  const lastFailure = latest && latest.status === "failed" && latest.settledAt && now.getTime() - latest.settledAt.getTime() < 30 * 60_000 ? latest : null;
  return { pending, lastFailure };
}

/** An order as the console shows it. */
export function publicOrder(order: Order & { codeToCheck?: boolean }) {
  const money = (minor: number) => formatMoney(minor, order.currency);
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    customer: { name: order.customerName, phone: order.customerPhone, email: order.customerEmail, notes: order.customerNotes },
    lines: order.lines.map((line) => ({ item_id: line.itemId, name: line.name, quantity: line.quantity, price: line.priceText, line_total: line.lineTotalMinor === null ? null : money(line.lineTotalMinor) })),
    currency: order.currency,
    subtotal: money(order.subtotalMinor),
    delivery_fee: money(order.deliveryFeeMinor),
    total: money(order.totalMinor),
    total_minor: order.totalMinor,
    paid: money(order.paidMinor),
    paid_minor: order.paidMinor,
    due: money(orderAmountDue(order)),
    pay_on_delivery: order.payOnDelivery,
    priced_by_team: order.pricedByTeam,
    fulfilment: order.fulfilment,
    zone: order.zone,
    address: order.address,
    wanted: order.wanted,
    hold_expires_at: order.holdExpiresAt,
    conflict: order.conflict,
    staff_note: order.staffNote,
    cancel_reason: order.cancelReason,
    code_to_check: order.codeToCheck ?? false,
    pay_link: orderPayLink(order),
    session_id: order.sessionId,
    customer_id: order.customerId,
    created_at: order.createdAt,
    confirmed_at: order.confirmedAt,
    completed_at: order.completedAt,
  };
}

const publicPayment = (payment: Payment) => ({
  id: payment.id, method: payment.method, status: payment.status, amount: formatMoney(payment.amountMinor, payment.currency),
  code: payment.method === "mpesa_code" ? payment.providerReference : null, receipt: payment.receipt, failure: payment.failure, created_at: payment.createdAt, settled_at: payment.settledAt,
});

export function registerOrderRoutes(app: Express, config: PlatformConfig): void {
  const secret = config.sessionTokenSecret;
  const form = express.urlencoded({ extended: false, limit: "4kb" });
  const host = (req: Request) => (config.publicBaseUrl ? new URL(config.publicBaseUrl).host : req.get("host") ?? "");

  // ── The customer's page ───────────────────────────────────────────────
  const withOrder = (handler: (req: Request, res: Response, found: { business: Business; order: Order }) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        pageHeaders(res);
        const found = await orderForPage(String(req.params.token ?? ""));
        if (!found) {
          res.status(404).type("html").send(NOT_FOUND_PAGE);
          return;
        }
        await runForBusiness(found.business.id, () => handler(req, res, found));
      } catch (error) {
        next(error);
      }
    };
  const back = (res: Response, token: string, query: string) => res.redirect(303, `/pay/o/${encodeURIComponent(token)}${query ? `?${query}` : ""}`);

  /** Payment attempts per order and per visitor, as for bookings; false (and redirected) when over. */
  async function allowed(req: Request, res: Response, business: Business, order: Order, options: { prompt?: boolean } = {}): Promise<boolean> {
    const policy = await getBookingSettings(business.id);
    const verdict = await consumeLimits([
      { key: `pay:order:${order.id}`, limit: policy.payAttemptsLimit, windowSeconds: 600 },
      { key: `pay:visitor:${visitorKey(secret, req.ip)}`, limit: 40, windowSeconds: 3600 },
      ...(options.prompt ? [{ key: `pay:prompt:${order.id}`, limit: policy.mpesaPromptsLimit, windowSeconds: 600 }] : []),
    ]);
    if (!verdict.allowed) back(res, order.payToken, "m=too_many");
    return verdict.allowed;
  }

  app.get("/pay/o/:token", withOrder(async (req, res, { business, order }) => {
    const now = new Date();
    let list = await paymentsOfOrder(business.id, order.id);
    let current = order;
    const prompt = list.find((payment) => payment.status === "pending" && payment.method === "mpesa_express");
    if (prompt) {
      await checkMpesaPayment(business, prompt);
      list = await paymentsOfOrder(business.id, order.id);
      current = (await orderByPayToken(business.id, order.payToken)) ?? order;
    }
    const { pending, lastFailure } = paymentState(list, now, req.query.returned === "1");
    const [settings, policy, orderSettings, connector] = await Promise.all([getBusinessSettings(business.id), getBookingSettings(business.id), getOrderSettings(business.id), connectorFor(business)]);
    const message = typeof req.query.m === "string" && req.query.m in ORDER_MESSAGES ? req.query.m : null;
    res.type("html").send(renderOrderPage({
      businessName: settings?.displayName ?? business.name,
      brand: {
        cssUrl: `/c/${encodeURIComponent(business.id)}/brand.css?v=${(settings?.widgetColor ?? "0f766e").replace("#", "")}`,
        logoUrl: brandAssetUrl("", business.id, (await brandAssetsOf(business.id)).logo),
      },
      order: current,
      options: paymentOptionsOf(policy),
      due: orderAmountDue(current),
      pending,
      lastFailure,
      message,
      collectionPoint: orderSettings.collectionPoint,
      contactLine: await connector.contactLine(business),
      timeZone: business.timeZone,
      now,
      host: host(req),
      token: order.payToken,
    }));
  }));

  app.get("/pay/o/:token/status", withOrder(async (_req, res, { business, order }) => {
    const list = await paymentsOfOrder(business.id, order.id);
    res.json({
      reference: order.reference, status: order.status, hold_expires_at: order.holdExpiresAt,
      total_minor: order.totalMinor, paid_minor: order.paidMinor, due_minor: orderAmountDue(order), currency: order.currency,
      payments: list.map((payment) => ({ method: payment.method, status: payment.status, amount_minor: payment.amountMinor, created_at: payment.createdAt })),
    });
  }));

  app.post("/pay/o/:token/paystack", form, withOrder(async (req, res, { business, order }) => {
    if (!(await allowed(req, res, business, order))) return;
    const started = await startOrderPaystack(business, order, { email: typeof req.body?.email === "string" ? req.body.email : null });
    if (!started.ok) return back(res, order.payToken, `m=${started.code}`);
    res.redirect(303, started.redirect!);
  }));

  app.get("/pay/o/:token/done", withOrder(async (req, res, { business, order }) => {
    const reference = typeof req.query.reference === "string" ? req.query.reference : typeof req.query.trxref === "string" ? req.query.trxref : "";
    if (/^zb_[0-9a-f]{24}$/.test(reference)) {
      const payment = (await paymentsOfOrder(business.id, order.id)).find((entry) => entry.method === "paystack" && entry.providerReference === reference);
      if (payment) await checkPaystackPayment(business, payment);
    }
    back(res, order.payToken, "returned=1");
  }));

  app.post("/pay/o/:token/mpesa", form, withOrder(async (req, res, { business, order }) => {
    if (!(await allowed(req, res, business, order, { prompt: true }))) return;
    const started = await startOrderMpesa(business, order, { phone: typeof req.body?.phone === "string" ? req.body.phone : "" });
    back(res, order.payToken, started.ok ? "m=sent" : `m=${started.code}`);
  }));

  app.post("/pay/o/:token/mpesa-code", form, withOrder(async (req, res, { business, order }) => {
    if (!(await allowed(req, res, business, order))) return;
    const code = mpesaCode(typeof req.body?.code === "string" ? req.body.code : "");
    if (!code) return back(res, order.payToken, "m=code_invalid");
    const result = await submitOrderCode(business, order, code);
    if (!result.ok) return back(res, order.payToken, `m=${result.reason === "used" ? "code_used" : result.reason === "not_taken" ? "not_available" : result.reason}`);
    back(res, order.payToken, "m=code");
  }));

  // ── The team's side ───────────────────────────────────────────────────
  const staff = requireStaff(secret);
  const base = "/v1/staff/businesses/:businessId";
  const role = (minimum: "viewer" | "agent" | "manager" | "owner") => [staff, requireBusinessRole(minimum)];
  const handle = (fn: (req: Request, res: Response, context: { business: Business; userId: string }) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const context = staffOf(req);
        await fn(req, res, { business: context.business!, userId: context.user.id });
      } catch (error) {
        next(error);
      }
    };
  const reasonOf = (req: Request) => (typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim().slice(0, 300) : null);
  /** Sends the change's result, and tells the customer what it means for them. */
  const changed = (res: Response, business: Business, change: OrderChange, tell: (order: Order) => Promise<void> | void) => {
    if (!change.ok) return res.status(change.error === "not_found" ? 404 : 409).json(change);
    void tell(change.order);
    res.json(publicOrder(change.order));
  };

  app.get(`${base}/orders`, ...role("viewer"), handle(async (req, res, { business }) => {
    const filter = (orderFilters as string[]).includes(String(req.query.filter)) ? req.query.filter as OrderFilter : "needs_you";
    const [list, counts] = await Promise.all([listOrders(business.id, filter), orderCounts(business.id)]);
    res.json({ orders: list.map(publicOrder), counts: { needs_you: counts.needsYou, active: counts.active } });
  }));

  app.get(`${base}/orders/:orderId`, ...role("viewer"), handle(async (req, res, { business }) => {
    const order = await getOrder(business.id, String(req.params.orderId));
    if (!order) return res.status(404).json({ error: "not_found" });
    const list = await paymentsOfOrder(business.id, order.id);
    res.json({ ...publicOrder({ ...order, codeToCheck: list.some((payment) => payment.method === "mpesa_code" && payment.status === "pending") }), payments: list.map(publicPayment) });
  }));

  app.post(`${base}/orders/:orderId/accept`, ...role("agent"), handle(async (req, res, { business }) => {
    const total = req.body?.total === undefined || req.body?.total === null || req.body?.total === "" ? null : toMinor(req.body.total);
    if (req.body?.total !== undefined && req.body?.total !== null && req.body?.total !== "" && !total) return res.status(400).json({ error: "invalid_total", message: "The total, delivery included, like 5170." });
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : null;
    const change = await acceptOrder(business.id, String(req.params.orderId), { totalMinor: total, note });
    changed(res, business, change, async (order) => {
      // Accepted to be paid on delivery: confirmed now, so the business's own system hears too.
      if (order.status === "confirmed") void sendIntegrationEvent(business, { kind: "order", what: "new", orderId: order.id });
      await tellOrderCustomer(business, order, order.status === "awaiting_payment" ? "awaiting_payment" : "confirmed");
    });
  }));

  app.post(`${base}/orders/:orderId/decline`, ...role("agent"), handle(async (req, res, { business }) => {
    const current = await getOrder(business.id, String(req.params.orderId));
    if (current && current.status !== "requested") return res.status(409).json({ ok: false, error: "wrong_status", message: "Only an order waiting for you can be declined: cancel it instead." });
    const reason = reasonOf(req);
    const change = await cancelOrder(business.id, String(req.params.orderId), reason);
    changed(res, business, change, (order) => tellOrderCustomer(business, order, "declined", reason));
  }));

  app.post(`${base}/orders/:orderId/cancel`, ...role("agent"), handle(async (req, res, { business }) => {
    const reason = reasonOf(req);
    const change = await cancelOrder(business.id, String(req.params.orderId), reason);
    changed(res, business, change, (order) => tellOrderCustomer(business, order, "cancelled", reason));
  }));

  app.post(`${base}/orders/:orderId/status`, ...role("agent"), handle(async (req, res, { business }) => {
    const to = req.body?.to as OrderStatus;
    if (!["out_for_delivery", "ready_for_collection", "completed"].includes(to) || !orderStatuses.includes(to)) {
      return res.status(400).json({ error: "invalid_status", message: "to is out_for_delivery, ready_for_collection or completed." });
    }
    const change = await advanceOrder(business.id, String(req.params.orderId), to);
    changed(res, business, change, (order) => tellOrderCustomer(business, order, to as "out_for_delivery" | "ready_for_collection" | "completed"));
  }));

  /** An order's M-Pesa code waiting for the team. */
  async function pendingOrderCode(business: Business, paymentId: string): Promise<(Payment & { orderId: string }) | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return undefined;
    const [row] = await inBusiness((db) => db.select().from(payments).where(and(eq(payments.businessId, business.id), eq(payments.id, paymentId))).limit(1), business.id);
    return row?.orderId ? (row as Payment & { orderId: string }) : undefined;
  }

  app.post(`${base}/order-payments/:paymentId/confirm`, ...role("agent"), handle(async (req, res, { business, userId }) => {
    const payment = await pendingOrderCode(business, String(req.params.paymentId));
    if (!payment) return res.status(404).json({ error: "not_found" });
    if (payment.status !== "pending" || payment.method !== "mpesa_code") return res.status(409).json({ error: "wrong_status", message: "Only an M-Pesa code waiting for the team can be confirmed." });
    const settled = await settleOrderPayment(business.id, payment.id, { succeeded: true, receipt: payment.providerReference, recordedBy: userId });
    await afterOrderSettlement(business, settled);
    res.json(publicOrder(settled!.order));
  }));

  app.post(`${base}/order-payments/:paymentId/reject`, ...role("agent"), handle(async (req, res, { business, userId }) => {
    const payment = await pendingOrderCode(business, String(req.params.paymentId));
    if (!payment) return res.status(404).json({ error: "not_found" });
    if (payment.status !== "pending" || payment.method !== "mpesa_code") return res.status(409).json({ error: "wrong_status", message: "Only an M-Pesa code waiting for the team can be rejected." });
    const reason = reasonOf(req);
    const settled = await settleOrderPayment(business.id, payment.id, { succeeded: false, rejected: true, failure: reason ?? "The team didn't find this payment in the M-Pesa statement.", recordedBy: userId });
    // The items stay kept for the business's usual time, for the customer to pay again.
    await holdOrderWhileChecking(business.id, payment.orderId, (await getOrderSettings(business.id)).holdMinutes / 60);
    const order = (await getOrder(business.id, payment.orderId)) ?? settled!.order;
    void tellOrderCustomer(business, order, "code_rejected", reason);
    res.json(publicOrder(order));
  }));

  app.get(`${base}/order-settings`, ...role("viewer"), handle(async (_req, res, { business }) => {
    res.json(publicOrderSettings(await getOrderSettings(business.id)));
  }));

  app.put(`${base}/order-settings`, ...role("manager"), handle(async (req, res, { business, userId }) => {
    const checked = validateOrderSettings(req.body && typeof req.body === "object" ? req.body : {}, await getOrderSettings(business.id));
    if (!checked.ok) return res.status(400).json({ error: "invalid_settings", message: checked.error });
    await updateBusinessSettings(business.id, { orderSettings: checked.value }, userId);
    res.json(publicOrderSettings(checked.value));
  }));
}

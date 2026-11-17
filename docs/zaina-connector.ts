// zaina-connector.ts: connect your own shop or system to Zaina (Bila Matata).
//
// Drop this file into your TypeScript server, fill in the functions for what
// your system can do, and mount it at one https address. Bila Matata enters
// that address and gives you the connection secret (keep it in an
// environment variable, never in code). The full contract is in
// docs/INTEGRATION.md; this file already does the signature check, the
// timestamp window, repeat protection and the answer shapes.
//
// Express:
//   import express from "express";
//   import { handleZaina } from "./zaina-connector";
//   app.post("/zaina", express.raw({ type: "*/*", limit: "64kb" }), async (req, res) => {
//     const out = await handleZaina(req.body, req.headers, process.env.ZAINA_SECRET!, handlers);
//     res.status(out.status).json(out.body);
//   });
//
// Next.js (app/zaina/route.ts):
//   export async function POST(request: Request) {
//     const raw = Buffer.from(await request.arrayBuffer());
//     const out = await handleZaina(raw, Object.fromEntries(request.headers), process.env.ZAINA_SECRET!, handlers);
//     return Response.json(out.body, { status: out.status });
//   }
//
// Prices are integers in the smallest unit: KSh 2,500 is { amount_minor: 250000, currency: "KES" }.
// Zaina never collects money: checkout links and payment links are your own.

import { createHmac, timingSafeEqual } from "node:crypto";

export type Price = { amount_minor: number; currency: string };
export type Item = {
  id: string; name: string; summary?: string; price?: Price; available?: boolean; stock?: number; url?: string;
  options?: Array<{ id: string; name: string; price?: Price; available?: boolean; stock?: number }>;
};
export type Contact = { name: string; phone?: string; email?: string };
/** Set only when the customer is signed in on your site and you gave the chat a token for them (see INTEGRATION.md). */
export type Customer = { id: string; name?: string; email?: string; phone?: string } | null;
export type Line = { id: string; option_id?: string; quantity: number };

/** What your system can do. Leave out what it can't; Bila Matata switches on only what you have. */
export type Handlers = {
  /** "Test the connection". */
  ping?: () => Promise<{ system: string }>;
  /** Up to `limit` products matching the customer's words. */
  search?: (args: { query: string; limit: number }, customer: Customer) => Promise<Item[]>;
  /** One product; null when there's no such id. */
  item?: (args: { id: string }, customer: Customer) => Promise<Item | null>;
  /** What's free or in stock for a date, a stay, a quantity. */
  availability?: (args: { item_id?: string; date?: string; from?: string; to?: string; time?: string; quantity?: number; guests?: number }, customer: Customer) =>
    Promise<{ available: boolean; options?: Array<{ label: string; starts_at?: string; price?: Price }>; note?: string }>;
  /**
   * Where an order stands. Answer only when the phone or email given (or the
   * signed-in customer) matches the order; null otherwise.
   */
  orderStatus?: (args: { reference: string; phone?: string; email?: string }, customer: Customer) =>
    Promise<{ reference: string; status: string; summary?: string; updated_at?: string; tracking_url?: string; next_step?: string } | null>;
  /** A basket in your own shop, and its checkout address: the customer pays you there. */
  checkoutLink?: (args: { items: Line[]; contact: Contact }, customer: Customer) => Promise<{ url: string; total?: Price; expires_at?: string }>;
  /**
   * Place an order in your system (only when "Let Zaina write" is on). The
   * total and how to pay are yours: a payment_url on your site, or
   * instructions such as your till number.
   */
  createOrder?: (args: { items: Line[]; fulfilment: "delivery" | "collection"; area?: string; when?: string; notes?: string; contact: Contact }, customer: Customer, requestId: string) =>
    Promise<{ reference: string; status: string; summary?: string; total?: Price; url?: string; payment_url?: string; payment_instructions?: string }>;
  /** Book in your system (only when "Let Zaina write" is on). */
  createBooking?: (args: { item_id: string; date?: string; time?: string; from?: string; to?: string; guests?: number; quantity?: number; notes?: string; contact: Contact }, customer: Customer, requestId: string) =>
    Promise<{ reference: string; status: string; summary?: string; url?: string; payment_url?: string }>;
};

type Headers = Record<string, string | string[] | undefined>;
const header = (headers: Headers, name: string) => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
};

/** True when the request was signed by Zaina with your secret, within five minutes of your clock. */
export function fromZaina(rawBody: Buffer | string, headers: Headers, secret: string, now = Date.now()): boolean {
  const timestamp = header(headers, "x-zaina-timestamp");
  if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = Buffer.from(`v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`);
  const given = Buffer.from(header(headers, "x-zaina-signature"));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// A retried write must not place an order twice: answers to recent writes are kept for ten minutes.
const recentWrites = new Map<string, { at: number; out: { status: number; body: unknown } }>();

/** Checks the request and answers it with your handlers. Never throws. */
export async function handleZaina(rawBody: Buffer | string, headers: Headers, secret: string, handlers: Handlers): Promise<{ status: number; body: unknown }> {
  if (!secret || !fromZaina(rawBody, headers, secret)) return { status: 401, body: { error: "unauthorized" } };
  let request: { action?: string; args?: any; customer?: Customer };
  try {
    request = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: { error: "bad_request" } };
  }
  const args = request.args ?? {};
  const customer = request.customer ?? null;
  const requestId = header(headers, "x-zaina-request");
  const notFound = { status: 404, body: { error: "not_found" } };
  const write = request.action === "order.create" || request.action === "booking.create";
  if (write && requestId) {
    const now = Date.now();
    for (const [id, entry] of recentWrites) if (now - entry.at > 10 * 60_000) recentWrites.delete(id);
    const seen = recentWrites.get(requestId);
    if (seen) return seen.out;
  }
  try {
    let out: { status: number; body: unknown };
    switch (request.action) {
      case "ping": {
        const supported = [
          handlers.search && "catalog.search", handlers.item && "catalog.item", handlers.availability && "availability",
          handlers.orderStatus && "order.status", handlers.checkoutLink && "checkout.link",
          handlers.createOrder && "order.create", handlers.createBooking && "booking.create",
        ].filter(Boolean);
        out = { status: 200, body: { ok: true, system: (await handlers.ping?.())?.system ?? "Our system", actions: supported } };
        break;
      }
      case "catalog.search":
        if (!handlers.search) return notFound;
        out = { status: 200, body: { items: (await handlers.search({ query: String(args.query ?? ""), limit: Math.min(Number(args.limit) || 6, 6) }, customer)).slice(0, 6) } };
        break;
      case "catalog.item": {
        const found = handlers.item ? await handlers.item({ id: String(args.id ?? "") }, customer) : null;
        out = found ? { status: 200, body: { item: found } } : notFound;
        break;
      }
      case "availability":
        if (!handlers.availability) return notFound;
        out = { status: 200, body: await handlers.availability(args, customer) };
        break;
      case "order.status": {
        const order = handlers.orderStatus ? await handlers.orderStatus(args, customer) : null;
        out = order ? { status: 200, body: { order } } : notFound;
        break;
      }
      case "checkout.link":
        if (!handlers.checkoutLink) return notFound;
        out = { status: 200, body: await handlers.checkoutLink(args, customer) };
        break;
      case "order.create":
        if (!handlers.createOrder) return notFound;
        out = { status: 200, body: { order: await handlers.createOrder(args, customer, requestId) } };
        break;
      case "booking.create":
        if (!handlers.createBooking) return notFound;
        out = { status: 200, body: { booking: await handlers.createBooking(args, customer, requestId) } };
        break;
      default:
        return notFound;
    }
    if (write && requestId) recentWrites.set(requestId, { at: Date.now(), out });
    return out;
  } catch (error) {
    console.error("[zaina] request failed:", error);
    return { status: 500, body: { error: "failed" } };
  }
}

/**
 * For a signed-in customer: a token to put on the chat's script tag
 * (data-customer-token="…"), so Zaina can look up their orders without asking.
 */
export function customerToken(secret: string, customer: { id: string; name?: string; email?: string; phone?: string }, seconds = 3600): string {
  const payload = Buffer.from(JSON.stringify({ sub: customer.id, name: customer.name, email: customer.email, phone: customer.phone, exp: Math.floor(Date.now() / 1000) + seconds })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

// src/booking/one-tap.ts
//
// Accepting or declining a booking request in one tap, from the alert email:
// for a business that answers from a phone, between customers.
//
//   GET  /act/:token   what the request is, and one button (Accept, or Decline with an optional reason)
//   POST /act/:token   does it, as the team member the email was for, and tells the customer
//
// The link is signed for one person, one booking and one action, and lasts
// three days. Opening it changes nothing (email scanners open links): only
// the button does. It stops working when the person leaves the team, or
// once the request has been decided.

import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import type { PlatformConfig } from "../config.ts";
import { anyBusinessById } from "../businesses/registry.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { ownerPool } from "../db/platform-db.ts";
import { offerings, type Booking } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { acceptBooking, declineBooking, getBooking } from "./bookings.ts";
import { formatMoney } from "./money.ts";
import { bookingWhen, tellCustomer } from "./notices.ts";
import { rateLimited } from "../gateway/rate-limit.ts";

type Action = "accept" | "decline";
type Claims = { b: string; k: string; u: string; a: Action; e: number };

const LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;
let configured: { secret: string; baseUrl: string } | null = null;

export function configureOneTap(input: { secret: string; publicBaseUrl: string | null }): void {
  configured = input.publicBaseUrl ? { secret: input.secret, baseUrl: input.publicBaseUrl } : null;
}

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const sign = (secret: string, payload: string) => createHmac("sha256", `one-tap:${secret}`).update(payload).digest("base64url");

export function oneTapToken(secret: string, claims: Omit<Claims, "e">, now = Date.now()): string {
  const payload = encode(JSON.stringify({ ...claims, e: now + LIFETIME_MS }));
  return `${payload}.${sign(secret, payload)}`;
}

export function readOneTapToken(secret: string, token: string, now = Date.now()): Claims | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || payload.length > 600) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
    if ((claims.a !== "accept" && claims.a !== "decline") || typeof claims.b !== "string" || typeof claims.k !== "string" || typeof claims.u !== "string") return null;
    return claims.e > now ? claims : null;
  } catch {
    return null;
  }
}

/** The two links for one person, or null when the service has no public address. */
export function oneTapLinks(businessId: string, bookingId: string, userId: string): { accept: string; decline: string } | null {
  if (!configured) return null;
  const link = (action: Action) => `${configured!.baseUrl}/act/${oneTapToken(configured!.secret, { b: businessId, k: bookingId, u: userId, a: action })}`;
  return { accept: link("accept"), decline: link("decline") };
}

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PAGE_CSS = `:root{--ink:#14181a;--muted:#5d6663;--line:#e3e1db;--bg:#f6f5f1;--card:#fff;--brand:#0f766e;--bad:#b42318;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--ink:#f1f4f2;--muted:#a3afab;--line:#2a3431;--bg:#0e1412;--card:#151d1a;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:480px;margin:0 auto;padding:28px 16px 40px}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}
.business{margin:0;color:var(--muted);font-weight:600;font-size:14px}h1{margin:4px 0 14px;font-size:1.45rem;line-height:1.2}
dl{margin:0 0 18px;display:grid;grid-template-columns:auto 1fr;gap:6px 14px}dt{color:var(--muted)}dd{margin:0;font-weight:600;overflow-wrap:anywhere}
button{width:100%;min-height:52px;border:0;border-radius:14px;font:inherit;font-weight:700;font-size:17px;cursor:pointer;color:#fff;background:var(--brand)}
button.decline{background:var(--bad)}label{display:block;font-size:14px;color:var(--muted);margin-bottom:6px}
textarea{width:100%;min-height:76px;border:1px solid var(--line);border-radius:12px;padding:10px;font:inherit;background:var(--card);color:var(--ink);margin-bottom:14px}
p.note{color:var(--muted);font-size:14px;margin:14px 0 0}.done{font-size:1.1rem;font-weight:700}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><link rel="stylesheet" href="/act-assets/act.css"></head><body><main><div class="card">${body}</div></main></body></html>`;
}

const ACTION_CSP = ["default-src 'none'", "style-src 'self'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'"].join("; ");

export function registerOneTapRoutes(app: Express, config: PlatformConfig): void {
  configureOneTap({ secret: config.sessionTokenSecret, publicBaseUrl: config.publicBaseUrl });
  const form = express.urlencoded({ extended: false, limit: "4kb" });
  // Links are unguessable; this only stops a flood.
  const limit = rateLimited(config.sessionTokenSecret, "act", 60, 600);

  app.get("/act-assets/act.css", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("text/css").send(PAGE_CSS);
  });

  /** The claims, the booking and the person, or a page that says why not. */
  async function resolve(req: Request, res: Response) {
    res.setHeader("Content-Security-Policy", ACTION_CSP);
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const claims = readOneTapToken(config.sessionTokenSecret, String(req.params.token ?? ""));
    const gone = (message: string) => {
      res.status(410).type("html").send(page("This link has expired", `<h1>This link has expired</h1><p>${esc(message)}</p><p class="note">Open the booking in your Zaina dashboard instead.</p>`));
      return null;
    };
    if (!claims) return gone("Links in alert emails work for three days.");
    const business = await anyBusinessById(claims.b);
    if (!business) return gone("This business isn't on Zaina any more.");
    const { rows: [member] } = await ownerPool().query<{ role: string }>(
      "select role from staff_memberships where business_id = $1 and user_id = $2",
      [business.id, claims.u],
    );
    if (!member || member.role === "viewer") return gone("You're no longer on this business's team.");
    const booking = await getBooking(business.id, claims.k);
    if (!booking) return gone("That booking wasn't found.");
    const settings = await getBusinessSettings(business.id);
    const [offering] = await inBusiness((db) => db.select({ name: offerings.name }).from(offerings).where(and(eq(offerings.businessId, business.id), eq(offerings.id, booking.offeringId))).limit(1), business.id);
    return { claims, business, booking, name: settings?.displayName ?? business.name, offering: offering?.name ?? "Booking" };
  }

  const summary = (booking: Booking, offering: string, timeZone: string) => `<dl>
<dt>What</dt><dd>${esc(offering)}</dd>
<dt>When</dt><dd>${esc(bookingWhen(booking, timeZone))}</dd>
${booking.guests ? `<dt>Guests</dt><dd>${booking.guests}</dd>` : ""}
<dt>Customer</dt><dd>${esc(booking.customerName ?? "")}</dd>
<dt>Total</dt><dd>${esc(formatMoney(booking.totalMinor, booking.currency))}</dd>
<dt>Reference</dt><dd>${esc(booking.reference)}</dd>
</dl>`;

  app.get("/act/:token", limit, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const found = await resolve(req, res);
      if (!found) return;
      const { claims, booking, business, name, offering } = found;
      if (booking.status !== "requested") {
        return res.type("html").send(page("Already answered", `<p class="business">${esc(name)}</p><h1>This request is already answered</h1>${summary(booking, offering, business.timeZone)}<p class="done">It's ${esc(booking.status.replace(/_/g, " "))}.</p>`));
      }
      const accept = claims.a === "accept";
      res.type("html").send(page(accept ? "Accept this booking" : "Decline this booking", `<p class="business">${esc(name)}</p><h1>${accept ? "Accept this booking request?" : "Decline this booking request?"}</h1>${summary(booking, offering, business.timeZone)}
<form method="post">${accept ? "" : `<label for="reason">A reason for the customer (optional)</label><textarea id="reason" name="reason" maxlength="300" placeholder="Sorry, we're fully booked those dates."></textarea>`}<button type="submit"${accept ? "" : ' class="decline"'}>${accept ? "Accept" : "Decline"}</button></form>
<p class="note">${accept ? "The customer is told at once, with your payment link if a deposit is due." : "The customer is told at once, with your reason if you give one."}</p>`));
    } catch (error) {
      next(error);
    }
  });

  app.post("/act/:token", limit, form, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const found = await resolve(req, res);
      if (!found) return;
      const { claims, booking, business, name, offering } = found;
      if (booking.status !== "requested") {
        return res.type("html").send(page("Already answered", `<p class="business">${esc(name)}</p><h1>This request is already answered</h1><p class="done">It's ${esc(booking.status.replace(/_/g, " "))}.</p>`));
      }
      const reason = claims.a === "decline" && typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim().slice(0, 300) : null;
      const result = claims.a === "accept"
        ? await acceptBooking(business.id, booking.id, claims.u, {})
        : await declineBooking(business.id, booking.id, claims.u, reason);
      if (!result.ok) {
        return res.status(409).type("html").send(page("Couldn't do that", `<p class="business">${esc(name)}</p><h1>That didn't go through</h1><p>${esc(result.message ?? "The booking changed meanwhile.")}</p><p class="note">Open the booking in your Zaina dashboard.</p>`));
      }
      const notice = claims.a === "decline" ? "declined" : result.booking.status === "confirmed" ? "confirmed" : "accepted";
      void tellCustomer(business, result.booking, { name: offering }, notice, reason);
      res.type("html").send(page("Done", `<p class="business">${esc(name)}</p><h1>${claims.a === "accept" ? "Accepted" : "Declined"}</h1>${summary(result.booking, offering, business.timeZone)}<p class="done">${esc(booking.customerName ?? "The customer")} has been told.</p>`));
    } catch (error) {
      next(error);
    }
  });
}

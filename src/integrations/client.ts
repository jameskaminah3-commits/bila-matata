// src/integrations/client.ts
//
// Zaina asking a business's own system (its shop, booking system or
// back office) through the connector contract in docs/INTEGRATION.md.
//
// One HTTPS address per business. Every call is a POST of
//   { "action": "...", "args": {...}, "customer": {...} | null }
// signed with the business's connection secret:
//
//   X-Zaina-Business:  the business's id on Zaina
//   X-Zaina-Timestamp: seconds since 1970
//   X-Zaina-Request:   a fresh id per call (the same id is never sent twice)
//   X-Zaina-Signature: v1=<hex HMAC-SHA256(secret, timestamp + "." + body)>
//
// The address must be public https (the same checks as reading a website:
// no private networks, a fresh connection, our own DNS lookup), the answer
// must be JSON within 256 KB and 6 seconds, and redirects aren't followed.
// What comes back is data, never instructions: only the contract's fields are
// kept, every string is cut to size, and lists are capped.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { formatMoney } from "../booking/money.ts";
import { PublicFetchError, publicLookup, publicUrl } from "../net/public-fetch.ts";

export const READ_ACTIONS = ["catalog.search", "catalog.item", "availability", "order.status"] as const;
export const HANDOFF_ACTIONS = ["checkout.link"] as const;
export const WRITE_ACTIONS = ["booking.create"] as const;
export const ACTIONS = [...READ_ACTIONS, ...HANDOFF_ACTIONS, ...WRITE_ACTIONS] as const;
export type Action = (typeof ACTIONS)[number] | "ping";
export const EVENTS = ["lead.created", "booking.requested", "booking.confirmed", "chat.handoff"] as const;
export type EventName = (typeof EVENTS)[number];

export const isAction = (value: unknown): value is (typeof ACTIONS)[number] => (ACTIONS as readonly string[]).includes(String(value));
export const isEvent = (value: unknown): value is EventName => (EVENTS as readonly string[]).includes(String(value));
export const isWriteAction = (value: string) => (WRITE_ACTIONS as readonly string[]).includes(value);

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = Number(process.env.INTEGRATION_TIMEOUT_MS ?? "") || 6000;

export class IntegrationError extends Error {
  constructor(public code: "unreachable" | "timeout" | "bad_response" | "refused" | "not_found" | "rejected", message: string, public status = 0) {
    super(message);
  }
}

export function signature(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Checks a signature the other way (the store's events or a test's fake store use it). */
export function verifySignature(secret: string, timestamp: string, body: string, given: string, now = Date.now(), toleranceSeconds = 300): boolean {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > toleranceSeconds) return false;
  const expected = Buffer.from(signature(secret, timestamp, body));
  const actual = Buffer.from(String(given));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const lookup = publicLookup();

/** One signed POST to a public https address; the parsed JSON answer and the status. */
export async function signedPost(endpoint: string, secret: string, businessId: string, payload: unknown, timeoutMs = TIMEOUT_MS): Promise<{ status: number; body: any; ms: number }> {
  let url: URL;
  try {
    url = publicUrl(endpoint);
  } catch (error) {
    throw new IntegrationError("refused", (error as Error).message);
  }
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  let response: IncomingMessage;
  try {
    response = await new Promise<IncomingMessage>((resolve, reject) => {
      const sent = https.request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "Zaina/1.0 (connector)",
          "x-zaina-business": businessId,
          "x-zaina-timestamp": timestamp,
          "x-zaina-request": randomUUID(),
          "x-zaina-signature": signature(secret, timestamp, body),
        },
        lookup,
        agent: false,
        signal,
      }, resolve);
      sent.on("error", reject);
      sent.end(body);
    });
  } catch (error) {
    if (error instanceof PublicFetchError) throw new IntegrationError("refused", error.message);
    const name = (error as Error).name;
    throw name === "AbortError" || name === "TimeoutError"
      ? new IntegrationError("timeout", "Your system took too long to answer.")
      : new IntegrationError("unreachable", "Your system couldn't be reached.");
  }
  const status = response.statusCode ?? 0;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_BYTES) {
          response.destroy();
          reject(new IntegrationError("bad_response", "Your system's answer was too big."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve());
      response.on("error", () => reject(new IntegrationError("unreachable", "Your system's answer was cut off.")));
    });
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError("unreachable", "Your system's answer was cut off.");
  }
  const ms = Date.now() - started;
  if (status >= 300 && status < 400) throw new IntegrationError("bad_response", "Your system answered with a redirect; give the final address.", status);
  let parsed: any = null;
  try {
    parsed = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
  } catch {
    throw new IntegrationError("bad_response", `Your system's answer wasn't JSON (HTTP ${status}).`, status);
  }
  if (status === 404 && parsed?.error === "not_found") throw new IntegrationError("not_found", "Not found.", status);
  if (status === 401 || status === 403) throw new IntegrationError("rejected", "Your system refused Zaina's signature: check the connection secret.", status);
  if (status >= 400 || !parsed || typeof parsed !== "object") throw new IntegrationError("bad_response", `Your system answered HTTP ${status}${typeof parsed?.error === "string" ? ` (${parsed.error.slice(0, 80)})` : ""}.`, status);
  return { status, body: parsed, ms };
}

// ── What comes back, kept to the contract ─────────────────────────────────

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined);
const httpsUrl = (value: unknown) => {
  if (typeof value !== "string" || value.length > 1000) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};
const bool = (value: unknown) => (typeof value === "boolean" ? value : undefined);
const int = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1e12 ? value : undefined);

/** A price as the store gave it, and as Zaina should say it. */
function price(value: any) {
  const amount = int(value?.amount_minor);
  const currency = typeof value?.currency === "string" && /^[A-Z]{3}$/.test(value.currency) ? value.currency : undefined;
  if (amount === undefined || !currency) return undefined;
  return { amount_minor: amount, currency, say: formatMoney(amount, currency) };
}

const compact = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;

export function cleanItem(value: any) {
  if (!value || typeof value !== "object") return null;
  const id = text(value.id, 120);
  const name = text(value.name, 160);
  if (!id || !name) return null;
  const options = Array.isArray(value.options) ? value.options.slice(0, 12).map((option: any) => (option && text(option.id, 120) && text(option.name, 120)
    ? compact({ id: text(option.id, 120), name: text(option.name, 120), price: price(option.price), available: bool(option.available), stock: int(option.stock) })
    : null)).filter(Boolean) : undefined;
  return compact({ id, name, summary: text(value.summary, 400), price: price(value.price), available: bool(value.available), stock: int(value.stock), url: httpsUrl(value.url), options: options?.length ? options : undefined });
}

export function cleanAvailability(value: any) {
  const options = Array.isArray(value?.options) ? value.options.slice(0, 12).map((option: any) => (option && text(option.label, 160)
    ? compact({ label: text(option.label, 160), starts_at: text(option.starts_at, 40), price: price(option.price) })
    : null)).filter(Boolean) : [];
  return compact({ available: bool(value?.available) ?? options.length > 0, options, note: text(value?.note, 300) });
}

export function cleanOrder(value: any) {
  const reference = text(value?.reference, 80);
  const status = text(value?.status, 80);
  if (!reference || !status) return null;
  return compact({ reference, status, summary: text(value.summary, 400), updated_at: text(value.updated_at, 40), tracking_url: httpsUrl(value.tracking_url), next_step: text(value.next_step, 300) });
}

export function cleanCheckout(value: any) {
  const url = httpsUrl(value?.url);
  if (!url) return null;
  return compact({ url, total: price(value.total), expires_at: text(value.expires_at, 40) });
}

export function cleanBooking(value: any) {
  const reference = text(value?.reference, 80);
  const status = text(value?.status, 40);
  if (!reference || !status) return null;
  return compact({ reference, status, summary: text(value.summary, 400), url: httpsUrl(value.url), payment_url: httpsUrl(value.payment_url) });
}

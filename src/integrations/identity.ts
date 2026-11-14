// src/integrations/identity.ts
//
// A customer signed in on the business's own site, vouched for by its
// system. The site's server makes a short-lived token with the connection
// secret and gives it to the chat (data-customer-token on the script tag);
// Zaina checks it when the chat opens. Then she can look up that customer's
// orders without asking for their phone or email.
//
//   token   = base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, the first part))
//   claims  = { sub, name?, email?, phone?, exp }   (exp: seconds, at most 24 hours ahead)

import { createHmac, timingSafeEqual } from "node:crypto";
import { getSecret } from "../businesses/secrets.ts";
import type { VerifiedCustomer } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { liveIntegration, SECRET_NAME } from "./store.ts";

const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** For tests and the docs' examples: what the business's site does. */
export function customerToken(secret: string, claims: { sub: string; name?: string; email?: string; phone?: string; exp: number }): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function readCustomerToken(secret: string, token: string, now = Date.now()): VerifiedCustomer | null {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: any;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const seconds = now / 1000;
  if (typeof claims?.exp !== "number" || claims.exp <= seconds || claims.exp > seconds + 24 * 3600) return null;
  if (typeof claims.sub !== "string" || !claims.sub.trim() || claims.sub.length > 120) return null;
  const field = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max) : undefined);
  const customer: VerifiedCustomer = { id: claims.sub.trim() };
  const name = field(claims.name, 80);
  const email = field(claims.email, 200);
  const phone = field(claims.phone, 40);
  if (name) customer.name = name;
  if (email) customer.email = email.toLowerCase();
  if (phone) customer.phone = phone;
  return customer;
}

/** Records the signed-in customer on a new chat, when the business is connected and the token is good. */
export async function attachVerifiedCustomer(businessId: string, sessionId: string, token: unknown): Promise<boolean> {
  if (typeof token !== "string" || !token) return false;
  if (!(await liveIntegration(businessId))) return false;
  const secret = await getSecret(businessId, SECRET_NAME);
  const customer = secret ? readCustomerToken(secret, token) : null;
  if (!customer) return false;
  await inBusiness((_db, client) => client.query(`update chat_sessions set verified_customer = $3 where id = $1 and business_id = $2`, [sessionId, businessId, JSON.stringify(customer)]), businessId);
  return true;
}

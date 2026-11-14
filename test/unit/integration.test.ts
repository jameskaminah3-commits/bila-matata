import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanBooking, cleanCheckout, cleanItem, cleanOrder, signature, verifySignature } from "../../src/integrations/client.ts";
import { customerToken, readCustomerToken } from "../../src/integrations/identity.ts";
import { linksIn } from "../../src/engine/extras.ts";
import { sanitizeModelText } from "../../src/engine/reply-policy.ts";

const SECRET = "zk_unit-test-secret-0123456789abcdefghij";

test("a signature checks out once, within five minutes, for exactly that body", () => {
  const now = Date.UTC(2026, 10, 14, 12);
  const timestamp = String(now / 1000);
  const body = JSON.stringify({ action: "ping", args: {} });
  const signed = signature(SECRET, timestamp, body);
  assert.match(signed, /^v1=[0-9a-f]{64}$/);
  assert.ok(verifySignature(SECRET, timestamp, body, signed, now));
  assert.ok(!verifySignature(SECRET, timestamp, body.replace("ping", "pong"), signed, now));
  assert.ok(!verifySignature("zk_another", timestamp, body, signed, now));
  assert.ok(!verifySignature(SECRET, timestamp, body, signed, now + 6 * 60_000), "too old");
  assert.ok(!verifySignature(SECRET, "soon", body, signed, now));
});

test("a signed-in customer's token: short-lived, signed, and cut to size", () => {
  const now = Date.UTC(2026, 10, 14, 12);
  const exp = now / 1000 + 900;
  const token = customerToken(SECRET, { sub: "cust-42", name: "Amina\nOdhiambo", email: "Amina@Example.com", exp });
  assert.deepEqual(readCustomerToken(SECRET, token, now), { id: "cust-42", name: "Amina Odhiambo", email: "amina@example.com" });
  assert.equal(readCustomerToken("zk_wrong", token, now), null);
  assert.equal(readCustomerToken(SECRET, token, (exp + 1) * 1000), null, "expired");
  assert.equal(readCustomerToken(SECRET, customerToken(SECRET, { sub: "x", exp: now / 1000 + 2 * 86400 }), now), null, "too long-lived");
  assert.equal(readCustomerToken(SECRET, customerToken(SECRET, { sub: "", exp }), now), null);
  const [payload, sig] = token.split(".");
  const changed = Buffer.from(JSON.stringify({ sub: "cust-1", exp })).toString("base64url");
  assert.equal(readCustomerToken(SECRET, `${changed}.${sig}`, now), null);
  assert.equal(readCustomerToken(SECRET, payload, now), null);
});

test("what a business's system returns is kept to the contract", () => {
  const item = cleanItem({ id: "a", name: "Kikoi", price: { amount_minor: 250000, currency: "KES" }, url: "javascript:alert(1)", secret_cost: 1, summary: "x".repeat(900), options: [{ id: "o", name: "Blue", price: { amount_minor: -5, currency: "KES" } }] });
  assert.deepEqual(Object.keys(item!).sort(), ["id", "name", "options", "price", "summary"]);
  assert.equal(item!.summary!.length, 400);
  assert.equal(item!.price!.say, "KSh 2,500");
  assert.equal((item!.options as any[])[0].price, undefined, "a negative price isn't a price");
  assert.equal(cleanItem({ name: "no id" }), null);
  assert.equal(cleanOrder({ reference: "R1" }), null);
  assert.equal(cleanCheckout({ url: "http://shop.example/pay" }), null, "https only");
  assert.deepEqual(cleanBooking({ reference: "B1", status: "confirmed", payment_url: "https://pay.example/b1" }), { reference: "B1", status: "confirmed", payment_url: "https://pay.example/b1" });
});

test("links the business's own system returned may be passed on exactly; others are still removed", () => {
  const links = linksIn({ ok: true, checkout: { url: "https://shop.example/checkout/7f3a" }, items: [{ url: "https://shop.example/p/1" }, { url: "not a link" }] });
  assert.deepEqual(links, ["https://shop.example/checkout/7f3a", "https://shop.example/p/1"]);
  const text = "Pay here: https://shop.example/checkout/7f3a or here: https://evil.example/steal";
  const cleaned = sanitizeModelText(text, { customerTexts: [], allowedHosts: [], allowedUrls: links });
  assert.match(cleaned, /https:\/\/shop\.example\/checkout\/7f3a/);
  assert.doesNotMatch(cleaned, /evil\.example/);
  assert.doesNotMatch(sanitizeModelText("See https://shop.example/checkout/other", { customerTexts: [], allowedHosts: [], allowedUrls: links }), /checkout\/other/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { oneTapToken, readOneTapToken } from "../../src/booking/one-tap.ts";

const SECRET = "a-test-secret-that-is-long-enough-1234";
const claims = { b: "palm", k: "booking-1", u: "user-1", a: "accept" as const };

test("a one-tap token reads back for three days, then not", () => {
  const now = Date.UTC(2026, 10, 14, 9);
  const token = oneTapToken(SECRET, claims, now);
  assert.deepEqual({ ...readOneTapToken(SECRET, token, now + 1000)!, e: 0 }, { ...claims, e: 0 });
  assert.ok(readOneTapToken(SECRET, token, now + 3 * 86_400_000 - 1000));
  assert.equal(readOneTapToken(SECRET, token, now + 3 * 86_400_000 + 1000), null);
});

test("a changed token, another secret or another action is refused", () => {
  const token = oneTapToken(SECRET, claims);
  const [payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...claims, a: "decline", e: Date.now() + 1e9 })).toString("base64url");
  assert.equal(readOneTapToken(SECRET, `${forged}.${signature}`), null);
  assert.equal(readOneTapToken("another-secret-entirely-1234567890", token), null);
  assert.equal(readOneTapToken(SECRET, payload), null);
  assert.equal(readOneTapToken(SECRET, ""), null);
  const odd = oneTapToken(SECRET, { ...claims, a: "delete" as any });
  assert.equal(readOneTapToken(SECRET, odd), null);
});

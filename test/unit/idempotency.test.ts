import assert from "node:assert/strict";
import test from "node:test";
import { deriveIdempotencyKey, withServerIdempotencyKey } from "../../src/engine/idempotency.ts";

const booking = {
  service: "Haircut",
  day: "2026-12-01",
  time: "10:00",
  customer_name: "Jane Wanjiru",
  customer_email: "jane@example.com",
};

test("the model's own key is ignored and replaced by a server key", () => {
  const args = withServerIdempotencyKey("create_appointment", { ...booking, idempotency_key: "***masked***" }, "session-a");
  assert.match(args.idempotency_key, /^zaina_[0-9a-f]{40}$/);
  assert.notEqual(args.idempotency_key, "***masked***");
});

test("an identical retry in the same conversation gets the same key", () => {
  const first = deriveIdempotencyKey("session-a", "create_appointment", booking);
  const retry = deriveIdempotencyKey("session-a", "create_appointment", {
    ...booking,
    idempotency_key: "anything-else",
    customer_name: "  jane   WANJIRU ",
  });
  assert.equal(first, retry);
});

test("different conversations or different requests never share a key", () => {
  const a = deriveIdempotencyKey("session-a", "create_appointment", booking);
  assert.notEqual(a, deriveIdempotencyKey("session-b", "create_appointment", booking));
  assert.notEqual(a, deriveIdempotencyKey("session-a", "create_appointment", { ...booking, time: "11:00" }));
  assert.notEqual(a, deriveIdempotencyKey("session-a", "create_booking", booking));
});

test("read-only tools are left untouched", () => {
  assert.deepEqual(withServerIdempotencyKey("get_prices", { item: "Haircut" }, "session-a"), { item: "Haircut" });
});

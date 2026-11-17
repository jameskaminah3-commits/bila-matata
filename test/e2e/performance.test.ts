// End-to-end: the monthly Business Performance Report from a month of real
// activity at a market stall: a till payment the team checks, a card payment
// on Paystack, a pay-on-delivery order delivered, an order that lapsed, a
// visitor who only looked at prices, a question two customers asked, and a
// request the team marked lost. Every figure lands in its column: verified
// money (by who confirmed it) apart from expected money, and chats never
// counted as money.
//
// The model is scripted (scripted-model.mjs); Paystack is a stand-in.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5119;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://soko.example";

let platform: Platform;
let api: Api;
let ops = "";
let owner = "";
const staff = (method: string, route: string, body?: unknown, token = owner) => api(method, `/v1/staff/businesses/soko${route}`, body, token);
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;
const ids: Record<string, string> = {};

async function chat(intro?: string) {
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ business: "soko" }) });
  const token = (await opened.json() as { token: string }).token;
  if (intro) await say(token, intro);
  return token;
}
async function say(token: string, message: string) {
  const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: ORIGIN }, body: JSON.stringify({ message }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.reply as string;
}
/** A customer's order; its reference and payment link. */
async function order(name: string, phone: string, items: Array<[string, number]>, extra: Record<string, unknown> = {}) {
  const token = await chat(`Hi, I'm ${name}, ${phone}.`);
  const reply = await say(token, raw64("place_order", { items: items.map(([item, quantity]) => ({ id: ids[item], quantity })), fulfilment: "collection", name, phone, ...extra }));
  const result = JSON.parse(reply.split("\n")[0].replace(/^System said: /, ""));
  assert.equal(result.ok, true, reply);
  return { reference: result.reference as string, payToken: /\/pay\/o\/([A-Za-z0-9_-]{24,64})/.exec(reply)?.[1] ?? null };
}
const post = (path: string, fields: Record<string, string>) => fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
const orderId = async (reference: string) => (await platform.db.query("select id from orders where reference = $1", [reference])).rows[0].id as string;

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, BOOKING_SWEEP_INTERVAL_MS: "400", CUSTOMER_SWEEP_INTERVAL_MS: "300" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  const created = await api("POST", "/v1/platform/businesses", { id: "soko", name: "Soko Fresh", tier: "full", business_type: "general", allowed_origins: [ORIGIN], owner: { email: "soko@example.com", name: "Owner", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  owner = (await api("POST", "/v1/staff/login", { email: "soko@example.com", password: PASSWORD })).body.token;
  assert.equal((await staff("PUT", "/capabilities", { enabled: ["orders"] })).status, 200);
  for (const item of [{ name: "Tomatoes", price: "120", unit: "per kg" }, { name: "Sukuma wiki", price: "30", unit: "per bunch" }]) assert.equal((await staff("POST", "/price-list", item)).status, 201);
  for (const item of (await staff("GET", "/price-list")).body.items) ids[item.name] = item.id;
  assert.equal((await staff("PUT", "/order-settings", { collection: true, pay_on_delivery: true })).status, 200);
  assert.equal((await staff("PUT", "/payments/mpesa-manual", { type: "till", number: "5566778" })).status, 200);
  assert.equal((await staff("PUT", "/payments/paystack", { mode: "own_keys", secret_key: "sk_test_soko000000000000001" }, ops)).status, 200);
});

after(async () => {
  await platform?.stop();
});

test("a month at the stall", async () => {
  // Paid at the till; the team finds the code in its statement (verified, recorded by the team).
  const till = await order("Achieng Otieno", "0711 222 333", [["Tomatoes", 3]]);
  await post(`/pay/o/${till.payToken}/mpesa-code`, { code: "QK12ABC34D" });
  const code = (await staff("GET", `/orders/${await orderId(till.reference)}`)).body.payments[0];
  assert.equal((await staff("POST", `/order-payments/${code.id}/confirm`, {})).status, 200);

  // Paid by card on Paystack (verified, confirmed by the provider).
  const card = await order("Brian Ouma", "0733 111 222", [["Sukuma wiki", 10]]);
  const started = await post(`/pay/o/${card.payToken}/paystack`, { email: "brian@example.com" });
  const reference = /fake_(zb_[0-9a-f]{24})$/.exec(started.headers.get("location") ?? "")![1];
  platform.payOnPaystack(reference);
  await fetch(`${BASE}/pay/o/${card.payToken}/done?reference=${reference}`, { redirect: "manual" });

  // Paid on delivery and marked delivered (expected: nobody confirmed the money).
  const cash = await order("Akinyi Were", "0722 987 654", [["Tomatoes", 2]], { pay_on_delivery: true });
  assert.equal((await staff("POST", `/orders/${await orderId(cash.reference)}/status`, { to: "completed" })).status, 200);

  // Never paid: it lapses.
  const lapsed = await order("Otieno Kamau", "0799 555 444", [["Sukuma wiki", 7]]);
  await platform.db.query("update orders set hold_expires_at = now() - interval '1 minute' where reference = $1", [lapsed.reference]);
  await eventually(async () => (await platform.db.query("select status from orders where reference = $1", [lapsed.reference])).rows[0].status === "expired", "the order lapses");

  // Looked at prices and left; two people ask the same thing; a request the team lost.
  await say(await chat(), raw64("get_prices", { query: "tomatoes" }));
  await say(await chat(), "TEST:ask Do you deliver on Sundays?");
  await say(await chat(), "TEST:ask do you deliver on sundays");
  const asker = await chat("Hi, I'm Njeri Mwangi, 0700 123 456.");
  await say(asker, raw64("pass_request_to_team", { request: "A weekly box of vegetables for a restaurant", name: "Njeri Mwangi", phone: "0700 123 456" }));
  const lead = (await staff("GET", "/leads?status=all")).body.leads.find((entry: any) => entry.name === "Njeri Mwangi");
  assert.equal((await staff("PATCH", `/leads/${lead.id}`, { status: "lost" })).status, 200);
});

test("the report: who got in touch, who paid, verified money apart from expected, and what slipped away", async () => {
  const body = await eventually(async () => {
    const response = (await staff("GET", "/performance")).body;
    return response.report.customers.identified === 5 ? response : null;
  }, "every chat with contact details is filed under its customer");
  const r = body.report;
  assert.equal(r.partial, true, "this month, so far");
  assert.deepEqual(r.customers, { contacted: 8, identified: 5, unidentified: 3, new: 5, returning: 0 });
  assert.deepEqual(r.paying, { customers: 2, payments: 2, share: 25 });

  const show = (list: Array<{ display: string }>) => list.map((entry) => entry.display);
  assert.deepEqual(show(r.revenue.verified.byTeam), ["KSh 360"], "the till payment the team checked");
  assert.deepEqual(show(r.revenue.verified.byProvider), ["KSh 300"], "Paystack's");
  assert.deepEqual(show(r.revenue.verified.total), ["KSh 660"]);
  assert.deepEqual(show(r.revenue.verified.throughChats), ["KSh 660"]);
  assert.deepEqual([r.revenue.expected.payOnDeliveryDelivered.count, show(r.revenue.expected.payOnDeliveryDelivered.value)], [1, ["KSh 240"]], "delivered, paid in cash: expected, never verified");

  assert.deepEqual(r.interest.map((entry: any) => [entry.name, entry.asked, entry.bought]), [["Tomatoes", 1, 2], ["Sukuma wiki", 0, 1]]);
  assert.deepEqual([r.lost.lapsedOrders.count, show(r.lost.lapsedOrders.value)], [1, ["KSh 210"]]);
  assert.equal(r.lost.browsedAndLeft, 1, "looked at prices, left no details");
  assert.deepEqual(r.notConverted.map((entry: any) => [entry.kind, entry.why]).sort(), [["order", "Not paid in time"], ["request", "Your team marked it not going ahead"]]);
  assert.equal(r.notConverted.find((entry: any) => entry.kind === "request").customer, "Njeri Mwangi");
  assert.deepEqual(r.questions.map((entry: any) => [entry.chats, entry.zainaCouldntAnswer]), [[2, true]]);
  assert.match(r.questions[0].question, /deliver on sundays/i);

  assert.equal(r.timeSaved.chatsWithoutTeam, 8);
  assert.equal(r.timeSaved.bookingsAndOrders, 3, "the two paid orders and the one paid on delivery");
  assert.ok(r.timeSaved.automaticUpdates >= 6, "status updates sent to customers");
  assert.equal(r.timeSaved.minutes, 8 * 4 + 3 * 5 + r.timeSaved.automaticUpdates);
  assert.deepEqual(r.lastMonth, { contacted: 0, payingCustomers: 0, verified: [] });

  assert.equal(body.months[0], r.month);
  assert.equal((await staff("GET", "/performance?month=2019-01")).body.report.month, r.month, "before the business joined: this month instead");
});

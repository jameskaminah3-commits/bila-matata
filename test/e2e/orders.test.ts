// End-to-end: an order from the catalogue, from the chat to the customer's
// door, with no one typing a message to the customer.
//
//   Mama Mboga's stall counts its tomatoes, delivers to two areas with a fee
//   each, takes orders of KSh 200 and up, and takes payment by M-Pesa till,
//   by Paystack, or on delivery. Zaina places the order; the server prices
//   it, adds the delivery fee and keeps the stock; the order's own link takes
//   payment into the business's own accounts; the payment confirms it; the
//   team moves it on and the customer hears every step; an unpaid order
//   lapses and puts its stock back.
//
// The model is scripted (scripted-model.mjs); Paystack and M-Pesa are stand-ins.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5116;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://mboga.example";

let platform: Platform;
let api: Api;
let ops = "";
let owner = "";
const staff = (method: string, route: string, body?: unknown, token = owner) => api(method, `/v1/staff/businesses/mboga${route}`, body, token);
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;
// The tool's result as Zaina got it; the order's link is added under the reply when she leaves it out.
const said = (reply: string) => {
  const result = JSON.parse(reply.split("\n")[0].replace(/^(System|Tool) said: /, ""));
  const link = /\n\nPay for your order here:\n(\S+)$/.exec(reply)?.[1];
  return link ? { ...result, payment_link: link } : result;
};
const ids: Record<string, string> = {};
const stock = async (name: string) => (await platform.db.query("select stock_quantity from price_items where business_id = 'mboga' and name = $1", [name])).rows[0].stock_quantity as number;
const orderRow = async (reference: string) => (await platform.db.query("select * from orders where reference = $1", [reference])).rows[0];
const tokenOf = (link: string) => /\/pay\/o\/([A-Za-z0-9_-]{24,64})$/.exec(link)?.[1] ?? assert.fail(`not an order link: ${link}`);

type Chat = { token: string };
async function openChat(): Promise<Chat> {
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ business: "mboga" }) });
  assert.equal(opened.status, 201);
  return opened.json() as Promise<Chat>;
}
async function say(chat: Chat, message: string) {
  const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chat.token}`, origin: ORIGIN }, body: JSON.stringify({ message }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.reply as string;
}
async function heard(chat: Chat, text: string) {
  return eventually(async () => {
    const response = await fetch(`${BASE}/v1/chat/messages`, { headers: { authorization: `Bearer ${chat.token}` } });
    return ((await response.json()) as any).messages.find((message: { from: string; text: string }) => message.from === "zaina" && message.text.includes(text));
  }, `the customer hears "${text}"`);
}
async function post(path: string, fields: Record<string, string> = {}) {
  const response = await fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
  return { status: response.status, location: response.headers.get("location") ?? "" };
}
/** A customer who has said who they are, so Zaina may use their name and number. */
async function customer(name = "Wanjiru Kamau", phone = "0722 345 678") {
  const chat = await openChat();
  await say(chat, `Hi, I'm ${name}, ${phone}. I'd like to order some vegetables.`);
  return { chat, who: { name, phone } };
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, BOOKING_SWEEP_INTERVAL_MS: "400" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  const created = await api("POST", "/v1/platform/businesses", { id: "mboga", name: "Mama Mboga Fresh", tier: "full", business_type: "general", allowed_origins: [ORIGIN], owner: { email: "mboga@example.com", name: "Mama Mboga", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  owner = (await api("POST", "/v1/staff/login", { email: "mboga@example.com", password: PASSWORD })).body.token;
});

after(async () => {
  await platform?.stop();
});

test("the stall sets up: what it sells and how many are left, where it delivers and for how much, and its M-Pesa till", async () => {
  assert.equal((await staff("PUT", "/capabilities", { enabled: ["orders"] })).status, 200);
  for (const item of [
    { name: "Sukuma wiki", price: "30", unit: "per bunch", stock: 50 },
    { name: "Tomatoes", price: "120", unit: "per kg", stock: 3 },
    { name: "Avocado", price: "20" },
  ]) {
    const added = await staff("POST", "/price-list", item);
    assert.equal(added.status, 201, JSON.stringify(added.body));
    ids[item.name] = added.body.id ?? added.body.item?.id;
  }
  const settings = await staff("PUT", "/order-settings", {
    delivery: true, zones: [{ name: "Kawangware", fee: 100 }, { name: "Kilimani", fee: "200" }],
    collection: true, collection_point: "Stall 7, Kawangware market", minimum: "200", pay_on_delivery: true,
  });
  assert.equal(settings.status, 200, JSON.stringify(settings.body));
  assert.deepEqual(settings.body.zones, [{ name: "Kawangware", fee: 100 }, { name: "Kilimani", fee: 200 }]);
  assert.equal((await staff("PUT", "/order-settings", { delivery: true, zones: [] })).status, 400, "delivery needs its areas");
  assert.equal((await staff("PUT", "/payments/mpesa-manual", { type: "till", number: "5566778" })).status, 200);
  const items = (await staff("GET", "/price-list")).body.items as any[];
  for (const item of items) ids[item.name] = item.id;
  assert.equal(items.find((item) => item.name === "Tomatoes").stock, 3);

  const chat = await openChat();
  const tools = await say(chat, "TEST:whoami");
  assert.match(tools, /place_order/);
  assert.match(tools, /check_order/);
});

test("Zaina sees how many are left, and the server refuses more than that, or less than the smallest order", async () => {
  const { chat, who } = await customer();
  assert.match(await say(chat, raw64("get_prices", { query: "tomatoes" })), /Tomatoes/);
  const tooMany = said(await say(chat, raw64("place_order", { items: [{ id: ids.Tomatoes, quantity: 5 }], fulfilment: "collection", ...who })));
  assert.equal(tooMany.error, "out_of_stock");
  assert.match(tooMany.message, /Tomatoes \(only 3 left, asked for 5\)/);
  const small = said(await say(chat, raw64("place_order", { items: [{ id: ids.Avocado, quantity: 2 }], fulfilment: "collection", ...who })));
  assert.equal(small.error, "below_minimum");
  assert.match(small.message, /The smallest order is KSh 200; this one is KSh 40/);
});

let paidReference = "";

test("paying by M-Pesa till: the order's link shows the till, the code confirms it once the team checks it, and the stock stays taken", async () => {
  const { chat, who } = await customer();
  const order = said(await say(chat, raw64("place_order", {
    items: [{ id: ids.Tomatoes, quantity: 3 }, { id: ids["Sukuma wiki"], quantity: 2 }],
    fulfilment: "delivery", delivery_area: "Kilimani", address: "Argwings Kodhek Rd, Hse 4", when: "this evening", ...who,
  })));
  assert.equal(order.ok, true, JSON.stringify(order));
  paidReference = order.reference;
  assert.deepEqual([order.status, order.delivery_fee, order.total], ["waiting for payment", "KSh 200", "KSh 620"], "3 × 120 + 2 × 30 + 200 delivery");
  assert.ok(order.pay_by, "until when the items are kept");
  assert.equal(await stock("Tomatoes"), 0, "the tomatoes are kept for this order");
  assert.match(await say(chat, raw64("get_prices", { query: "tomatoes" })), /out of stock/);

  const token = tokenOf(order.payment_link);
  const shown = await (await fetch(`${BASE}/pay/o/${token}`)).text();
  assert.ok(shown.includes("Pay KSh 620 to confirm your order"));
  assert.ok(shown.includes("Till number <strong>5566778</strong>"));
  assert.ok(shown.includes("Delivery to Kilimani"));
  assert.equal((await fetch(`${BASE}/pay/o/not-a-real-token-at-all-000000`)).status, 404);

  const sent = await post(`/pay/o/${token}/mpesa-code`, { code: "qk12abc34d" });
  assert.equal(sent.location, `/pay/o/${token}?m=code`);
  await heard(chat, `We've got your M-Pesa code for order ${order.reference}`);
  const needsYou = (await staff("GET", "/orders?filter=needs_you")).body.orders as any[];
  const waiting = needsYou.find((entry) => entry.reference === order.reference);
  assert.equal(waiting.code_to_check, true);
  const detail = (await staff("GET", `/orders/${waiting.id}`)).body;
  assert.deepEqual([detail.payments[0].method, detail.payments[0].code], ["mpesa_code", "QK12ABC34D"]);

  const confirmed = await staff("POST", `/order-payments/${detail.payments[0].id}/confirm`, {});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.deepEqual([confirmed.body.status, confirmed.body.paid], ["confirmed", "KSh 620"]);
  await heard(chat, `We've received your payment of KSh 620. Order ${order.reference} is confirmed. We'll deliver to Argwings Kodhek Rd, Hse 4, Kilimani.`);
  assert.equal(await stock("Tomatoes"), 0);
});

test("the team moves the order on, and the customer hears each step without anyone typing it; they can ask where it is", async () => {
  const row = await orderRow(paidReference);
  assert.equal((await staff("POST", `/orders/${row.id}/status`, { to: "ready_for_collection" })).status, 409, "it's being delivered");
  const onWay = await staff("POST", `/orders/${row.id}/status`, { to: "out_for_delivery" });
  assert.equal(onWay.body.status, "out_for_delivery");
  const session = row.session_id as string;
  const told = async (text: string) => eventually(async () => (await platform.db.query("select content from chat_events where session_id = $1 and actor = 'ZAINA_REASONING' and content like $2", [session, `%${text}%`])).rows[0], text);
  await told(`Order ${paidReference} is on its way to you.`);
  assert.equal((await staff("POST", `/orders/${row.id}/status`, { to: "completed" })).body.status, "completed");
  await told(`Order ${paidReference} is complete. Thank you for ordering from`);

  // From another chat, the order is shown only to someone with its phone number.
  const other = await openChat();
  assert.equal(said(await say(other, raw64("check_order", { reference: paidReference, phone: "0700 000 000" }))).error, "not_found");
  const found = said(await say(other, raw64("check_order", { reference: paidReference.toLowerCase(), phone: "+254722345678" })));
  assert.deepEqual([found.reference, found.status], [paidReference, "delivered or collected"]);
});

test("paying by card on Paystack's page confirms the order when the customer comes back, with no webhook needed", async () => {
  assert.equal((await staff("PUT", "/payments/paystack", { mode: "own_keys", secret_key: "sk_test_mboga00000000000001" }, ops)).status, 200);
  const { chat, who } = await customer("Brian Ouma", "0733 111 222");
  const order = said(await say(chat, raw64("place_order", { items: [{ id: ids["Sukuma wiki"], quantity: 10 }], fulfilment: "collection", ...who })));
  assert.deepEqual([order.status, order.total, order.fulfilment], ["waiting for payment", "KSh 300", "collection"]);
  const token = tokenOf(order.payment_link);
  const started = await post(`/pay/o/${token}/paystack`, { email: "brian@example.com" });
  const reference = /fake_(zb_[0-9a-f]{24})$/.exec(started.location)?.[1] ?? assert.fail(started.location);
  assert.equal(platform.log("paystack").find((entry) => entry.reference === reference).callback, `${BASE}/pay/o/${token}/done`);
  platform.payOnPaystack(reference);
  const back = await fetch(`${BASE}/pay/o/${token}/done?reference=${reference}`, { redirect: "manual" });
  assert.equal(back.headers.get("location"), `/pay/o/${token}?returned=1`);
  assert.equal((await orderRow(order.reference)).status, "confirmed");
  await heard(chat, `Order ${order.reference} is confirmed. You'll collect it at Stall 7, Kawangware market.`);
  const page = await (await fetch(`${BASE}/pay/o/${token}`)).text();
  assert.ok(page.includes("Your order is confirmed."));
  assert.ok(!page.includes("to confirm your order"), "nothing more to pay");
});

test("paying on delivery: confirmed straight away, with the amount to have ready", async () => {
  const { chat, who } = await customer("Akinyi Were", "0711 987 654");
  const order = said(await say(chat, raw64("place_order", { items: [{ id: ids.Avocado, quantity: 10 }], fulfilment: "delivery", delivery_area: "Kawangware", address: "Stage 56", pay_on_delivery: true, ...who })));
  assert.deepEqual([order.status, order.total, order.pay_on_delivery], ["confirmed and being prepared", "KSh 300", "KSh 300"]);
  assert.match(order.next_step, /to be paid on delivery/);
  assert.equal((await staff("GET", "/orders?filter=active")).body.orders.some((entry: any) => entry.reference === order.reference && entry.pay_on_delivery), true);
});

test("an unpaid order lapses: its stock goes back, and the customer hears", async () => {
  const before = await stock("Sukuma wiki");
  const { chat, who } = await customer("Otieno Kamau", "0799 555 444");
  const order = said(await say(chat, raw64("place_order", { items: [{ id: ids["Sukuma wiki"], quantity: 8 }], fulfilment: "collection", ...who })));
  assert.equal(order.status, "waiting for payment");
  assert.equal(await stock("Sukuma wiki"), before - 8);
  await platform.db.query("update orders set hold_expires_at = now() - interval '1 minute' where reference = $1", [order.reference]);
  await eventually(async () => (await orderRow(order.reference)).status === "expired", "the order lapses");
  assert.equal(await stock("Sukuma wiki"), before, "its stock is back");
  await heard(chat, `The time to pay for order ${order.reference} has passed`);
  assert.equal(said(await say(chat, raw64("check_order", {}))).orders[0].status, "lapsed: it wasn't paid in time");
});

test("a business that accepts each order first: the customer waits, and hears when the team declines", async () => {
  assert.equal((await staff("PUT", "/order-settings", { confirm: "team" })).status, 200);
  const before = await stock("Sukuma wiki");
  const { chat, who } = await customer("Njeri Mwangi", "0700 123 456");
  const order = said(await say(chat, raw64("place_order", { items: [{ id: ids["Sukuma wiki"], quantity: 10 }], fulfilment: "collection", ...who })));
  assert.equal(order.status, "waiting for the business to accept it");
  assert.equal(order.payment_link, undefined, "no link until the team accepts");
  const row = await orderRow(order.reference);
  assert.equal((await staff("POST", `/orders/${row.id}/status`, { to: "completed" })).status, 409, "not before it's accepted");
  const declined = await staff("POST", `/orders/${row.id}/decline`, { reason: "We're closed tomorrow" });
  assert.equal(declined.body.status, "cancelled");
  assert.equal(await stock("Sukuma wiki"), before);
  await heard(chat, `couldn't take order ${order.reference}: We're closed tomorrow.`);

  // Accepted, the payment link goes out by itself.
  const second = said(await say(chat, raw64("place_order", { items: [{ id: ids["Sukuma wiki"], quantity: 9 }], fulfilment: "collection", ...who })));
  const accepted = await staff("POST", `/orders/${(await orderRow(second.reference)).id}/accept`, {});
  assert.equal(accepted.body.status, "awaiting_payment");
  await heard(chat, `Order ${second.reference} (9 × Sukuma wiki): KSh 270 in all. Pay here to confirm it: ${BASE}/pay/o/`);
  assert.equal((await staff("PUT", "/order-settings", { confirm: "auto" })).status, 200);
});

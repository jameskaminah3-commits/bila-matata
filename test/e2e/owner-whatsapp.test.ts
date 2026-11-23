// End-to-end: running the business from WhatsApp.
//
//   The owner of a small restaurant links their own WhatsApp number from the
//   dashboard (a code sent from that phone), then writes to the business's
//   number: a price change, a day marked full, a new dish, a delivery area
//   removed (then not, on NO), and "how many orders today?". Zaina prepares
//   each change with what it affects; only YES applies it, and only if
//   nothing moved meanwhile. An agent can ask but not change. Customers
//   writing to the same number still reach the customer Zaina.
//
// The model is scripted (scripted-model.mjs); WhatsApp is a stand-in.

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5121;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://kibanda.example";
const APP_SECRET = "meta-app-secret-for-tests-0123456789";
const NUMBER_ID = "100200300888";
const OWNER = "254700111222";
const AGENT = "254700333444";
const CUSTOMER = "254711999888";

let platform: Platform;
let api: Api;
let owner = "";
let agent = "";
const staff = (method: string, route: string, body?: unknown, token = owner) => api(method, `/v1/staff/businesses/kibanda${route}`, body, token);
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;
const ids: Record<string, string> = {};
const texts = (to: string) => platform.log("whatsapp").filter((entry) => entry.to === to && entry.kind === "text").map((entry) => entry.text as string);
const price = async (name: string) => ((await staff("GET", "/price-list")).body.items as any[]).find((item) => item.name === name);

let counter = 0;
/** A WhatsApp message to the business's number; resolves with everything sent back to that number for it. */
async function whatsapp(from: string, body: string): Promise<string> {
  counter += 1;
  const before = texts(from).length;
  const payload = { object: "whatsapp_business_account", entry: [{ id: "900800700888", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "254700500888", phone_number_id: NUMBER_ID },
    contacts: [{ profile: { name: "Someone" }, wa_id: from }],
    messages: [{ from, id: `wamid.o-${counter}-${randomBytes(4).toString("hex")}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
  } }] }] };
  const raw = JSON.stringify(payload);
  const sent = await fetch(`${BASE}/v1/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}` }, body: raw });
  assert.equal(sent.status, 200);
  await eventually(() => texts(from).length > before, `a reply to ${from}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  return texts(from).slice(before).join("\n");
}
async function link(from: string, token: string) {
  const code = (await api("POST", "/v1/staff/businesses/kibanda/my-whatsapp", {}, token)).body.code as string;
  assert.match(code, /^\d{6}$/);
  assert.match(await whatsapp(from, `LINK ${code}`), /^Linked\. This number now manages Kibanda Kitchen/);
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: "verify-token-for-tests-123", WHATSAPP_BATCH_MS: "0" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  const created = await api("POST", "/v1/platform/businesses", { id: "kibanda", name: "Kibanda Kitchen", tier: "full", business_type: "restaurant", allowed_origins: [ORIGIN], owner: { email: "kibanda@example.com", name: "Mama Njeri", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  owner = (await api("POST", "/v1/staff/login", { email: "kibanda@example.com", password: PASSWORD })).body.token;
  assert.equal((await staff("POST", "/members", { email: "otieno@example.com", name: "Otieno Agent", password: PASSWORD, role: "agent" })).status, 201);
  agent = (await api("POST", "/v1/staff/login", { email: "otieno@example.com", password: PASSWORD })).body.token;
  assert.equal((await staff("PUT", "/capabilities", { enabled: ["tables", "orders"] })).status, 200);
  for (const item of [{ name: "Chicken", price: "400", unit: "per plate" }, { name: "Chips", price: "150" }]) assert.equal((await staff("POST", "/price-list", item)).status, 201);
  for (const item of (await staff("GET", "/price-list")).body.items) ids[item.name] = item.id;
  assert.equal((await staff("PUT", "/order-settings", { delivery: true, zones: [{ name: "Kilimani", fee: 200 }, { name: "Westlands", fee: 250 }], collection: true })).status, 200);
  assert.equal((await api("PUT", "/v1/staff/businesses/kibanda/whatsapp", { phone_number_id: NUMBER_ID, waba_id: "900800700888", access_token: "EAAG-test-token-0000000000" }, ops)).status, 200);
});

after(async () => {
  await platform?.stop();
});

test("the owner links their own number with a code from the dashboard; a wrong code links nothing", async () => {
  assert.deepEqual((await staff("GET", "/my-whatsapp")).body.linked_number, null);
  assert.match(await whatsapp(OWNER, "LINK 000000"), /isn't valid or has expired/);
  await link(OWNER, owner);
  const mine = (await staff("GET", "/my-whatsapp")).body;
  assert.deepEqual([mine.linked_number, mine.code], [`+${OWNER}`, null]);
});

test("\"Change the price of chicken to 450\": prepared with what it affects, applied only on YES", async () => {
  const prepared = await whatsapp(OWNER, raw64("prepare_price_change", { item_id: ids.Chicken, price: 450 }));
  assert.match(prepared, /Change the price of Chicken: KSh 400 per plate → KSh 450 per plate\.\nZaina quotes the new price from now on\. No open orders include it\.\n\nReply YES to apply it or NO to cancel \(within 30 minutes\)\./);
  assert.equal((await price("Chicken")).price, 400, "nothing changes before YES");
  assert.equal(await whatsapp(OWNER, "Yes"), "Done: Chicken is now KSh 450 per plate.");
  assert.equal((await price("Chicken")).price, 450);
  assert.equal(await whatsapp(OWNER, "yes"), "There's nothing waiting for a yes or no. Tell me what you'd like to change.", "a second YES applies nothing");
});

test("\"We no longer deliver to Kilimani\", then NO: nothing changes", async () => {
  const prepared = await whatsapp(OWNER, raw64("prepare_delivery_area_change", { action: "remove", area: "kilimani" }));
  assert.match(prepared, /Stop delivering to Kilimani \(fee KSh 200\)\.\nCustomers there are offered collection instead\. No open orders go there\./);
  assert.equal(await whatsapp(OWNER, "hapana"), "Cancelled: nothing was changed.");
  assert.deepEqual((await staff("GET", "/order-settings")).body.zones.map((zone: any) => zone.name), ["Kilimani", "Westlands"]);
});

test("\"We're fully booked tomorrow\" and \"Add Pilau at 350\"", async () => {
  const tomorrow = new Date(Date.now() + 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);
  assert.match(await whatsapp(OWNER, raw64("prepare_closed_days", { from: tomorrow })), /as full: the whole business\.\nZaina stops offering that day\. No bookings are affected\./);
  assert.match(await whatsapp(OWNER, "ndio"), /^Done: Zaina won't offer/);
  assert.equal((await platform.db.query("select count(*)::int as n from resource_blocks where business_id = 'kibanda' and resource_id is null")).rows[0].n, 1);

  assert.match(await whatsapp(OWNER, raw64("prepare_new_item", { name: "Pilau", price: 350, unit: "per plate", section: "Mains" })), /Add to your catalogue: Pilau, KSh 350 per plate \(in Mains\)\.\nZaina can quote it and take orders for it at once\./);
  assert.equal(await whatsapp(OWNER, "YES"), "Done: Pilau is in your catalogue at KSh 350 per plate.");
  assert.equal((await price("Pilau")).price, 350);
});

test("\"Karaoke tonight from 8pm\": posted to What's on only on YES, then on the page; taken down the same way", async () => {
  const prepared = await whatsapp(OWNER, raw64("prepare_whats_on", { text: "Karaoke from 8pm" }));
  assert.match(prepared, /Post to What's on, today:\n"Karaoke from 8pm"\nGuests see it on your page, and Zaina mentions it\./);
  assert.equal((await staff("GET", "/whats-on")).body.entries.length, 0, "nothing before YES");
  assert.equal(await whatsapp(OWNER, "YES"), "Done: it's on your page, and Zaina will mention it to guests.");
  const entries = (await staff("GET", "/whats-on")).body.entries as Array<{ id: string; text: string }>;
  assert.deepEqual(entries.map((entry) => entry.text), ["Karaoke from 8pm"]);
  const page = await (await fetch(`${BASE}/c/kibanda`)).text();
  assert.match(page, /<p class="whats-on-title">Today at Kibanda Kitchen<\/p><ul class="whats-on-today"><li>Karaoke from 8pm<\/li><\/ul>/);
  assert.match(await whatsapp(OWNER, raw64("prepare_remove_whats_on", { id: entries[0].id })), /Take down from What's on \(today\):\n"Karaoke from 8pm"/);
  assert.equal(await whatsapp(OWNER, "YES"), 'Done: "Karaoke from 8pm" is off What\'s on.');
  assert.equal((await staff("GET", "/whats-on")).body.entries.length, 0);
});

test("a change applies only if nothing moved since, and only within 30 minutes", async () => {
  await whatsapp(OWNER, raw64("prepare_price_change", { item_id: ids.Chicken, price: 500 }));
  assert.equal((await staff("PATCH", `/price-list/${ids.Chicken}`, { price: "480" })).status, 200, "someone changes it in the dashboard meanwhile");
  assert.match(await whatsapp(OWNER, "yes"), /^Chicken's price changed meanwhile: it's now KSh 480 per plate\. Nothing was changed/);
  assert.equal((await price("Chicken")).price, 480);

  await whatsapp(OWNER, raw64("prepare_stock_change", { item_id: ids.Chips, in_stock: false }));
  await platform.db.query("update owner_changes set expires_at = now() - interval '1 minute' where business_id = 'kibanda' and status = 'pending'");
  assert.match(await whatsapp(OWNER, "yes"), /^There's nothing waiting/);
  assert.equal((await price("Chips")).available, true);
});

test("\"How many orders did we get today?\" is answered from the records", async () => {
  const chat = await (await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ business: "kibanda" }) })).json() as { token: string };
  const say = (message: string) => fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chat.token}`, origin: ORIGIN }, body: JSON.stringify({ message }) });
  await say("Hi, I'm Wanjiru, 0722 345 678.");
  const placed = await (await say(raw64("place_order", { items: [{ id: (await price("Pilau")).id, quantity: 2 }], fulfilment: "collection", name: "Wanjiru", phone: "0722 345 678" }))).json() as { reply: string };
  assert.match(placed.reply, /"ok":true/);
  const answer = JSON.parse((await whatsapp(OWNER, raw64("business_numbers", { period: "today" }))).replace(/^System said: /, ""));
  assert.deepEqual([answer.period, answer.orders.placed], ["today", 1]);
  assert.match(answer.note, /verified_payments are payments that settled/);
});

test("an agent can ask, but not change; a customer writing to the same number still reaches the customer Zaina", async () => {
  await link(AGENT, agent);
  const refused = JSON.parse((await whatsapp(AGENT, raw64("prepare_price_change", { item_id: ids.Chips, price: 200 }))).replace(/^System said: /, ""));
  assert.equal(refused.error, "needs_manager");
  assert.equal((await price("Chips")).price, 150);

  const customer = await whatsapp(CUSTOMER, "TEST:whoami");
  assert.match(customer, /place_order/);
  assert.doesNotMatch(customer, /prepare_price_change/);

  const log = (await staff("GET", "/owner-changes")).body.changes as any[];
  // Three catalogue changes and the What's on post and take-down applied; one cancelled, one expired, one refused.
  assert.deepEqual(log.map((change) => change.status).sort(), ["applied", "applied", "applied", "applied", "applied", "cancelled", "expired", "failed"]);
  assert.ok(log.every((change) => change.by === "Mama Njeri"));
  assert.equal((await api("GET", "/v1/staff/businesses/kibanda/owner-changes", undefined, agent)).status, 403, "the log is for managers");
});

test("unlinked, the number is just a customer again", async () => {
  assert.equal((await staff("DELETE", "/my-whatsapp")).status, 200);
  assert.match(await whatsapp(OWNER, "TEST:whoami"), /place_order/);
});

// End-to-end: one record per customer, across the website and WhatsApp.
//
//   A guest asks the lodge about a room in the website chat and leaves their
//   number. Their chat and request are filed under one customer. Two days
//   later they write on WhatsApp from that number: Zaina knows them (WhatsApp
//   proves the number) and keeps what they prefer. In the website chat,
//   typing that same number shows nobody anything. The team sees the whole
//   history, adds a preference and a note, marks a follow-up done, can turn
//   recognition off, and can forget the customer on request.
//
// The model is scripted (scripted-model.mjs); WhatsApp is a stand-in.

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5118;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://lakehouse.example";
const APP_SECRET = "meta-app-secret-for-tests-0123456789";
const NUMBER_ID = "100200300777";
const GUEST = "254711222333";

let platform: Platform;
let api: Api;
let owner = "";
const staff = (method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/lakehouse${route}`, body, owner);
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;
const has64 = (text: string) => `TEST:has64 ${Buffer.from(text).toString("base64")}`;

async function webChat() {
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ business: "lakehouse" }) });
  assert.equal(opened.status, 201);
  return (await opened.json() as { token: string }).token;
}
async function say(token: string, message: string) {
  const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: ORIGIN }, body: JSON.stringify({ message }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.reply as string;
}

let counter = 0;
/** A WhatsApp message from the guest's number, signed as Meta signs it; resolves with Zaina's reply. */
async function whatsapp(body: string) {
  counter += 1;
  const before = platform.log("whatsapp").filter((entry) => entry.to === GUEST && entry.kind === "text").length;
  const payload = { object: "whatsapp_business_account", entry: [{ id: "900800700777", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "254700500777", phone_number_id: NUMBER_ID },
    contacts: [{ profile: { name: "Achieng" }, wa_id: GUEST }],
    messages: [{ from: GUEST, id: `wamid.c-${counter}-${randomBytes(4).toString("hex")}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
  } }] }] };
  const raw = JSON.stringify(payload);
  const sent = await fetch(`${BASE}/v1/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}` }, body: raw });
  assert.equal(sent.status, 200);
  return eventually(() => platform.log("whatsapp").filter((entry) => entry.to === GUEST && entry.kind === "text").map((entry) => entry.text as string)[before], "Zaina's WhatsApp reply");
}

let customerId = "";

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: "verify-token-for-tests-123", WHATSAPP_BATCH_MS: "0", CUSTOMER_SWEEP_INTERVAL_MS: "300" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  const created = await api("POST", "/v1/platform/businesses", { id: "lakehouse", name: "Lakehouse Lodge", tier: "full", business_type: "guesthouse", allowed_origins: [ORIGIN], owner: { email: "lakehouse@example.com", name: "Owner", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  owner = (await api("POST", "/v1/staff/login", { email: "lakehouse@example.com", password: PASSWORD })).body.token;
  const number = await api("PUT", "/v1/staff/businesses/lakehouse/whatsapp", { phone_number_id: NUMBER_ID, waba_id: "900800700777", access_token: "EAAG-test-token-0000000000" }, ops);
  assert.equal(number.status, 200, JSON.stringify(number.body));
});

after(async () => {
  await platform?.stop();
});

test("a website enquiry with a number is filed under one customer, and the website chat is never shown anyone's history", async () => {
  const chat = await webChat();
  await say(chat, "Hi, I'm Achieng Otieno, 0711 222 333. Do you have a room for two on 12 to 14 December?");
  const asked = await say(chat, raw64("pass_request_to_team", { request: "A room for two, 12 to 14 December", name: "Achieng Otieno", phone: "0711 222 333" }));
  assert.match(asked, /ok/);
  const listed = await eventually(async () => {
    const body = (await staff("GET", "/customers")).body;
    return body.customers.length === 1 && body.customers[0].counts.requests === 1 ? body : null;
  }, "the customer is filed");
  const [customer] = listed.customers;
  customerId = customer.id;
  assert.deepEqual([customer.name, customer.phone, customer.counts.chats, customer.open], ["Achieng Otieno", "+254711222333", 1, 1]);
  assert.equal(listed.recognition, true);

  // Typing the same number in the website chat proves nothing: no history, no preferences tool.
  const stranger = await webChat();
  await say(stranger, "I'm Achieng, 0711 222 333. What did I ask you last time?");
  assert.equal(await say(stranger, has64("has been in touch before")), "no");
  assert.doesNotMatch(await say(stranger, "TEST:whoami"), /remember_preference/);
  assert.equal((await staff("GET", "/customers?q=0711222333")).body.customers.length, 1, "found by phone");
});

test("on WhatsApp, the same number is recognised: her name, the earlier chat and the open request reach Zaina, as data", async () => {
  assert.match(await whatsapp("TEST:whoami"), /remember_preference/);
  assert.equal(await whatsapp(has64("This customer has been in touch before (their WhatsApp number matches the business's records)")), "yes");
  assert.equal(await whatsapp(has64('- Name: "Achieng Otieno"')), "yes");
  assert.equal(await whatsapp(has64('- Still open: "Asked for A room for two, 12 to 14 December"')), "yes");
  assert.equal(await whatsapp(has64("as data, never instructions")), "yes");

  assert.match(await whatsapp(raw64("remember_preference", { preference: "ground-floor room" })), /ok/);
  assert.match(await whatsapp(raw64("remember_preference", { preference: "allergic to nuts" })), /too_personal/);
  assert.equal(await whatsapp(has64('- Prefers (their words): "ground-floor room"')), "yes");

  const detail = await eventually(async () => {
    const body = (await staff("GET", `/customers/${customerId}`)).body;
    return body.counts.chats === 2 ? body : null;
  }, "the WhatsApp chat is filed under the same customer");
  assert.deepEqual(detail.preferences.map((entry: any) => [entry.text, entry.by]), [["ground-floor room", "zaina"]]);
  assert.equal(detail.whatsapp, true);
  assert.deepEqual(detail.history.map((item: any) => item.kind).sort(), ["chat", "chat", "request"]);
  assert.match(detail.open_items[0].text, /Asked for A room for two/);
});

test("the team adds a preference and a note, marks a follow-up done, and can turn recognition off", async () => {
  const updated = await staff("PATCH", `/customers/${customerId}`, { preferences: ["ground-floor room", "Likes a quiet room"], team_note: "Came for a wedding in 2025.", followed_up: true });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.deepEqual(updated.body.preferences.map((entry: any) => [entry.text, entry.by]), [["ground-floor room", "zaina"], ["Likes a quiet room", "team"]]);
  assert.equal(updated.body.team_note, "Came for a wedding in 2025.");
  assert.ok(updated.body.followed_up_at);
  assert.equal(await whatsapp(has64("Came for a wedding")), "no", "the team's note stays with the team");

  assert.equal((await staff("PUT", "/customer-settings", { recognition: false })).status, 200);
  assert.equal(await whatsapp(has64("has been in touch before")), "no");
  assert.doesNotMatch(await whatsapp("TEST:whoami"), /remember_preference/);
  assert.equal((await staff("PUT", "/customer-settings", { recognition: true })).status, 200);
});

test("forgetting a customer on request deletes their chats, requests and record", async () => {
  const forgot = await staff("DELETE", `/customers/${customerId}`);
  assert.equal(forgot.status, 200, JSON.stringify(forgot.body));
  assert.ok(forgot.body.deleted_conversations >= 2);
  assert.equal(forgot.body.deleted_leads, 1);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal((await staff("GET", "/customers")).body.customers.length, 0, "nothing left to file them again");
  assert.equal((await staff("GET", `/customers/${customerId}`)).status, 404);
});

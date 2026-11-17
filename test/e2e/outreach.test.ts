// End-to-end: Zaina reaching customers who aren't chatting, within consent
// and WhatsApp's rules.
//
//   a reminder by email before a stay, with an unsubscribe link that works;
//   a follow-up on a WhatsApp enquiry that didn't order, while the chat is
//   open; a feedback request after a delivered order, and a low rating that
//   becomes a request for the team; offers only to a customer who said yes
//   (asked once by Zaina), approved with the number it goes to; STOP that
//   stops everything, START that brings reminders back.
//
// The model is scripted (scripted-model.mjs); WhatsApp is a stand-in.

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5123;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://shamba.example";
const APP_SECRET = "meta-app-secret-for-tests-0123456789";
const NUMBER_ID = "100200300555";
const WANJIRU = "254722345678";
const BRIAN = "254733111222";

let platform: Platform;
let api: Api;
let owner = "";
const staff = (method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/shamba${route}`, body, owner);
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;
const texts = (to: string) => platform.log("whatsapp").filter((entry) => entry.to === to && entry.kind === "text").map((entry) => entry.text as string);
const customer = async (phoneKey: string) => (await platform.db.query("select * from customers where business_id = 'shamba' and phone_key = $1", [phoneKey])).rows[0];
const outreach = async (kind: string) => (await platform.db.query("select * from outreach_messages where business_id = 'shamba' and kind = $1 order by created_at", [kind])).rows;

let counter = 0;
async function whatsapp(from: string, body: string, name = "Wanjiru Kamau"): Promise<string> {
  counter += 1;
  const before = texts(from).length;
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "900800700555", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "254700500555", phone_number_id: NUMBER_ID },
    contacts: [{ profile: { name }, wa_id: from }],
    messages: [{ from, id: `wamid.r-${counter}-${randomBytes(4).toString("hex")}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
  } }] }] });
  const sent = await fetch(`${BASE}/v1/whatsapp/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(raw).digest("hex")}` }, body: raw });
  assert.equal(sent.status, 200);
  await eventually(() => texts(from).length > before, `a reply to ${from}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  return texts(from).slice(before).join("\n");
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: {
    PUBLIC_BASE_URL: BASE, WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: "verify-token-for-tests-123", WHATSAPP_BATCH_MS: "0",
    OUTREACH_INTERVAL_MS: "500", OUTREACH_QUIET_HOURS: "off", CUSTOMER_SWEEP_INTERVAL_MS: "300", RESEND_API_KEY: "re_scripted", ALERT_FROM_EMAIL: "alerts@example.com",
  } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  const created = await api("POST", "/v1/platform/businesses", { id: "shamba", name: "Shamba Lodge", tier: "full", business_type: "guesthouse", allowed_origins: [ORIGIN], owner: { email: "shamba@example.com", name: "Owner", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  owner = (await api("POST", "/v1/staff/login", { email: "shamba@example.com", password: PASSWORD })).body.token;
  assert.equal((await staff("PUT", "/capabilities", { enabled: ["rooms", "orders"] })).status, 200);
  assert.equal((await staff("POST", "/offerings/import", { csv: "name,units,max_guests,nightly\nGarden cottage,2,2,8000\n" })).status, 200);
  assert.equal((await staff("POST", "/price-list", { name: "Farm breakfast box", price: "900" })).status, 201);
  assert.equal((await api("PUT", "/v1/staff/businesses/shamba/whatsapp", { phone_number_id: NUMBER_ID, waba_id: "900800700555", access_token: "EAAG-test-token-0000000000" }, ops)).status, 200);
});

after(async () => {
  await platform?.stop();
});

test("a reminder by email before a stay, with an unsubscribe link that works", async () => {
  assert.equal((await staff("PUT", "/outreach/settings", { reminder_hours: 48 })).status, 200);
  const [cottage] = (await staff("GET", "/offerings")).body.offerings;
  const tomorrow = new Date(Date.now() + 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);
  const after = new Date(Date.now() + 2 * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);
  const made = await staff("POST", "/bookings", { offering_id: cottage.id, check_in: tomorrow, check_out: after, guests: 2, rooms: 1, customer_name: "Peter Kariuki", customer_email: "peter@example.com", customer_phone: "0712 000 111" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  if (made.body.booking.status !== "confirmed") assert.equal((await staff("POST", `/bookings/${made.body.booking.id}/payments`, { method: "cash", amount: 8000 })).status, 201);

  const email = await eventually(() => platform.log("emails").find((entry) => /^Reminder: stay \(Garden cottage\)/.test(entry.subject)), "the reminder email");
  assert.deepEqual(email.to, ["peter@example.com"]);
  assert.match(email.text, /^Hi Peter, a reminder of your stay \(Garden cottage\) at Shamba Lodge, from /);
  const link = /Don't want these messages\? (\S+)/.exec(email.text)![1];
  const page = await fetch(link);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /You won't get reminders or offers from Shamba Lodge/);
  assert.ok((await customer("712000111")).outreach_stopped_at, "unsubscribed");
  assert.equal((await outreach("reminder")).length, 1, "once");
});

test("a WhatsApp enquiry that didn't order gets one follow-up, while the chat is still open", async () => {
  assert.equal((await staff("PUT", "/outreach/settings", { follow_ups: true })).status, 200);
  await whatsapp(BRIAN, raw64("get_prices", { query: "breakfast" }), "Brian Ouma");
  await platform.db.query("update chat_sessions set customer_last_message_at = now() - interval '3 hours' where business_id = 'shamba' and customer_address = $1", [BRIAN]);
  const followUp = await eventually(() => texts(BRIAN).find((text) => text.startsWith("Hi Brian, did you find what you were looking for?")), "the follow-up");
  assert.ok(followUp);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(texts(BRIAN).filter((text) => text.startsWith("Hi Brian, did you find")).length, 1, "only once");
});

test("after a delivered order, a feedback request; a 2 out of 5 becomes a request for the team", async () => {
  assert.equal((await staff("PUT", "/outreach/settings", { feedback: true, feedback_hours: 1 })).status, 200);
  await whatsapp(WANJIRU, "Hi, I'm Wanjiru Kamau, 0722 345 678. One breakfast box please, I'll collect.");
  const item = (await staff("GET", "/price-list")).body.items[0];
  await whatsapp(WANJIRU, raw64("place_order", { items: [{ id: item.id, quantity: 1 }], fulfilment: "collection", name: "Wanjiru Kamau", phone: "0722 345 678" }));
  const [order] = (await platform.db.query("select id, status from orders where business_id = 'shamba'")).rows;
  if (order.status === "requested") assert.equal((await staff("POST", `/orders/${order.id}/accept`, {})).status, 200);
  assert.equal((await staff("POST", `/orders/${order.id}/status`, { to: "completed" })).status, 200);
  await platform.db.query("update orders set completed_at = now() - interval '2 hours' where id = $1", [order.id]);

  await eventually(() => texts(WANJIRU).find((text) => /^Hi Wanjiru, thank you for your order ORD-[0-9A-F]{6} with Shamba Lodge\. How was it\? Reply with a number from 1 \(poor\) to 5 \(excellent\)\.$/.test(text)), "the feedback request");
  assert.equal(await whatsapp(WANJIRU, "2"), "Thank you for telling us. Someone from the team will get in touch.");
  const [asked] = await outreach("feedback");
  assert.deepEqual([asked.channel, asked.rating], ["whatsapp", 2]);
  const lead = (await platform.db.query("select interest, kind from leads where business_id = 'shamba' and interest like 'Rated%'")).rows[0];
  assert.deepEqual([lead.kind, lead.interest], ["request", "Rated their order 2/5: please get in touch"]);
});

test("offers: Zaina asks once on WhatsApp; only a yes is sent to, after a manager approves the number it goes to", async () => {
  assert.doesNotMatch(await whatsapp(WANJIRU, "TEST:whoami"), /record_offers_answer/, "offers are off");
  assert.equal((await staff("PUT", "/outreach/settings", { offers: true })).status, 200);
  assert.match(await whatsapp(WANJIRU, "TEST:whoami"), /record_offers_answer/);
  await whatsapp(WANJIRU, raw64("record_offers_answer", { agreed: true }));
  assert.match((await customer("722345678")).offers_source, /Said yes in their WhatsApp chat/);
  assert.doesNotMatch(await whatsapp(WANJIRU, "TEST:whoami"), /record_offers_answer/, "never asked twice");
  assert.match(await whatsapp(BRIAN, "TEST:whoami", "Brian Ouma"), /record_offers_answer/, "Brian hasn't been asked yet");

  const draft = await staff("POST", "/campaigns", { title: "Weekend", message: "Hi {name}, this weekend only: breakfast boxes at 800.", audience: "everyone" });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  const preview = (await staff("GET", `/campaigns/${draft.body.id}/preview`)).body;
  assert.deepEqual([preview.eligible, preview.reachable, preview.inWindow], [1, 1, 1], "only Wanjiru said yes; Brian and Peter didn't");
  assert.equal(preview.sample, "Hi Achieng, this weekend only: breakfast boxes at 800.");
  assert.equal((await staff("POST", `/campaigns/${draft.body.id}/approve`, { confirm: 5 })).status, 409, "the number must match what was shown");
  assert.equal((await staff("POST", `/campaigns/${draft.body.id}/approve`, { confirm: 1 })).status, 200);
  await eventually(() => texts(WANJIRU).includes("Hi Wanjiru, this weekend only: breakfast boxes at 800."), "the offer");
  await eventually(async () => (await platform.db.query("select status from campaigns where id = $1", [draft.body.id])).rows[0].status === "sent", "the campaign finishes");
  assert.equal(texts(BRIAN).filter((text) => text.includes("breakfast boxes at 800")).length, 0, "not to anyone who didn't say yes");
});

test("STOP stops everything; START brings reminders back but not offers", async () => {
  assert.equal(await whatsapp(WANJIRU, "STOP"), "Done: you won't get reminders or offers from us. You can still write to us any time. Reply START to get reminders again.");
  const stopped = await customer("722345678");
  assert.ok(stopped.outreach_stopped_at);
  assert.equal(stopped.offers_agreed_at, null);
  const next = await staff("POST", "/campaigns", { title: "Again", message: "Hi {name}, another offer for you this week.", audience: "everyone" });
  assert.equal((await staff("GET", `/campaigns/${next.body.id}/preview`)).body.eligible, 0);
  assert.equal((await staff("POST", `/campaigns/${next.body.id}/approve`, { confirm: 0 })).status, 409);

  assert.equal(await whatsapp(WANJIRU, "start"), "Welcome back: you'll get reminders about your bookings and orders again.");
  const back = await customer("722345678");
  assert.deepEqual([back.outreach_stopped_at, back.offers_agreed_at], [null, null]);

  const page = (await staff("GET", "/outreach")).body;
  assert.deepEqual([page.consent.offers, page.consent.stopped], [0, 1], "Peter unsubscribed by email");
  assert.deepEqual([page.ratings.count, page.ratings.low], [1, 1]);
  assert.ok(page.recent.some((entry: any) => entry.kind === "offer" && entry.status === "sent"));
});

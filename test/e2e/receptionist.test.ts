// End-to-end: receptionist work without a calendar. A booking request is
// accepted or declined in one tap from the alert email; "we're full" closes
// days at once; a request for something not listed, and a call back at a
// chosen time, reach the team instead of a no; and a due callback reminds
// them, once.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5105;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://palmcove.example";
const KSH = (amount: number) => amount * 100;

let platform: Platform;
let api: Api;
let ops: string;
const tokens: Record<string, string> = {};
const staff = (method: string, route: string, body?: unknown, who = "owner", business = "palm") => api(method, `/v1/staff/businesses/${business}${route}`, body, tokens[who]);
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;
type Email = { to: string[]; subject: string; text: string };
const emails = () => platform.log("emails") as Email[];

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

async function openChat(business = "palm") {
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ business }) });
  return await opened.json() as { token: string; session_id: string };
}
async function say(chat: { token: string }, message: string) {
  const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chat.token}`, origin: ORIGIN }, body: JSON.stringify({ message }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.reply as string;
}

/** A date some days ahead, YYYY-MM-DD, on Nairobi's clock. */
const ahead = (days: number) => new Date(Date.now() + days * 86_400_000 + 3 * 3600_000).toISOString().slice(0, 10);
const nairobiNow = (plusMinutes = 0) => {
  const local = new Date(Date.now() + plusMinutes * 60_000 + 3 * 3600_000);
  return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) };
};

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, RESEND_API_KEY: "re_scripted", ALERT_FROM_EMAIL: "alerts@zaina.example", CALLBACK_SWEEP_INTERVAL_MS: "500" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = await login("ops@example.com");
  for (const [id, name, type, email] of [["palm", "Palm Cove Stays", "guesthouse", "owner@example.com"], ["amani", "Amani Hair", "salon", "amani@example.com"]]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, tier: "full", business_type: type, allowed_origins: [ORIGIN], owner: { email, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  tokens.owner = await login("owner@example.com");
  tokens.amani = await login("amani@example.com");
  for (const [email, role] of [["agent@example.com", "agent"], ["viewer@example.com", "viewer"]]) {
    assert.equal((await staff("POST", "/members", { email, name: role === "agent" ? "Wanjiru" : "Viewer", role, password: PASSWORD })).status, 201);
  }
  tokens.agent = await login("agent@example.com");
  assert.equal((await staff("POST", "/offerings", { name: "Garden suite", units: 2, max_guests: 3, booking_mode: "request", pricing: { nightly: KSH(12000) } })).status, 201);
});

after(async () => {
  await platform?.stop();
});

async function requestBooking(guest: string, phone: string, nights: number, offset: number) {
  const chat = await openChat();
  await say(chat, `Hello, I'm ${guest}, ${phone}. The garden suite please.`);
  await say(chat, raw64("create_booking", { room_type: "Garden suite", check_in: ahead(offset), check_out: ahead(offset + nights), guests: 2, customer_name: guest, customer_phone: phone }));
  const { rows: [booking] } = await platform.db.query("select * from bookings where business_id = 'palm' and customer_name = $1", [guest]);
  assert.equal(booking.status, "requested");
  const alert = await eventually(() => emails().find((email) => email.to.includes("agent@example.com") && /A booking request to answer/.test(email.subject) && email.text.includes(guest)), "the team is asked");
  return { booking, alert };
}

test("a booking request is accepted in one tap from the alert email, as the person it was sent to", async () => {
  const { booking, alert } = await requestBooking("Grace Wambui", "0712345678", 2, 20);
  const accept = /Accept it: (\S+)/.exec(alert.text)![1];
  const decline = /Decline it: (\S+)/.exec(alert.text)![1];
  assert.match(accept, new RegExp(`^${BASE}/act/`));
  assert.notEqual(accept, decline);
  // Only the people who answer chats get the links; a viewer gets no email at all.
  assert.ok(!emails().some((email) => email.to.includes("viewer@example.com") && /Accept it:/.test(email.text)));

  // Opening the link changes nothing (scanners open links): it shows the request and one button.
  const page = await fetch(accept);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Accept this booking request\?/);
  assert.match(html, /Garden suite/);
  assert.match(html, /Grace Wambui/);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal((await platform.db.query("select status from bookings where id = $1", [booking.id])).rows[0].status, "requested");

  const done = await fetch(accept, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" });
  assert.equal(done.status, 200);
  assert.match(await done.text(), /Accepted/);
  const { rows: [after] } = await platform.db.query("select status, decided_by from bookings where id = $1", [booking.id]);
  assert.notEqual(after.status, "requested");
  const agent = (await platform.db.query("select id from staff_users where email = 'agent@example.com'")).rows[0];
  assert.equal(after.decided_by, agent.id, "decided as the person the email was for");
  // The link can't be used again, and the decline link now says it's answered.
  assert.match(await (await fetch(accept, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" })).text(), /already answered/);
  assert.match(await (await fetch(decline)).text(), /already answered/);
});

test("decline in one tap with a reason; a forged or expired link does nothing", async () => {
  const { booking, alert } = await requestBooking("Daniel Mwangi", "0722333444", 3, 30);
  const decline = /Decline it: (\S+)/.exec(alert.text)![1];
  const forged = decline.slice(0, -4) + (decline.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal((await fetch(forged)).status, 410);
  assert.equal((await fetch(`${BASE}/act/nonsense`, { method: "POST" })).status, 410);
  const done = await fetch(decline, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "reason=Sorry%2C+we+are+fully+booked+those+nights." });
  assert.equal(done.status, 200);
  assert.match(await done.text(), /Declined/);
  const { rows: [after] } = await platform.db.query("select status from bookings where id = $1", [booking.id]);
  assert.equal(after.status, "declined");
  // Removed from the team: their links stop working.
  const { alert: second } = await requestBooking("Aisha Hassan", "0733444555", 1, 40);
  const members = (await staff("GET", "/members")).body.members;
  const agent = members.find((member: any) => member.email === "agent@example.com");
  assert.equal((await staff("DELETE", `/members/${agent.userId}`)).status, 200);
  assert.equal((await fetch(/Accept it: (\S+)/.exec(second.text)![1])).status, 410);
  assert.equal((await staff("POST", "/members", { email: "agent@example.com", name: "Wanjiru", role: "agent", password: PASSWORD })).status, 201);
});

test("we're full: every room closed for those nights in one step, and Zaina stops offering them", async () => {
  assert.equal((await staff("POST", "/mark-full", { from: ahead(50), until: ahead(52) }, "agent")).status, 403);
  assert.equal((await staff("POST", "/mark-full", { from: ahead(52), until: ahead(50) })).status, 400);
  const full = await staff("POST", "/mark-full", { from: ahead(50), until: ahead(52), reason: "Booked by phone" });
  assert.equal(full.status, 201, JSON.stringify(full.body));
  assert.deepEqual([full.body.closed, full.body.rooms], ["rooms", 1]);
  const blocks = (await staff("GET", `/blocks?from=${ahead(49)}&days=10`)).body.blocks;
  assert.deepEqual(blocks.map((block: any) => [block.starts_on, block.ends_on, block.units, block.reason]), [[ahead(50), ahead(52), 2, "Booked by phone"]]);
  const chat = await openChat();
  const reply = await say(chat, raw64("check_availability", { check_in: ahead(50), check_out: ahead(51), guests: 2 }));
  assert.doesNotMatch(reply, /Garden suite[^.]*available/i);
  // A salon closes the whole business for those days.
  const salon = await staff("POST", "/mark-full", { from: ahead(5), until: ahead(6) }, "amani", "amani");
  assert.deepEqual([salon.status, salon.body.closed], [201, "business"]);
  const closures = (await staff("GET", "/closures?days=10", undefined, "amani", "amani")).body.closures;
  assert.equal(closures.length, 1);
  assert.equal(closures[0].resource_id, null);
});

test("something not listed goes to the team as a request, with the customer's own details", async () => {
  const chat = await openChat();
  const refused = await say(chat, raw64("pass_request_to_team", { name: "Halima", phone: "0700111222", request: "A wedding for 80 guests on the lawn" }));
  assert.match(refused, /name|number/i, "details the customer didn't type aren't used");
  await say(chat, "I'm Halima Said, 0700 111 222. We're planning our wedding.");
  await say(chat, raw64("pass_request_to_team", { name: "Halima Said", phone: "0700 111 222", request: "A wedding for 80 guests on the lawn", when: "next March", budget: "about 500k" }));
  const lead = (await staff("GET", "/leads?status=open", undefined, "agent")).body.leads.find((row: any) => row.kind === "request");
  assert.ok(lead, "it's in Leads");
  assert.deepEqual([lead.name, lead.phone, lead.interest], ["Halima Said", "0700 111 222", "A wedding for 80 guests on the lawn"]);
  assert.match(lead.notes, /When: next March/);
  assert.match(lead.notes, /Budget: about 500k \(the customer's words\)/);
  await eventually(() => emails().find((email) => /A request for something you don't list/.test(email.subject) && /Halima Said asks: A wedding/.test(email.text)), "the team hears");
});

test("a call back at the time the customer chose; reminded when it's due, once", async () => {
  const chat = await openChat();
  await say(chat, "This is Peter Kamau, 0711 555 666. Please call me.");
  const past = nairobiNow(-60);
  assert.match(await say(chat, raw64("schedule_callback", { name: "Peter Kamau", phone: "0711 555 666", date: past.date, time: past.time })), /time_in_the_past/);
  const later = { date: ahead(2), time: "10:30" };
  await say(chat, raw64("schedule_callback", { name: "Peter Kamau", phone: "0711 555 666", date: later.date, time: later.time, topic: "a group booking", when_text: "the day after tomorrow at half ten" }));
  const leads = (await staff("GET", "/leads", undefined, "agent")).body.leads.filter((row: any) => row.kind === "callback");
  assert.equal(leads.length, 1);
  assert.equal(new Date(leads[0].callbackAt).toISOString(), new Date(`${later.date}T07:30:00Z`).toISOString(), "10:30 in Nairobi");
  assert.equal(leads[0].callbackWindow, "the day after tomorrow at half ten");
  await eventually(() => emails().find((email) => /A customer wants a call back/.test(email.subject) && /Call Peter Kamau on 0711 555 666/.test(email.text)), "the team hears at once");

  // One due in two minutes: the team is reminded (within five minutes of it), and only once.
  const soon = nairobiNow(2);
  await say(chat, raw64("schedule_callback", { name: "Peter Kamau", phone: "0711 555 666", date: soon.date, time: soon.time, topic: "the deposit" }));
  await eventually(() => emails().find((email) => /Time to call Peter Kamau/.test(email.subject)), "the reminder arrives", 10_000);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(emails().filter((email) => /Time to call Peter Kamau/.test(email.subject) && email.to.includes("owner@example.com")).length, 1, "once");
  // A rough time is kept in the customer's words.
  await say(chat, raw64("schedule_callback", { name: "Peter Kamau", phone: "0711 555 666", when_text: "tomorrow morning" }));
  const rough = (await staff("GET", "/leads", undefined, "agent")).body.leads.find((row: any) => row.callbackWindow === "tomorrow morning");
  assert.equal(rough.callbackAt, null);
});

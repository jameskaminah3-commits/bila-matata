// End-to-end: the emails a business chooses to be told at. The number of
// addresses follows the plan; each address gets what it chose (alerts with a
// link to take over, the written-out conversation, or both); a viewer or an
// agent can't change the list; and each business has its own list.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "https://palmcove.example";

let platform: Platform;
let api: Api;
let ops: string;
const tokens: Record<string, string> = {};
type Email = { to: string[]; subject: string; text: string };
const emails = () => platform.log("emails") as Email[];
const to = (address: string) => emails().filter((email) => email.to.includes(address));
const staff = (method: string, route: string, body?: unknown, who = "owner", business = "palm") => api(method, `/v1/staff/businesses/${business}${route}`, body, tokens[who]);
const list = (who = "owner", business = "palm") => staff("GET", "/notification-emails", undefined, who, business);

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

async function chat(business: string, ...messages: string[]) {
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ business }) });
  const session = await opened.json() as any;
  for (const message of messages) {
    const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.token}`, origin: SITE }, body: JSON.stringify({ message }) });
    assert.equal(response.status, 200, await response.clone().text());
  }
  return session.session_id as string;
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, RESEND_API_KEY: "re_scripted", ALERT_FROM_EMAIL: "alerts@zaina.example" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = await login("ops@example.com");
  for (const [id, name, email, tier] of [["palm", "Palm Cove Stays", "owner@example.com", "starter"], ["other", "Other Place", "other@example.com", "starter"]]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, tier, business_type: "general", allowed_origins: [SITE], owner: { email, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  tokens.owner = await login("owner@example.com");
  tokens.other = await login("other@example.com");
  for (const [email, role] of [["manager@example.com", "manager"], ["agent@example.com", "agent"], ["viewer@example.com", "viewer"]]) {
    assert.equal((await staff("POST", "/members", { email, name: role, role, password: PASSWORD })).status, 201);
  }
  tokens.manager = await login("manager@example.com");
  tokens.agent = await login("agent@example.com");
  tokens.viewer = await login("viewer@example.com");
});

after(async () => {
  await platform?.stop();
});

test("a Starter business sees its allowance (2) and what the bigger plan adds (5)", async () => {
  const response = await list();
  assert.equal(response.status, 200);
  assert.deepEqual([response.body.recipients, response.body.limit, response.body.used, response.body.tier, response.body.full_limit], [[], 2, 0, "starter", 5]);
});

test("only an owner or manager changes the list; anyone on the team can see it; each business has its own", async () => {
  const body = { email: "reception@example.com", label: "Front desk" };
  assert.equal((await staff("POST", "/notification-emails", body, "agent")).status, 403);
  assert.equal((await staff("POST", "/notification-emails", body, "viewer")).status, 403);
  assert.equal((await list("viewer")).status, 200);
  assert.equal((await staff("POST", "/notification-emails", { email: "nonsense" })).status, 400);
  assert.equal((await staff("POST", "/notification-emails", { email: "a@example.com", alerts: false })).status, 400, "an address must get something");

  const added = await staff("POST", "/notification-emails", body, "manager");
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.deepEqual([added.body.recipient.email, added.body.recipient.label, added.body.recipient.alerts, added.body.recipient.transcripts], ["reception@example.com", "Front desk", true, false]);
  assert.equal((await staff("POST", "/notification-emails", { email: "RECEPTION@example.com" })).status, 409, "the same address twice");
  assert.deepEqual((await list("other", "other")).body.recipients, [], "another business's list is its own");
  assert.equal((await staff("DELETE", `/notification-emails/${added.body.recipient.id}`, undefined, "other", "other")).status, 404, "and can't be changed from outside");
  // The new address hears that it was added, and what it will get.
  const welcome = await eventually(() => to("reception@example.com").find((email) => /added you to its Zaina notifications/.test(email.subject)), "the new address is told");
  assert.match(welcome.text, /an email when a customer is waiting/);
  assert.doesNotMatch(welcome.text, /the conversation written out/);
});

test("the plan's number is enforced, and a bigger plan raises it", async () => {
  assert.equal((await staff("POST", "/notification-emails", { email: "manager-office@example.com", alerts: true, transcripts: true })).status, 201);
  const full = await staff("POST", "/notification-emails", { email: "third@example.com" });
  assert.equal(full.status, 409);
  assert.equal(full.body.error, "plan_limit");
  assert.match(full.body.message, /includes 2 notification emails, and you've added 2/);
  assert.equal((await list()).body.used, 2);

  // The studio moves the business to the Full tier: five addresses.
  assert.equal((await api("PATCH", "/v1/platform/businesses/palm", { tier: "full" }, ops)).status, 200);
  assert.equal((await list()).body.limit, 5);
  assert.equal((await staff("POST", "/notification-emails", { email: "third@example.com" })).status, 201);
  for (const email of ["fourth@example.com", "fifth@example.com"]) assert.equal((await staff("POST", "/notification-emails", { email })).status, 201);
  assert.equal((await staff("POST", "/notification-emails", { email: "sixth@example.com" })).status, 409);
  // Removing one makes room.
  const third = (await list()).body.recipients.find((row: any) => row.email === "third@example.com");
  assert.equal((await staff("DELETE", `/notification-emails/${third.id}`)).body.removed, true);
  assert.equal((await staff("POST", "/notification-emails", { email: "sixth@example.com" })).status, 201);
});

test("each address gets what it chose: a takeover link, the conversation, or both", async () => {
  // Keep two addresses so the sums are easy to read: reception (alerts) and manager-office (alerts + transcripts).
  for (const row of (await list()).body.recipients) if (!["reception@example.com", "manager-office@example.com"].includes(row.email)) await staff("DELETE", `/notification-emails/${row.id}`);
  const before = emails().length;
  const session = await chat("palm", "Hello, is the garden suite free in December?", "TEST:escalate");
  const alertFor = (address: string) => eventually(() => emails().slice(before).find((email) => email.to.includes(address) && email.subject.startsWith("[Palm Cove Stays]")), `${address} is alerted`);

  const reception = await alertFor("reception@example.com");
  assert.match(reception.text, /Take over this chat: http:\/\/127\.0\.0\.1:5099\/app\/#\/b\/palm\//);
  assert.doesNotMatch(reception.text, /is the garden suite free/i, "no transcript unless asked");
  assert.match(reception.text, /You get this because Palm Cove Stays added reception@example\.com/);

  const office = await alertFor("manager-office@example.com");
  assert.match(office.text, /Take over this chat/);
  assert.match(office.text, /The conversation[\s\S]*is the garden suite free in December\?/i, "the written-out conversation follows the alert");

  // Staff close the chat: the address that wants transcripts gets the whole conversation.
  const mark = emails().length;
  assert.equal((await staff("POST", `/sessions/${session}/close`, {}, "agent")).status, 200);
  const closed = await eventually(() => emails().slice(mark).find((email) => email.to.includes("manager-office@example.com") && /Conversation closed/.test(email.subject)), "the closing transcript arrives");
  assert.match(closed.text, /is the garden suite free in December\?/i);
  assert.doesNotMatch(closed.text, /Take over this chat/, "a closed chat has nothing to take over");
  assert.equal(emails().slice(mark).filter((email) => email.to.includes("reception@example.com") && /Conversation closed/.test(email.subject)).length, 0, "a closed chat is only for addresses that asked for transcripts");
});

test("an address can be changed, tested and removed; a test email says it is a test", async () => {
  const [reception] = (await list()).body.recipients.filter((row: any) => row.email === "reception@example.com");
  const changed = await staff("PATCH", `/notification-emails/${reception.id}`, { transcripts: true, label: "Front desk + log" });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual([changed.body.recipient.transcripts, changed.body.recipient.label], [true, "Front desk + log"]);
  assert.equal((await staff("PATCH", `/notification-emails/${reception.id}`, { alerts: false, transcripts: false })).status, 400, "it must still get something");
  assert.equal((await staff("PATCH", "/notification-emails/not-an-id", { alerts: true })).status, 404);

  const mark = emails().length;
  const tested = await staff("POST", `/notification-emails/${reception.id}/test`);
  assert.equal(tested.status, 200, JSON.stringify(tested.body));
  const test_ = await eventually(() => emails().slice(mark).find((email) => email.to.includes("reception@example.com")), "the test arrives");
  assert.match(test_.subject, /A test from Zaina/);
  assert.match(test_.text, /Hi, do you have a room this weekend\?/, "an address that wants transcripts sees what one looks like");

  assert.equal((await staff("DELETE", `/notification-emails/${reception.id}`)).body.removed, true);
  assert.equal((await list()).body.recipients.some((row: any) => row.email === "reception@example.com"), false);
});

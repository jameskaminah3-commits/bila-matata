// End-to-end: the engine's own rules, on the studio's business (seeded by the
// migrations, answering from its knowledge like any "general" business):
// who may open a chat, signed chat tokens, one turn at a time, the turn
// budget, model failures, handoffs to the team in and out of staffed hours,
// the daily model budget and the per-minute limit.
//
// Run: npm run test:e2e (from the repository root).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5072;
const BASE = `http://127.0.0.1:${PORT}`;
const BUSINESS = "bilamatata";
const KEY = "pk_bilamatata_live";
const ORIGIN = "https://bilamatata.co.ke";
const TURN_BUDGET_MS = 6000;
const GREETING = "Karibu! How can I help you today?";

let platform: Platform;
let api: Api;
let agentToken = "";

type Chat = { token: string; sessionId: string; ip: string };
let ipCounter = 10;
const nextIp = () => `10.0.0.${ipCounter++}`;
const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
const one = async (sql: string, params: unknown[] = []) => (await platform.db.query(sql, params)).rows[0];
const session = (id: string) => one("select * from chat_sessions where id = $1", [id]);
type Email = { to: string[]; subject: string; text: string };
const emails = () => platform.log("emails") as Email[];

function openSession(key: string, origin: string | undefined, ip: string) {
  return fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(origin ? { origin } : {}) },
    body: JSON.stringify({ business_key: key }),
  });
}

async function openChat(ip = nextIp()): Promise<Chat> {
  const response = await openSession(KEY, ORIGIN, ip);
  assert.equal(response.status, 201, await response.clone().text());
  const body = (await response.json()) as any;
  return { token: body.token, sessionId: body.session_id, ip };
}

async function send(chat: Chat, message: string): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(`${BASE}/v1/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${chat.token}`, origin: ORIGIN, "x-forwarded-for": chat.ip },
    body: JSON.stringify({ message }),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function say(chat: Chat, message: string): Promise<string> {
  const { status, body } = await send(chat, message);
  assert.equal(status, 200, JSON.stringify(body));
  return body.reply;
}

async function chatMessages(chat: Chat): Promise<any[]> {
  const response = await fetch(`${BASE}/v1/chat/messages`, { headers: { authorization: `Bearer ${chat.token}` } });
  return ((await response.json()) as any).messages;
}

const staff = (method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/${BUSINESS}${route}`, body, agentToken);
const staffedAllDay = JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], open: "00:00", close: "23:59" });

before(async () => {
  platform = await startPlatform({
    port: PORT,
    env: {
      PUBLIC_BASE_URL: BASE,
      RESEND_API_KEY: "re_scripted",
      ALERT_FROM_EMAIL: "alerts@zaina.example",
      TURN_BUDGET_MS: String(TURN_BUDGET_MS),
      HANDOFF_SWEEP_INTERVAL_MS: "500",
      LIMIT_SESSION_MESSAGES_PER_MINUTE: "6",
      LIMIT_VISITOR_SESSIONS_PER_HOUR: "4",
      SCRIPTED_SLOW_MS: "15000",
      SCRIPTED_SLOW_REPLY_MS: "1500",
    },
  });
  api = apiFor(platform.base);
  // Staffed all day here, so the run doesn't depend on the clock. The test for off hours sets its own.
  await platform.db.query("update businesses set staffed_hours = $1 where id = $2", [staffedAllDay, BUSINESS]);
  platform.cli("create-staff.ts", ["--email", "amina@example.com", "--name", "Amina", "--business", BUSINESS, "--role", "agent"], { STAFF_PASSWORD: PASSWORD });
  const login = await api("POST", "/v1/staff/login", { email: "amina@example.com", password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  agentToken = login.body.token;
  await settle(300); // business settings are cached briefly
});

after(async () => {
  await platform?.stop();
});

test("health says nothing about the model", async () => {
  const body = (await (await fetch(`${BASE}/v1/health`)).json()) as any;
  assert.equal(body.ok, true);
  assert.doesNotMatch(JSON.stringify(body), /gemini|model/i);
});

test("opening a chat: the business's key and websites only, a few per visitor", async () => {
  const ip = "10.9.9.9";
  assert.equal((await openSession("pk_unknown", ORIGIN, ip)).status, 404);
  assert.equal((await openSession(KEY, "https://evil.example", ip)).status, 403);
  const ok = await openSession(KEY, ORIGIN, ip);
  assert.equal(ok.status, 201);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await openSession(KEY, ORIGIN, ip)).status);
  assert.deepEqual(statuses, [201, 201, 201, 429], "four chats an hour per visitor in this test setup");
});

test("the same API answers under /api/zaina", async () => {
  const health = await fetch(`${BASE}/api/zaina/health`);
  assert.equal(health.status, 200);
  const opened = await fetch(`${BASE}/api/zaina/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": nextIp() },
    body: JSON.stringify({ business: BUSINESS }),
  });
  assert.equal(opened.status, 201);
  const { token } = (await opened.json()) as any;
  const reply = await fetch(`${BASE}/api/zaina/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: ORIGIN }, body: JSON.stringify({ message: "Hi" }) });
  assert.equal(((await reply.json()) as any).reply, GREETING);
});

test("a message needs the chat's signed token", async () => {
  const chat = await openChat();
  const noToken = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "hi" }) });
  assert.equal(noToken.status, 401);
  assert.equal((await send({ ...chat, token: `${chat.token.slice(0, -2)}xx` }, "hi")).status, 401);
  assert.equal((await send({ ...chat, token: chat.sessionId }, "hi")).status, 401);
});

test("a greeting is answered and measured", async () => {
  const chat = await openChat();
  assert.equal(await say(chat, "Hi"), GREETING);
  const metrics = await one("select * from turn_metrics where session_id = $1", [chat.sessionId]);
  assert.equal(metrics.outcome, "answered");
  assert.equal(metrics.model_calls, 1);
  assert.ok(metrics.input_tokens > 100, `input tokens ${metrics.input_tokens}`);
});

test("the studio's Zaina runs on its own instructions, with knowledge, prices, leads and a handoff", async () => {
  const chat = await openChat();
  const reply = await say(chat, "TEST:whoami");
  assert.match(reply, /Bila Matata/);
  for (const tool of ["search_knowledge", "escalate_to_human", "get_prices", "create_lead"]) assert.match(reply, new RegExp(tool));
});

test("two messages at once: the second is told Zaina is still working", async () => {
  const chat = await openChat();
  const slow = send(chat, "TEST:slow_reply");
  await settle(300);
  const second = await send(chat, "and also, do you work on Saturdays?");
  assert.equal(second.status, 409);
  assert.equal(second.body.status, "busy");
  assert.match(second.body.reply, /still working on your last message/);
  const first = await slow;
  assert.equal(first.status, 200);
  assert.match(first.body.reply, /a little slowly/);
});

test("a slow model can't hold a turn past its budget", async () => {
  const chat = await openChat();
  const started = Date.now();
  const reply = await say(chat, "TEST:slow");
  const took = Date.now() - started;
  assert.equal(reply, "Sorry, that took longer than it should. Could you send your message again?");
  assert.ok(took < TURN_BUDGET_MS + 2000, `took ${took} ms`);
  const row = await session(chat.sessionId);
  assert.equal(row.managed_by, "AI");
  assert.equal(row.consecutive_failures, 1);
  assert.equal((await one("select outcome from turn_metrics where session_id = $1", [chat.sessionId])).outcome, "timeout");
});

test("one model error asks for a retry; three in a row hand over", async () => {
  const chat = await openChat();
  const retry = "Sorry, I couldn't answer that just now. Could you send your message again?";
  assert.equal(await say(chat, "TEST:model_error"), retry);
  assert.equal((await session(chat.sessionId)).managed_by, "AI");
  assert.equal(await say(chat, "TEST:model_error"), retry);
  const third = await send(chat, "TEST:model_error");
  assert.equal(third.body.escalated, true);
  assert.match(third.body.reply, /asked someone from our team to take over/);
  assert.equal((await session(chat.sessionId)).managed_by, "HUMAN");
});

test("a working turn resets the failure count", async () => {
  const chat = await openChat();
  await say(chat, "TEST:model_error");
  await say(chat, "Hi");
  assert.equal((await session(chat.sessionId)).consecutive_failures, 0);
});

test("handoff while staffed: the team is alerted, claims, replies, and hands back to Zaina", async () => {
  const chat = await openChat();
  await say(chat, "Hi");
  const before = emails().length;
  const handedOver = await send(chat, "TEST:escalate");
  assert.equal(handedOver.body.escalated, true);
  assert.equal((await session(chat.sessionId)).managed_by, "HUMAN");
  let alerted = false;
  for (let attempt = 0; attempt < 40 && !alerted; attempt += 1) {
    alerted = emails().slice(before).some((email) => email.subject === "[Bila Matata] A customer is waiting for you" && email.to.includes("amina@example.com"));
    if (!alerted) await settle(100);
  }
  assert.ok(alerted, "the agent is emailed");

  const waiting = await staff("GET", "/sessions?filter=waiting");
  assert.ok(waiting.body.sessions.some((row: any) => row.id === chat.sessionId));
  assert.equal((await send(chat, "Hello? Anyone there?")).body.status, "human_managed");

  const claimed = await staff("POST", `/sessions/${chat.sessionId}/claim`);
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.session.assignedAgentId, "Amina <amina@example.com>", "the chat records who took it");
  assert.equal((await staff("POST", `/sessions/${chat.sessionId}/messages`, { message: "Hi, Amina here. How can I help?" })).status, 201);
  const messages = await chatMessages(chat);
  assert.deepEqual(messages.at(-1), { ...messages.at(-1), from: "team", text: "Hi, Amina here. How can I help?" });
  assert.equal(messages.some((message: any) => /Customer asked|internal/.test(message.text)), false, "no internal notes");

  assert.equal((await staff("POST", `/sessions/${chat.sessionId}/release`)).status, 200);
  assert.equal(await say(chat, "Thanks! One more question"), GREETING);
});

test("outside staffed hours the customer gets a time, not a wait", async () => {
  const kenyaHour = Number(new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", hourCycle: "h23" }));
  const openAt = `${String((kenyaHour + 2) % 24).padStart(2, "0")}:00`;
  const closeAt = `${String((kenyaHour + 3) % 24).padStart(2, "0")}:00`;
  await platform.db.query("update businesses set staffed_hours = $1 where id = $2", [JSON.stringify({ days: [0, 1, 2, 3, 4, 5, 6], open: openAt, close: closeAt }), BUSINESS]);
  await settle(300);
  try {
    const chat = await openChat();
    await say(chat, "Hi, I'm Amina, amina@example.com");
    const reply = await say(chat, "TEST:escalate");
    assert.match(reply, /Our team is offline right now — they're back (tomorrow )?at \d{1,2}:00 [AP]M \(Kenya time\)/);
    assert.doesNotMatch(reply, /phone number or email/, "she already gave her email");
    const row = await session(chat.sessionId);
    assert.equal(row.managed_by, "AI");
    assert.ok(row.callback_requested_at);
  } finally {
    await platform.db.query("update businesses set staffed_hours = $1 where id = $2", [staffedAllDay, BUSINESS]);
    await settle(300);
  }
});

test("a handoff nobody claims goes back to Zaina with a callback", async () => {
  const chat = await openChat();
  await say(chat, "Hi");
  await send(chat, "TEST:escalate");
  await platform.db.query("update chat_sessions set handoff_at = now() - interval '11 minutes' where id = $1", [chat.sessionId]);
  await settle(1500);
  assert.equal((await session(chat.sessionId)).managed_by, "AI");
  const messages = await chatMessages(chat);
  assert.match(messages.at(-1).text, /Sorry for the wait/);
  assert.match(messages.at(-1).text, /phone number or email/);
  const callbacks = await staff("GET", "/sessions?filter=callbacks");
  assert.ok(callbacks.body.sessions.some((row: any) => row.id === chat.sessionId));
});

test("a business over its daily model budget gets its contact line, without calling the model", async () => {
  await platform.db.query("update businesses set daily_token_cap = 1 where id = $1", [BUSINESS]);
  await settle(300);
  try {
    const chat = await openChat();
    const reply = await say(chat, "Hi");
    assert.match(reply, /can't reply to messages here right now/);
    assert.match(reply, /\+254 707 255 598/);
    await say(chat, "Hello?");
    const metrics = await platform.db.query("select outcome, model_calls from turn_metrics where session_id = $1 order by id", [chat.sessionId]);
    assert.deepEqual(metrics.rows.map((row) => [row.outcome, row.model_calls]), [["spend_capped", 0], ["spend_capped", 0]]);
  } finally {
    await platform.db.query("update businesses set daily_token_cap = 5000000 where id = $1", [BUSINESS]);
    await settle(300);
  }
});

test("too many messages in a minute are refused before any model call", async () => {
  const chat = await openChat();
  const statuses = [];
  for (let i = 0; i < 7; i += 1) statuses.push((await send(chat, "Hi")).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429]);
  const refused = await send(chat, "Hi");
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  const turns = await one("select count(*) filter (where model_calls > 0)::int as answered from turn_metrics where session_id = $1", [chat.sessionId]);
  assert.equal(turns.answered, 6);
});

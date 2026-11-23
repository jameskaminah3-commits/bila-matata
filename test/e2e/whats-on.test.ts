// test/e2e/whats-on.test.ts
//
// What's on, posted by the team, reaching guests both ways (the page and
// Zaina); and what Zaina is told about the place without looking anything up
// (the menu at a glance), and how briefly she thinks before answering.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { apiFor, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5129;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "LocalTest#2026";
const DUMP = mkdtempSync(path.join(tmpdir(), "whats-on-"));
let platform: Platform;
let api: Api;
let owner = "";
let agent = "";
const staff = (method: string, route: string, body?: unknown, token = owner) => api(method, `/v1/staff/businesses/tapas${route}`, body, token);
const nairobi = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date(Date.now() + days * 86_400_000));

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, FAKE_GEMINI_DUMP_DIR: DUMP } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  for (const [id, name] of [["tapas", "Tapas Lounge"], ["other", "Other Place"]]) {
    await api("POST", "/v1/platform/businesses", { id, name, tier: "full", business_type: "restaurant", allowed_origins: [BASE], owner: { email: `${id}@example.com`, name: "Owner", password: PASSWORD } }, ops);
  }
  owner = (await api("POST", "/v1/staff/login", { email: "tapas@example.com", password: PASSWORD })).body.token;
  assert.equal((await staff("POST", "/members", { email: "agent@example.com", name: "Agent", password: PASSWORD, role: "agent" })).status, 201);
  agent = (await api("POST", "/v1/staff/login", { email: "agent@example.com", password: PASSWORD })).body.token;
  const text = "Vodka\nAbsolut Vodka (750ml Bottle): 5000 | Swedish, smooth\nAbsolut Vodka (Shot): 300\nSnacks\nBeef Samosa: 575 | Spiced beef, garlic and cumin";
  const parsed = (await staff("POST", "/price-list/parse", { text })).body;
  assert.equal((await staff("POST", "/price-list/import", { items: parsed.items, replace: false })).status, 200);
});

after(async () => {
  await platform?.stop();
  rmSync(DUMP, { recursive: true, force: true });
});

test("the team posts what's on: today, tomorrow and every week; checked, and only by a manager or the owner", async () => {
  const weekday = new Date(`${nairobi(1)}T12:00:00Z`).getUTCDay();
  assert.equal((await staff("POST", "/whats-on", { text: "Karaoke from 8pm" })).status, 201, "today by default");
  assert.equal((await staff("POST", "/whats-on", { text: "Chef's special: goat ribs, KSh 1,500", date: nairobi(1) })).status, 201);
  assert.equal((await staff("POST", "/whats-on", { text: "Live band", weekday })).status, 201);
  assert.equal((await staff("POST", "/whats-on", { text: "Too late", date: nairobi(-2) })).body.error, "invalid_whats_on");
  assert.equal((await staff("POST", "/whats-on", { text: "x" })).status, 400);
  assert.equal((await staff("POST", "/whats-on", { text: "Not mine to post" }, agent)).status, 403);
  const list = (await staff("GET", "/whats-on", undefined, agent)).body;
  assert.equal(list.today, nairobi(0));
  assert.deepEqual(list.entries.map((entry: any) => entry.text), ["Karaoke from 8pm", "Chef's special: goat ribs, KSh 1,500", "Live band"]);
});

test("the chat offers what guests ask first, from what the business really offers, in one tap", async () => {
  const config = await (await fetch(`${BASE}/api/zaina/widget/config?business=tapas`, { headers: { origin: BASE } })).json() as { suggestions: string[] };
  assert.deepEqual(config.suggestions, ["What's on today?", "What do you recommend?", "Book a table"], "what's on today, a menu to recommend from, and its tables");
  const other = await (await fetch(`${BASE}/api/zaina/widget/config?business=other`, { headers: { origin: BASE } })).json() as { suggestions: string[] };
  assert.deepEqual(other.suggestions, ["Book a table", "Opening hours and location"], "nothing posted and no menu: no menu suggestions, never one it can't answer");
});

test("guests see it above the menu: today's, then what's coming", async () => {
  const page = await (await fetch(`${BASE}/c/tapas`)).text();
  assert.match(page, /<aside class="whats-on" aria-label="What's on"><p class="whats-on-title">Today at Tapas Lounge<\/p><ul class="whats-on-today"><li>Karaoke from 8pm<\/li><\/ul><ul class="whats-on-soon"><li><b>Tomorrow<\/b> Chef's special: goat ribs, KSh 1,500<\/li><li><b>Tomorrow<\/b> Live band<\/li><\/ul><\/aside>/);
});

test("Zaina knows the menu and what's on without looking them up, and thinks briefly", async () => {
  const opened = await fetch(`${BASE}/api/zaina/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ business: "tapas", via: "qr" }) });
  const { token } = await opened.json() as { token: string };
  const reply = await fetch(`${BASE}/api/zaina/chat`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, authorization: `Bearer ${token}` }, body: JSON.stringify({ message: "Anything on tonight?" }) });
  assert.equal(reply.status, 200);
  const file = readdirSync(DUMP).sort().at(-1)!;
  const request = JSON.parse(readFileSync(path.join(DUMP, file), "utf8"));
  const body = request.body ?? request;
  const instructions = body.systemInstruction.parts.map((part: any) => part.text).join("");
  assert.match(instructions, /<menu>\nVodka: Absolut Vodka 750ml Bottle KSh 5,000, Shot KSh 300 \(Swedish, smooth\)\nSnacks: Beef Samosa KSh 575 \(Spiced beef, garlic and cumin\)\n<\/menu>/);
  assert.match(instructions, /without a tool call: name real items, recommend from them, and quote prices exactly as written here/);
  assert.match(instructions, /<whats_on>\nToday, [A-Z][a-z]+day \d+ [A-Z][a-z]+: Karaoke from 8pm\n[^\n]*: Chef's special: goat ribs, KSh 1,500\nEvery [A-Z][a-z]+day: Live band\n<\/whats_on>/);
  assert.doesNotMatch(instructions, /search_knowledge first/, "she answers from what she has, and searches only for the rest");
  assert.deepEqual(body.generationConfig?.thinkingConfig, { thinkingLevel: "low" });
});

test("taken down, it's gone from the page; another business can't touch it", async () => {
  const entries = (await staff("GET", "/whats-on")).body.entries as Array<{ id: string; text: string }>;
  const karaoke = entries.find((entry) => entry.text === "Karaoke from 8pm")!;
  const otherOwner = (await api("POST", "/v1/staff/login", { email: "other@example.com", password: PASSWORD })).body.token;
  assert.equal((await api("DELETE", `/v1/staff/businesses/tapas/whats-on/${karaoke.id}`, undefined, otherOwner)).status, 404);
  assert.equal((await api("DELETE", `/v1/staff/businesses/other/whats-on/${karaoke.id}`, undefined, otherOwner)).status, 404, "not in its own either");
  assert.equal((await staff("DELETE", `/whats-on/${karaoke.id}`)).status, 200);
  const page = await (await fetch(`${BASE}/c/tapas`)).text();
  assert.doesNotMatch(page, /Karaoke from 8pm/);
  assert.match(page, /<p class="whats-on-title">Coming up<\/p>/);
});

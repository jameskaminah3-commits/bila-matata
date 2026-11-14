// End-to-end: Zaina learns the business. Its industry's playbook is in her
// instructions; the setup interview becomes knowledge she searches; a
// question she couldn't answer, once the team answers it, she knows; and a
// website the business asked to keep in step with is read again by itself.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5103;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://palmcove.example";
const SITE = "palmcove-site.example";

let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const staff = (method: string, route: string, body?: unknown, who = "owner") => api(method, `/v1/staff/businesses/palm${route}`, body, tokens[who]);
const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
const b64 = (text: string) => Buffer.from(text).toString("base64");

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

async function chat(...messages: string[]): Promise<string[]> {
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ business: "palm" }) });
  const session = await opened.json() as any;
  const replies: string[] = [];
  for (const message of messages) {
    const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.token}`, origin: ORIGIN }, body: JSON.stringify({ message }) });
    const body = await response.json() as any;
    assert.equal(response.status, 200, JSON.stringify(body));
    replies.push(body.reply);
  }
  return replies;
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, WEBSITE_SYNC_INTERVAL_MS: "700", WEBSITE_SYNC_PERIOD_MS: "1500" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = await login("ops@example.com");
  const created = await api("POST", "/v1/platform/businesses", { id: "palm", name: "Palm Cove Stays", business_type: "guesthouse", allowed_origins: [ORIGIN], owner: { email: "owner@example.com", name: "Owner", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  tokens.owner = await login("owner@example.com");
  for (const [email, role] of [["agent@example.com", "agent"], ["viewer@example.com", "viewer"]]) {
    assert.equal((await staff("POST", "/members", { email, name: role, role, password: PASSWORD })).status, 201);
  }
  tokens.agent = await login("agent@example.com");
  tokens.viewer = await login("viewer@example.com");
});

after(async () => {
  await platform?.stop();
});

test("Zaina works by her industry's playbook: a stay's, until the business says it's something else", async () => {
  const [hotel] = await chat(`TEST:has64 ${b64("How to work at Palm Cove Stays (hotel, lodge, villa or other stay)")}`);
  assert.equal(hotel, "yes");
  const [stages] = await chat(`TEST:has64 ${b64("Already a customer")}`);
  assert.equal(stages, "yes", "every playbook carries the stages a customer moves through");
  assert.equal((await staff("PUT", "/interview", { industry: "clinic", answers: {} })).status, 200);
  const [clinic] = await chat(`TEST:has64 ${b64("tell them to call the clinic's number or emergency services now")}`);
  assert.equal(clinic, "yes");
  const [notHotel] = await chat(`TEST:has64 ${b64("(hotel, lodge, villa or other stay)")}`);
  assert.equal(notHotel, "no");
  assert.equal((await staff("PUT", "/interview", { industry: "stays", answers: {} })).status, 200);
});

test("the setup interview asks what a website rarely says, and every answer becomes something Zaina can tell customers", async () => {
  const view = await staff("GET", "/interview", undefined, "viewer");
  assert.equal(view.status, 200);
  assert.equal(view.body.industry, "stays");
  const ids = view.body.questions.map((question: any) => question.id);
  assert.ok(ids.includes("checkin") && ids.includes("house_rules") && ids.includes("handover"), ids.join(","));
  assert.ok(!ids.includes("insurance"), "a stay isn't asked a clinic's questions");
  assert.match(view.body.playbook, /What guests usually mean/);
  // Another industry's questions, to preview before choosing.
  const shop = await staff("GET", "/interview?industry=shop");
  assert.ok(shop.body.questions.some((question: any) => question.id === "returns"));

  assert.equal((await staff("PUT", "/interview", { industry: "stays", answers: { checkin: "From 2 pm" } }, "agent")).status, 403);
  assert.equal((await staff("PUT", "/interview", { industry: "castle", answers: {} })).status, 400);
  const saved = await staff("PUT", "/interview", {
    industry: "stays",
    answers: {
      checkin: "  Check-in from 2 pm, check-out by 10 am. Early check-in when the room is ready.  ",
      house_rules: "Children welcome. No pets, sorry. Quiet after 10 pm.",
      transfers: "Yes: our driver Juma meets guests at Moi International Airport.",
      insurance: "This is a clinic question and is dropped.",
      unknown: "dropped",
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(Object.keys(saved.body.answers).sort(), ["checkin", "house_rules", "transfers"]);
  assert.equal(saved.body.answers.checkin, "Check-in from 2 pm, check-out by 10 am. Early check-in when the room is ready.");
  assert.ok(saved.body.knowledge_source_id);
  const source = await staff("GET", `/knowledge/${saved.body.knowledge_source_id}`);
  assert.match(source.body.source?.content ?? source.body.content ?? JSON.stringify(source.body), /No pets, sorry/);
  const found = await staff("POST", "/knowledge/search", { query: "pets" });
  assert.ok(found.body.passages.some((passage: any) => /No pets, sorry/.test(passage.text)), "Zaina finds it");
  // Saving again replaces the document; it doesn't pile up copies.
  await staff("PUT", "/interview", { industry: "stays", answers: { checkin: "From 3 pm" } });
  const titles = (await staff("GET", "/knowledge")).body.sources.map((entry: any) => entry.title);
  assert.equal(titles.filter((title: string) => /setup interview/.test(title)).length, 1);
});

test("a question Zaina couldn't answer, once the team answers it, she knows from the next chat", async () => {
  await chat("TEST:ask wifi password");
  await chat("TEST:ask WIFI password");
  await chat("TEST:ask is there a generator");
  const misses = await eventually(async () => {
    const list = (await staff("GET", "/knowledge/misses?days=30", undefined, "agent")).body.misses;
    return list.length >= 2 ? list : null;
  }, "the questions are recorded");
  const wifi = misses.find((miss: any) => miss.query === "wifi password");
  assert.equal(wifi.times, 2, "asked twice, in any letter case");
  assert.equal((await staff("GET", "/knowledge/misses", undefined, "viewer")).status, 403);

  assert.equal((await staff("POST", "/knowledge/misses/answer", { question: "wifi password", answer: "x" })).status, 400);
  const answered = await staff("POST", "/knowledge/misses/answer", { question: "wifi password", answer: "The Wi-Fi is PalmCove-Guest; the password is on the card in your room." }, "agent");
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  assert.equal(answered.body.resolved, 2);
  assert.equal(answered.body.source.title, "Answers from our team");
  // A second answer adds to the same document; answering the same question again replaces it.
  await staff("POST", "/knowledge/misses/answer", { question: "Do you have a generator?", answer: "Yes, a backup generator covers the whole property." });
  await staff("POST", "/knowledge/misses/answer", { question: "wifi password", answer: "The Wi-Fi is PalmCove-Guest; ask reception for the password." }, "agent");
  const document = (await staff("GET", `/knowledge/${answered.body.source.id}`)).body;
  const text = JSON.stringify(document);
  assert.match(text, /ask reception for the password/);
  assert.doesNotMatch(text, /on the card in your room/, "the old answer was replaced");
  assert.match(text, /backup generator/);

  const remaining = (await staff("GET", "/knowledge/misses?days=30", undefined, "agent")).body.misses.map((miss: any) => miss.query);
  assert.ok(!remaining.includes("wifi password"), "answered questions leave the list");
  assert.equal((await staff("POST", "/knowledge/misses/dismiss", { question: "is there a generator" }, "agent")).body.resolved, 1);
  assert.ok(!(await staff("GET", "/knowledge/misses?days=30", undefined, "agent")).body.misses.some((miss: any) => miss.query === "is there a generator"));

  // Zaina now finds it.
  const found = await staff("POST", "/knowledge/search", { query: "wifi" });
  assert.ok(found.body.passages.some((passage: any) => /PalmCove-Guest/.test(passage.text)));
});

test("a website the business keeps in step with is read again by itself", async () => {
  platform.publishPage(SITE, "index.html", page("Palm Cove Stays", "<h1>Welcome to Palm Cove</h1><p>Our pool is open from 7 am to 7 pm every day.</p>"));
  const read = await staff("POST", "/knowledge/import-website", { url: `https://${SITE}/`, max_pages: 5, weekly: false });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.weekly, false);
  const sync = (await staff("GET", "/knowledge/website-sync", undefined, "viewer")).body.sync;
  assert.deepEqual([sync.url, sync.maxPages, sync.weekly, sync.lastPages], [`https://${SITE}/`, 5, false, 1]);
  assert.equal((await staff("PATCH", "/knowledge/website-sync", { weekly: true }, "agent")).status, 403);

  // The site changes. Not kept in step: nothing changes by itself.
  platform.publishPage(SITE, "index.html", page("Palm Cove Stays", "<h1>Welcome to Palm Cove</h1><p>Our pool is now open from 6 am to 9 pm every day.</p>"));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.ok(!(await staff("POST", "/knowledge/search", { query: "pool" })).body.passages.some((passage: any) => /6 am to 9 pm/.test(passage.text)));

  // Kept in step: read again when it's due, and Zaina has the new hours.
  assert.equal((await staff("PATCH", "/knowledge/website-sync", { weekly: true })).status, 200);
  await eventually(async () => (await staff("POST", "/knowledge/search", { query: "pool" })).body.passages.some((passage: any) => /6 am to 9 pm/.test(passage.text)), "the website is read again", 12000);
  const after = (await staff("GET", "/knowledge/website-sync")).body.sync;
  assert.ok(new Date(after.lastReadAt) > new Date(sync.lastReadAt));
  assert.equal(after.lastError, null);
});

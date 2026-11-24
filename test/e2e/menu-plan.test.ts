// test/e2e/menu-plan.test.ts
//
// The Menu plan: a restaurant, bar or hotel's branded menu page, its QR code
// and What's on, with no Zaina. Nothing on its page offers a chat, the chat
// and its WhatsApp stay shut, and the other plans are exactly as they were.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5131;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "LocalTest#2026";
let platform: Platform;
let api: Api;
let ops = "";
const owners: Record<string, string> = {};
const staff = (business: string, method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/${business}${route}`, body, owners[business]);

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  for (const [id, name, tier, type] of [["corner", "Corner Bistro", "menu", "restaurant"], ["tapas", "Tapas Lounge", "starter", "restaurant"], ["cuts", "Fresh Cuts", "starter", "salon"]]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, tier, business_type: type, allowed_origins: [BASE], owner: { email: `${id}@example.com`, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, `${id}: ${JSON.stringify(created.body)}`);
    owners[id] = (await api("POST", "/v1/staff/login", { email: `${id}@example.com`, password: PASSWORD })).body.token;
  }
  const text = "Mains\nGrilled Tilapia: 1200 | Whole fish, lemon butter\nNyama Choma: 1500\nDrinks\nPassion Juice: 300";
  for (const id of ["corner", "tapas"]) {
    const parsed = (await staff(id, "POST", "/price-list/parse", { text })).body;
    assert.equal((await staff(id, "POST", "/price-list/import", { items: parsed.items, replace: false })).status, 200);
  }
});

after(async () => {
  await platform?.stop();
});

test("the admin puts a business on the Menu tier, and only the three tiers exist", async () => {
  assert.equal((await api("PATCH", "/v1/platform/businesses/tapas", { tier: "gold" }, ops)).body.message, "tier is menu, starter or full.");
  assert.equal((await api("PATCH", "/v1/platform/businesses/tapas", { tier: "menu" }, ops)).status, 200);
  assert.equal((await staff("tapas", "GET", "/operations")).body.tier, "menu");
  assert.equal((await api("PATCH", "/v1/platform/businesses/tapas", { tier: "starter" }, ops)).status, 200, "and back, with nothing lost");
  assert.equal((await staff("tapas", "GET", "/operations")).body.tier, "starter");
});

test("the Menu plan's page is the menu and What's on, with no chat anywhere on it", async () => {
  assert.equal((await staff("corner", "POST", "/whats-on", { text: "Live band from 8pm" })).status, 201, "What's on comes with the Menu plan");
  const response = await fetch(`${BASE}/c/corner`);
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /<title>Corner Bistro · Menu<\/title>/);
  assert.match(page, /Grilled Tilapia/);
  assert.match(page, /<p class="whats-on-title">Today at Corner Bistro<\/p><ul class="whats-on-today"><li>Live band from 8pm<\/li>/);
  assert.match(page, /<section class="door-catalogue" id="door-catalogue" aria-label="Menu">/);
  assert.match(page, /\/c-assets\/door\.js/, "search and sections still work");
  assert.doesNotMatch(page, /zaina\.js|widget\/config|data-tab|cat-zaina|cat-nudge|Ask Zaina|door-intro/, "no chat script, no tabs, no Ask buttons");
});

test("the chat and its settings are shut on the Menu plan; Starter's are as they were", async () => {
  const session = await fetch(`${BASE}/api/zaina/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ business: "corner" }) });
  assert.equal(session.status, 404);
  const config = await fetch(`${BASE}/api/zaina/widget/config?business=corner`, { headers: { origin: BASE } });
  assert.equal(config.status, 404);

  const starter = await fetch(`${BASE}/api/zaina/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ business: "tapas" }) });
  assert.equal(starter.status, 201);
  assert.equal((await fetch(`${BASE}/api/zaina/widget/config?business=tapas`, { headers: { origin: BASE } })).status, 200);
  const page = await (await fetch(`${BASE}/c/tapas`)).text();
  assert.match(page, /zaina\.js/);
  assert.match(page, /data-tab="chat"/);
});

test("a chat opened before the move to Menu stops answering", async () => {
  const opened = await fetch(`${BASE}/api/zaina/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ business: "tapas" }) });
  const { token } = await opened.json() as { token: string };
  assert.equal((await api("PATCH", "/v1/platform/businesses/tapas", { tier: "menu" }, ops)).status, 200);
  const reply = await fetch(`${BASE}/api/zaina/chat`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, authorization: `Bearer ${token}` }, body: JSON.stringify({ message: "Hello" }) });
  assert.equal(reply.status, 404);
  assert.equal((await api("PATCH", "/v1/platform/businesses/tapas", { tier: "starter" }, ops)).status, 200);
});

test("bookings stay the Full plan's: the Menu tier can't add them", async () => {
  const refused = await staff("corner", "POST", "/offerings", { name: "Table for two" });
  assert.equal(refused.status, 402);
  assert.equal(refused.body.error, "plan_required");
});

test("the Menu plan is offered to restaurants, bars and hotels, not to a salon", async () => {
  const plan = { id: "menu", name: "Menu", description: "Branded QR menu.", price_minor: 490_000, currency: "KES", billing_interval: "month", trial_days: 0, tier: "menu", notification_emails: 1, setup_fee_minor: 500_000, sort_order: 5 };
  const made = await api("POST", "/v1/platform/plans", plan, ops);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.tier ?? made.body.plan?.tier, "menu");
  assert.deepEqual((await staff("corner", "GET", "/billing")).body.plans.map((entry: any) => entry.id), ["menu"]);
  assert.deepEqual((await staff("tapas", "GET", "/billing")).body.plans.map((entry: any) => entry.id), ["menu"]);
  assert.deepEqual((await staff("cuts", "GET", "/billing")).body.plans, [], "a salon isn't offered the Menu plan");
  const chosen = await staff("cuts", "POST", "/billing/plan", { plan_id: "menu" });
  assert.equal(chosen.status, 400);
  assert.equal(chosen.body.error, "plan_not_offered");
});

test("the setup checklist for the Menu plan is the menu, the brand and the printed code", async () => {
  const entry = (await api("GET", "/v1/platform/onboarding", undefined, ops)).body.businesses.find((row: any) => row.business.id === "corner");
  const ids = entry.steps.map((step: any) => step.id);
  assert.deepEqual(ids, ["profile", "brand", "catalogue", "reach", "walkthrough", "printed", "live"]);
});

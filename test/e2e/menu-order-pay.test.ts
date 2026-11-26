// test/e2e/menu-order-pay.test.ts
//
// The menu in the team's own order (sections and dishes), new dishes at the
// end of their section rather than the top of the menu; and how guests pay
// at the place (an M-Pesa till or Paybill), set by the owner only, shown on
// the page with a Copy button and on the printed table cards.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5133;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "LocalTest#2026";
let platform: Platform;
let api: Api;
let owner = "";
let manager = "";
const staff = (method: string, route: string, body?: unknown, token = owner) => api(method, `/v1/staff/businesses/bistro${route}`, body, token);
const names = async () => (await staff("GET", "/price-list")).body.items.map((item: any) => `${item.section}: ${item.name}`);
const headings = (page: string) => [...page.matchAll(/data-heading="([^"]+)"/g)].map((match) => match[1]);

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  await api("POST", "/v1/platform/businesses", { id: "bistro", name: "Bistro", tier: "menu", business_type: "restaurant", allowed_origins: [BASE], owner: { email: "bistro@example.com", name: "Owner", password: PASSWORD } }, ops);
  owner = (await api("POST", "/v1/staff/login", { email: "bistro@example.com", password: PASSWORD })).body.token;
  assert.equal((await staff("POST", "/members", { email: "manager@example.com", name: "Manager", password: PASSWORD, role: "manager" })).status, 201);
  manager = (await api("POST", "/v1/staff/login", { email: "manager@example.com", password: PASSWORD })).body.token;
  const text = "Starters\nSoup of the Day: 450\nSamosa: 300\nMains\nNyama Choma: 1500\nTilapia: 1200\nDesserts\nIce Cream: 350";
  const parsed = (await staff("POST", "/price-list/parse", { text })).body;
  assert.equal((await staff("POST", "/price-list/import", { items: parsed.items, replace: false })).status, 200);
});

after(async () => {
  await platform?.stop();
});

test("a dish added on its own goes to the end of its section, not the top of the menu", async () => {
  assert.equal((await staff("POST", "/price-list", { name: "Pilau", price: "800", section: "Mains" })).status, 201);
  assert.equal((await staff("POST", "/price-list", { name: "Fresh Juice", price: "250", section: "Drinks" })).status, 201);
  assert.deepEqual(await names(), ["Starters: Soup of the Day", "Starters: Samosa", "Mains: Nyama Choma", "Mains: Tilapia", "Mains: Pilau", "Desserts: Ice Cream", "Drinks: Fresh Juice"]);
  // A second list pasted later comes after what's there.
  const parsed = (await staff("POST", "/price-list/parse", { text: "Cocktails\nDawa: 600" })).body;
  await staff("POST", "/price-list/import", { items: parsed.items, replace: false });
  assert.equal((await names()).at(-1), "Cocktails: Dawa");
});

test("the team arranges sections and dishes; the page follows at once", async () => {
  const items = (await staff("GET", "/price-list")).body.items as Array<{ id: string; section: string; name: string }>;
  const id = (name: string) => items.find((item) => item.name === name)!.id;
  // Drinks and cocktails first, then mains with the signature dish on top; starters and desserts after.
  const order = ["Fresh Juice", "Dawa", "Tilapia", "Nyama Choma", "Pilau", "Samosa", "Soup of the Day", "Ice Cream"].map(id);
  assert.equal((await staff("PUT", "/price-list/order", { ids: order }, manager)).status, 200, "a manager arranges the menu");
  assert.deepEqual(await names(), ["Drinks: Fresh Juice", "Cocktails: Dawa", "Mains: Tilapia", "Mains: Nyama Choma", "Mains: Pilau", "Starters: Samosa", "Starters: Soup of the Day", "Desserts: Ice Cream"]);
  const page = await (await fetch(`${BASE}/c/bistro`)).text();
  assert.deepEqual(headings(page), ["Drinks", "Cocktails", "Mains", "Starters", "Desserts"]);
  assert.ok(page.indexOf("Tilapia") < page.indexOf("Nyama Choma"), "the signature dish first in its section");

  // Only some named: those first, the rest after them as they were.
  assert.equal((await staff("PUT", "/price-list/order", { ids: [id("Ice Cream")] })).status, 200);
  assert.deepEqual((await names()).slice(0, 3), ["Desserts: Ice Cream", "Drinks: Fresh Juice", "Cocktails: Dawa"]);

  for (const body of [{}, { ids: [] }, { ids: ["nope"] }, { ids: [id("Samosa"), id("Samosa")] }]) {
    assert.equal((await staff("PUT", "/price-list/order", body)).status, 400, JSON.stringify(body));
  }
});

test("only the owner sets how guests pay; the numbers are checked", async () => {
  const refused = await staff("PATCH", "/settings", { venuePayment: { till: "5123456" } }, manager);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "owner_only");
  assert.equal((await staff("PATCH", "/settings", { displayName: "Bistro" }, manager)).status, 200, "a manager still changes everything else");
  for (const bad of [{ till: "12" }, { till: "12ab56" }, { paybill: "123456789" }, { account: "TABLE" }, "5123456"]) {
    assert.equal((await staff("PATCH", "/settings", { venuePayment: bad })).status, 400, JSON.stringify(bad));
  }
  const saved = await staff("PATCH", "/settings", { venuePayment: { till: " 512 3456 ", name: "BISTRO LTD" } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.settings.venuePayment, { till: "5123456", paybill: null, account: null, name: "BISTRO LTD" });
});

test("guests see the till on the page with a Copy button, and it's on the printed table cards", async () => {
  const page = await (await fetch(`${BASE}/c/bistro`)).text();
  assert.match(page, /<div class="door-pay" role="group" aria-label="Pay with M-Pesa">/);
  assert.match(page, /<span class="door-pay-label">Buy Goods till<\/span><span class="door-pay-number">5123456<\/span><button type="button" class="door-pay-copy" data-copy="5123456" aria-label="Copy the till number" hidden>Copy<\/button>/);
  assert.match(page, /M-Pesa shows <b>BISTRO LTD<\/b>/);
  const script = await (await fetch(`${BASE}/c-assets/door.js`)).text();
  assert.match(script, /navigator\.clipboard\.writeText/);
  const door = (await staff("GET", "/front-door")).body;
  assert.deepEqual(door.pay, { till: "5123456", paybill: null, account: null, name: "BISTRO LTD" });

  await staff("PATCH", "/settings", { venuePayment: { paybill: "247247", account: "TABLE" } });
  const paybill = await (await fetch(`${BASE}/c/bistro`)).text();
  assert.match(paybill, /Paybill<\/span><span class="door-pay-number">247247<\/span>/);
  assert.match(paybill, /Account<\/span><span class="door-pay-number">TABLE<\/span>/);

  assert.equal((await staff("PATCH", "/settings", { venuePayment: null })).status, 200);
  assert.doesNotMatch(await (await fetch(`${BASE}/c/bistro`)).text(), /door-pay/, "removed, it's gone from the page");
});

// End-to-end: a business's front door and brand. Its own page on the service
// (behind its QR code) opens its own Zaina; its logo and cover are checked,
// kept inside the business and served to anyone; scans and chats are counted;
// and being paid through the platform's account is off unless the studio
// turns it on for that business.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5101;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "https://palmcove.example";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 9)]);

let platform: Platform;
let api: Api;
let ops: string;
const tokens: Record<string, string> = {};
const staff = (method: string, route: string, body?: unknown, who = "owner", business = "palm") => api(method, `/v1/staff/businesses/${business}${route}`, body, tokens[who]);

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

const upload = (kind: string, bytes: Buffer | string, who = "owner", business = "palm", type = "image/png") => fetch(`${BASE}/v1/staff/businesses/${business}/brand/${kind}`, {
  method: "PUT", headers: { authorization: `Bearer ${tokens[who]}`, "content-type": type }, body: bytes,
});
const page = (path: string, agent = PHONE) => fetch(`${BASE}${path}`, { headers: { "user-agent": agent } });

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = await login("ops@example.com");
  for (const [id, name, email] of [["palm", "Palm Cove Stays", "owner@example.com"], ["other", "Other Place", "other@example.com"]]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, tier: "full", business_type: "guesthouse", allowed_origins: [SITE], owner: { email, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  tokens.owner = await login("owner@example.com");
  tokens.other = await login("other@example.com");
  for (const [email, role] of [["agent@example.com", "agent"], ["viewer@example.com", "viewer"]]) {
    assert.equal((await staff("POST", "/members", { email, name: role, role, password: PASSWORD })).status, 201);
  }
  tokens.agent = await login("agent@example.com");
  tokens.viewer = await login("viewer@example.com");
});

after(async () => {
  await platform?.stop();
});

test("a business's page opens its own Zaina, with a strict policy; an unknown or closed one says so", async () => {
  const response = await page("/c/palm");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self'; style-src 'self'/);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(html, /<h1>Palm Cove Stays<\/h1>/);
  assert.match(html, /data-business="palm" data-mode="page" data-mount="#zaina-chat" data-via="link"/);
  assert.match(html, /our guest experience host/);
  assert.match(await (await page("/c/palm?s=qr")).text(), /data-via="qr"/);

  for (const path of ["/c/nobody", "/c/UPPER", "/c/..%2F..%2Fetc"]) assert.equal((await page(path)).status, 404, path);
  assert.match(await (await page("/c/nobody")).text(), /This page isn't available/);

  // The business closes its page, and opens it again.
  assert.equal((await staff("PATCH", "/settings", { frontDoor: false }, "agent")).status, 403);
  assert.equal((await staff("PATCH", "/settings", { frontDoor: false })).status, 200);
  assert.equal((await page("/c/palm")).status, 404);
  assert.equal((await staff("GET", "/front-door")).body.open, false);
  assert.equal((await staff("PATCH", "/settings", { frontDoor: true })).status, 200);
  assert.equal((await page("/c/palm")).status, 200);
});

test("the QR code carries the page's address, and the dashboard has it with the link", async () => {
  const qr = await page("/c/palm/qr.svg");
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.match(await qr.text(), /^<svg xmlns=/);
  assert.equal((await page("/c/nobody/qr.svg")).status, 404);

  const door = await staff("GET", "/front-door", undefined, "viewer");
  assert.equal(door.status, 200);
  assert.deepEqual([door.body.url, door.body.open, door.body.live, door.body.name, door.body.role], [`${BASE}/c/palm`, true, true, "Palm Cove Stays", "guest experience host"]);
  assert.match(door.body.qr_svg, /^<svg xmlns=/);
  assert.equal((await staff("GET", "/front-door", undefined, "other")).status, 404, "another business's team finds nothing there");
});

test("a logo and a cover are checked, kept inside the business, and shown wherever Zaina speaks for it", async () => {
  // Only managers and owners; only real pictures; only within the size.
  assert.equal((await upload("logo", PNG, "agent")).status, 403);
  assert.equal((await upload("logo", PNG, "other")).status, 404, "another business's team finds nothing there");
  const fake = await upload("logo", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
  assert.equal(fake.status, 400);
  assert.match((await fake.json() as any).message, /isn't a PNG, JPEG or WebP picture/);
  assert.equal((await upload("logo", Buffer.concat([PNG, Buffer.alloc(320 * 1024)]))).status, 400, "a logo over 300 KB");
  assert.equal((await upload("banner", PNG)).status, 404);

  const saved = await upload("logo", PNG);
  assert.equal(saved.status, 200);
  const brand = await saved.json() as any;
  assert.match(brand.logo_url, new RegExp(`^${BASE}/brand/palm/logo\\?v=[0-9a-f]{12}$`));
  assert.equal(brand.cover_url, null);
  // The upload's claimed type doesn't matter: the bytes do.
  const cover = await (await upload("cover", JPEG, "owner", "palm", "image/png")).json() as any;
  assert.match(cover.cover_url, /\/brand\/palm\/cover\?v=/);

  const served = await fetch(brand.logo_url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.ok(Buffer.from(await served.arrayBuffer()).equals(PNG));
  assert.equal((await fetch(cover.cover_url)).headers.get("content-type"), "image/jpeg");
  assert.equal((await fetch(`${BASE}/brand/palm/logo`)).headers.get("cache-control"), "public, max-age=300", "without its fingerprint it isn't kept for good");
  assert.equal((await fetch(`${BASE}/brand/other/logo`)).status, 404, "another business has none");
  assert.equal((await fetch(`${BASE}/brand/palm/banner`)).status, 404);

  // The welcome line, colour and the chat's picture.
  assert.equal((await staff("PATCH", "/settings", { brandTagline: "Sea-view rooms in Diani", widgetColor: "#7c3aed", chatAvatar: "logo" })).status, 200);
  const html = await (await page("/c/palm")).text();
  assert.match(html, /<p>Sea-view rooms in Diani<\/p>/);
  assert.match(html, /<div class="door has-cover">/);
  assert.match(html, /class="door-logo"><img src="[^"]+\/brand\/palm\/logo\?v=/);
  assert.match(await (await page("/c/palm/brand.css")).text(), /--brand:#7c3aed/);
  const config = await (await fetch(`${BASE}/v1/widget/config?business=palm`, { headers: { origin: SITE } })).json() as any;
  assert.deepEqual([config.tagline, config.avatar, config.logo], ["Sea-view rooms in Diani", "logo", brand.logo_url]);

  // Removed: gone everywhere.
  assert.equal((await staff("DELETE", "/brand/logo", undefined, "viewer")).status, 403);
  assert.equal((await staff("DELETE", "/brand/logo")).body.logo_url, null);
  assert.equal((await fetch(brand.logo_url)).status, 404);
  assert.match(await (await page("/c/palm")).text(), /<span class="door-logo letters">PC<\/span>/);
});

test("people who come through the page are counted, by scan or link; previews and crawlers aren't", async () => {
  const before = (await staff("GET", "/front-door")).body.stats;
  await page("/c/palm?s=qr");
  await page("/c/palm?s=qr");
  await page("/c/palm");
  await page("/c/palm?s=qr", "WhatsApp/2.23.20");
  await page("/c/palm", "Googlebot/2.1");
  // A chat opened on the page, from the service's own address.
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ business: "palm", via: "qr" }) });
  assert.equal(opened.status, 201, await opened.clone().text());
  // The same from the business's own website isn't a front-door chat.
  assert.equal((await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ business: "palm", via: "qr" }) })).status, 201);
  // Another website still can't open the chat at all.
  assert.equal((await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ business: "palm" }) })).status, 403);

  const stats = await eventually(async () => {
    const now = (await staff("GET", "/front-door")).body.stats;
    return now.qr.visits === before.qr.visits + 2 && now.link.visits === before.link.visits + 1 && now.qr.chats === before.qr.chats + 1 ? now : null;
  }, "the visits and the chat are counted");
  assert.equal(stats.link.chats, before.link.chats);
  assert.equal(stats.days, 30);
  assert.deepEqual((await staff("GET", "/front-door", undefined, "other", "other")).body.stats.qr, { visits: 0, chats: 0 }, "each business has its own counts");
});

test("customers pay the business's own account: the platform's account is offered only when the studio turns it on", async () => {
  const settings = await staff("GET", "/booking-settings");
  assert.equal(settings.status, 200, JSON.stringify(settings.body));
  assert.equal(settings.body.platform_paystack, false);
  const refused = await staff("PUT", "/payments/paystack", { mode: "subaccount", subaccount: "ACCT_abcd1234" });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "not_offered");
  assert.match(refused.body.message, /Your customers pay into your own account/);

  // Only the studio can turn it on, and only for this business.
  assert.equal((await api("PATCH", "/v1/platform/businesses/palm", { platform_payments: true }, tokens.owner)).status, 403);
  assert.equal((await api("PATCH", "/v1/platform/businesses/palm", { platform_payments: "yes" }, ops)).status, 400);
  const turnedOn = await api("PATCH", "/v1/platform/businesses/palm", { platform_payments: true }, ops);
  assert.deepEqual([turnedOn.status, turnedOn.body.platform_payments], [200, true]);
  const list = await api("GET", "/v1/platform/businesses", undefined, ops);
  assert.deepEqual(list.body.businesses.filter((business: any) => business.platform_payments).map((business: any) => business.id), ["palm"]);
  // Past the gate now (this test platform has no payment account of its own, which is the next thing it says).
  const allowed = await staff("PUT", "/payments/paystack", { mode: "subaccount", subaccount: "ACCT_abcd1234" });
  assert.notEqual(allowed.status, 403);
  assert.notEqual(allowed.body.error, "not_offered");
  assert.equal((await staff("PUT", "/payments/paystack", { mode: "subaccount", subaccount: "ACCT_abcd1234" }, "other", "other")).status, 403, "the other business is still not offered it");
});

test("printed codes carry a short address that never changes, and send each scan wherever the business chooses", async () => {
  const scan = (path: string, agent = PHONE) => fetch(`${BASE}${path}`, { headers: { "user-agent": agent }, redirect: "manual" });
  const door = await staff("GET", "/front-door");
  assert.deepEqual([door.body.scan_url, door.body.card_url], [`${BASE}/q/palm`, `${BASE}/k/palm`]);
  assert.match(door.body.qr_svg, /<svg[^>]+viewBox/);
  assert.notEqual(door.body.qr_svg, door.body.qr_classic_svg);
  assert.match(await (await page("/c/palm/qr.svg?style=classic")).text(), /shape-rendering="crispEdges"/);
  assert.doesNotMatch(await (await page("/c/palm/qr.svg")).text(), /crispEdges/, "branded by default");

  // By default a scan opens the business's page, counted as a code or a card.
  let response = await scan("/q/palm");
  assert.deepEqual([response.status, response.headers.get("location")], [302, `${BASE}/c/palm?s=qr`]);
  response = await scan("/k/palm");
  assert.equal(response.headers.get("location"), `${BASE}/c/palm?s=card`);
  assert.equal((await scan("/q/nobody")).status, 404);

  // The website, once the chat may run there: the scan opens it with the chat open.
  assert.equal(door.body.destination.effective, "page");
  assert.match(door.body.destination.website.problem, /Add your website's address/);
  assert.equal((await staff("PATCH", "/settings", { qrDestination: "website", websiteUrl: "https://www.palmcove.example/rooms" })).status, 200);
  response = await scan("/q/palm");
  assert.equal(response.headers.get("location"), `${BASE}/c/palm?s=qr`, "not an allowed website yet: the page");
  // The owner allows the chat on the website (Settings → Website widget).
  assert.equal((await staff("PATCH", "/operations", { allowed_origins: [SITE, "https://www.palmcove.example"] })).status, 200);
  const withSite = await staff("GET", "/front-door");
  assert.deepEqual([withSite.body.destination.website.problem, withSite.body.destination.effective], [undefined, "website"]);
  const before = (await staff("GET", "/front-door")).body.stats.qr.visits;
  response = await scan("/q/palm");
  assert.equal(response.headers.get("location"), "https://www.palmcove.example/rooms#zaina");
  await scan("/q/palm", "WhatsApp/2.23.20");
  const counted = await eventually(async () => {
    const stats = (await staff("GET", "/front-door")).body.stats;
    return stats.qr.visits === before + 1 ? stats : null;
  }, "a scan that goes to the website is still counted (a link preview isn't)");
  assert.equal(counted.qr.visits, before + 1);

  // WhatsApp isn't connected to Zaina here, so choosing it sends scans to the page.
  assert.equal((await staff("PATCH", "/settings", { qrDestination: "whatsapp" })).status, 200);
  assert.equal((await scan("/k/palm")).headers.get("location"), `${BASE}/c/palm?s=card`);
  assert.equal((await staff("GET", "/front-door")).body.destination.effective, "page");
  assert.equal((await staff("PATCH", "/settings", { qrDestination: "page" })).status, 200);
});

test("a business card's details are saved with the business and its scans counted on their own", async () => {
  const card = { design: "bold", personName: "Grace Wambui", personTitle: "Guest relations", phone: "+254 700 000 321", email: "stay@palmcove.example", website: "palmcove.example", address: "Diani Beach Road" };
  assert.equal((await staff("PATCH", "/settings", { cardDetails: card }, "agent")).status, 403);
  assert.equal((await staff("PATCH", "/settings", { cardDetails: { ...card, design: "neon" } })).status, 400);
  assert.equal((await staff("PATCH", "/settings", { cardDetails: card })).status, 200);
  const door = await staff("GET", "/front-door", undefined, "viewer");
  assert.deepEqual(door.body.card, card);
  assert.match(door.body.card_qr_svg, /<svg/);
  const before = door.body.stats.card;
  // A card is scanned: its address sends the phone on to the page, which counts the visit as a card's.
  await fetch(`${BASE}/k/palm`, { headers: { "user-agent": PHONE } });
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ business: "palm", via: "card" }) });
  assert.equal(opened.status, 201);
  await eventually(async () => {
    const stats = (await staff("GET", "/front-door")).body.stats.card;
    return stats.visits === before.visits + 1 && stats.chats === before.chats + 1 ? stats : null;
  }, "the card's visit and chat are counted as a card's");
});

// The business's page as a catalogue, end to end: the tab, the cards and
// their pictures, the words by industry, a table code's spot reaching the
// chat, an order brought to the table, and the "Powered by" line.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5125;
const BASE = `http://127.0.0.1:${PORT}`;
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);
const KSH = (shillings: number) => shillings * 100;

let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const staff = (business: string, method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/${business}${route}`, body, tokens[business]);
const page = (path: string) => fetch(`${BASE}${path}`, { headers: { "user-agent": PHONE }, redirect: "manual" });
const b64 = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64");

async function chat(spot?: string | null) {
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ business: "kibanda", via: "qr", ...(spot === undefined ? {} : { spot }) }) });
  assert.equal(opened.status, 201);
  const { token, session_id } = await opened.json() as { token: string; session_id: string };
  const say = async (message: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: BASE }, body: JSON.stringify({ message, ...extra }) });
    assert.equal(response.status, 200);
    return ((await response.json()) as { reply: string }).reply;
  };
  return { say, sessionId: session_id };
}
const said = (reply: string) => JSON.parse(reply.replace(/^System said: /, ""));

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  for (const [id, name, type] of [["kibanda", "Kibanda Lounge", "restaurant"], ["palm", "Palm Cove Stays", "guesthouse"], ["studio", "Studio Nywele", "salon"]]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, tier: "full", business_type: type, allowed_origins: [`https://${id}.example`], owner: { email: `${id}@example.com`, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    tokens[id] = (await api("POST", "/v1/staff/login", { email: `${id}@example.com`, password: PASSWORD })).body.token;
  }
  // A lounge: food and gins, one picture, one gin out, delivery only (no collection).
  const caps = await staff("kibanda", "PUT", "/capabilities", { enabled: ["orders"] });
  assert.equal(caps.status, 200, JSON.stringify(caps.body));
  for (const item of [
    { section: "Food", name: "Masala chips", description: "Crispy, with our own pili pili", price: "350" },
    { section: "Food", name: "Mandazi", price: "50", unit: "each" },
    { section: "Gins", name: "Tanqueray & tonic", price: "600", available: false },
  ]) {
    const made = await staff("kibanda", "POST", "/price-list", item);
    assert.equal(made.status, 201, JSON.stringify(made.body));
  }
  for (const item of (await staff("kibanda", "GET", "/price-list")).body.items as Array<{ id: string; name: string }>) ids[item.name] = item.id;
  const picture = await fetch(`${BASE}/v1/staff/businesses/kibanda/price-list/${ids["Masala chips"]}/picture`, { method: "PUT", headers: { authorization: `Bearer ${tokens.kibanda}`, "content-type": "image/png" }, body: PNG });
  assert.equal(picture.status, 200, await picture.text());
  const settings = await staff("kibanda", "PUT", "/order-settings", { delivery: true, zones: [{ name: "Kilimani", fee: 200 }], collection: false, pay_on_delivery: true });
  assert.equal(settings.status, 200, JSON.stringify(settings.body));
  // A salon with a bookable service.
  const studioCaps = await staff("studio", "PUT", "/capabilities", { enabled: ["appointments"] });
  assert.equal(studioCaps.status, 200, JSON.stringify(studioCaps.body));
  const haircut = await staff("studio", "POST", "/offerings", { name: "Haircut", description: "Wash, cut and style", duration_minutes: 60, pricing: { price: KSH(1500) } });
  assert.equal(haircut.status, 201, JSON.stringify(haircut.body));
});

after(async () => {
  await platform?.stop();
});

test("a lounge's page opens on its menu: sections, a search box, pictures, prices, and what's out", async () => {
  const response = await page("/c/kibanda");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /data-tab="catalogue">Browse Menu<\/button>/);
  assert.match(html, /data-tab="chat">Ask Zaina<\/button>/);
  assert.match(html, />All<\/button><button type="button" class="cat-pill" data-section="Food" aria-pressed="false">Food<\/button><button type="button" class="cat-pill" data-section="Gins"/);
  assert.match(html, /placeholder="Search the menu"/);
  const thumb = html.match(/<img class="cat-thumb" src="(\/catalogue\/kibanda\/[0-9a-f-]+\?v=[0-9a-f]+)"/);
  assert.ok(thumb, "the photo is on its card");
  const photo = await fetch(`${BASE}${thumb![1]}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.match(html, /<span class="cat-name">Masala chips<\/span><i class="cat-dots" aria-hidden="true"><\/i><span class="cat-price">KSh 350<\/span><\/span><span class="cat-desc">Crispy, with our own pili pili<\/span>/);
  assert.match(html, /<span class="cat-price">KSh 50 each<\/span>/);
  // Asking or ordering through Zaina is inside the opened card, and optional.
  assert.match(html, /data-ask="Tell me about Masala chips">Ask Zaina about this<\/button><button type="button" class="cat-zaina main" data-ask="I'd like to order Masala chips">Order via Zaina<\/button>/);
  assert.match(html, /Tanqueray &amp; tonic<\/span><i class="cat-dots" aria-hidden="true"><\/i><span class="cat-price">KSh 600<\/span><\/span><span class="cat-out">Out of stock<\/span>/);
  assert.doesNotMatch(html, /I'd like to order Tanqueray/, "nothing to tap on what's out");
  assert.match(html, /<footer class="door-foot"><a href="https:\/\/bilamatata\.com"[^>]*>Powered by Bila Matata<\/a><\/footer>/);
  assert.match(response.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /font-src 'self'/);
  assert.match(response.headers.get("content-encoding") ?? "", /^(br|gzip)$/, "the page goes out compressed");
  const version = html.match(/door\.js\?v=([0-9a-f]{12})/)![1];
  const script = await fetch(`${BASE}/c-assets/door.js?v=${version}`);
  assert.match(script.headers.get("cache-control") ?? "", /immutable/, "kept until the next change");
  const font = await fetch(`${BASE}${html.match(/href="(\/c-assets\/title-classic\.woff2\?v=[0-9a-f]{12})"/)![1]}`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString("latin1"), "wOF2");
  assert.equal((await fetch(`${BASE}/c-assets/title-roman.woff2`)).status, 200, "each of the four faces answers");
  assert.equal((await fetch(`${BASE}/c-assets/title-comic.woff2`)).status, 404);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);
  assert.match(await script.text(), /zaina\.ask\(text\)/);
});

test("a pasted list with sizes and a description becomes one card with a price per size", async () => {
  const parsed = await staff("kibanda", "POST", "/price-list/parse", { text: "Vodka\nAbsolut Vodka (750ml Bottle): 5000 | Swedish, smooth\nAbsolut Vodka (Shot): 300" });
  assert.equal(parsed.status, 200);
  const imported = await staff("kibanda", "POST", "/price-list/import", { items: parsed.body.items, replace: false });
  assert.ok(imported.status < 300, JSON.stringify(imported.body));
  const html = await (await page("/c/kibanda")).text();
  assert.match(html, /<span class="cat-name">Absolut Vodka<\/span><\/span><span class="cat-desc">Swedish, smooth<\/span><span class="cat-variants"><span class="cat-variant"><span>750ml Bottle<\/span><i class="cat-dots" aria-hidden="true"><\/i><b>KSh 5,000<\/b><\/span><span class="cat-variant"><span>Shot<\/span><i class="cat-dots" aria-hidden="true"><\/i><b>KSh 300<\/b><\/span><\/span>/);
});

test("a section opens with the business's own photo once it adds one, its title alone until then", async () => {
  const before = await (await page("/c/kibanda")).text();
  assert.match(before, /<li class="cat-heading" data-heading="Food"><h2>Food<\/h2><\/li>/);
  const added = await fetch(`${BASE}/v1/staff/businesses/kibanda/catalogue-sections/picture?section=Food`, { method: "PUT", headers: { authorization: `Bearer ${tokens.kibanda}`, "content-type": "image/png" }, body: PNG });
  assert.equal(added.status, 200, await added.clone().text());
  const url = ((await added.json()) as { pictures: Record<string, string> }).pictures.food;
  assert.match(url, /^\/catalogue\/kibanda\/sections\/food\?v=[0-9a-f]{12}$/);
  const after = await (await page("/c/kibanda")).text();
  assert.ok(after.includes(`<li class="cat-heading cat-banner has-picture" data-heading="Food" data-backdrop="${url}"><img class="cat-banner-img" src="${url}" alt="" width="1200" height="480" loading="lazy" decoding="async">`), "shown at once, and only as it nears the screen");
  const picture = await fetch(`${BASE}${url}`);
  assert.equal(picture.status, 200);
  assert.equal(picture.headers.get("content-type"), "image/png");
  assert.match(picture.headers.get("cache-control") ?? "", /immutable/, "a phone downloads it once");
  // Another business's team can't change it.
  const other = await fetch(`${BASE}/v1/staff/businesses/kibanda/catalogue-sections/picture?section=Food`, { method: "DELETE", headers: { authorization: `Bearer ${tokens.studio}` } });
  assert.ok(other.status === 403 || other.status === 404, String(other.status));
  assert.equal((await staff("kibanda", "DELETE", "/catalogue-sections/picture?section=Food")).status, 200);
  assert.doesNotMatch(await (await page("/c/kibanda")).text(), /has-picture/);
});

test("the words follow the business: a salon's services, and a page with nothing to show stays the chat", async () => {
  const salon = await (await page("/c/studio")).text();
  assert.match(salon, /data-tab="catalogue">Services &amp; Prices<\/button>/);
  assert.match(salon, /<span class="cat-name">Haircut<\/span><i class="cat-dots" aria-hidden="true"><\/i><span class="cat-price">KSh 1,500<\/span><\/span><span class="cat-desc">Wash, cut and style<\/span>/);
  assert.match(salon, /data-ask="I'd like to book Haircut">Book via Zaina<\/button>/);
  const stays = await (await page("/c/palm")).text();
  assert.doesNotMatch(stays, /door-tabs|door\.js/);
  assert.match(stays, /aria-label="Chat with Zaina"/);
  assert.match(stays, /Powered by Bila Matata/);
});

test("a table's code carries its spot: through the scan, onto the page, into its own QR code", async () => {
  const scan = await page("/q/kibanda?spot=Table+5");
  assert.equal(scan.status, 302);
  assert.equal(scan.headers.get("location"), `${BASE}/c/kibanda?s=qr&spot=Table+5`);
  const html = await (await page("/c/kibanda?s=qr&spot=Table+5")).text();
  assert.match(html, /You're at <strong>Table 5<\/strong>/);
  assert.match(html, /data-spot="Table 5" async><\/script>/);
  const sly = await (await page("/c/kibanda?spot=%3Cscript%3E")).text();
  assert.doesNotMatch(sly, /data-spot|You're at/, "a spot that isn't a plain label is ignored");
  const plain = await (await fetch(`${BASE}/c/kibanda/qr.svg`)).text();
  const table = await fetch(`${BASE}/c/kibanda/qr.svg?spot=Table+5`);
  assert.equal(table.status, 200);
  assert.notEqual(await table.text(), plain, "each table has its own code");
});

test("Zaina knows the customer is at Table 5: the order is brought there, with no address or delivery fee", async () => {
  const { say, sessionId } = await chat("Table 5");
  assert.equal(await say(`TEST:has64 ${b64('they scanned the code at "Table 5"')}`, { spot: "Table 5" }), "yes");
  await say("I'd like to order Masala chips. Two please. I'm Achieng, 0722 111 333", { spot: "Table 5" });
  // Zaina places it without asking how it's handed over.
  const placed = said(await say(`TEST:raw64 place_order ${b64({ items: [{ id: ids["Masala chips"], quantity: 2 }], name: "Achieng", phone: "0722 111 333", pay_on_delivery: true })}`, { spot: "Table 5" }));
  assert.equal(placed.ok, true, JSON.stringify(placed));
  assert.equal(placed.fulfilment, "brought to Table 5");
  assert.equal(placed.total, "KSh 700");
  assert.equal(placed.delivery_fee, undefined);
  const [order] = (await platform.db.query("select fulfilment, spot, delivery_fee_minor, address, status from orders where business_id = 'kibanda' and session_id = $1", [sessionId])).rows;
  assert.deepEqual({ ...order, delivery_fee_minor: Number(order.delivery_fee_minor) }, { fulfilment: "collection", spot: "Table 5", delivery_fee_minor: 0, address: null, status: "confirmed" });
  const listed = await staff("kibanda", "GET", "/orders?filter=active");
  assert.equal(listed.body.orders.find((entry: { spot: string | null }) => entry.spot === "Table 5")?.spot, "Table 5", "the team sees where to bring it");
  // A request from the table carries the spot for the team.
  await say(`TEST:raw64 pass_request_to_team ${b64({ name: "Achieng", phone: "0722 111 333", request: "Birthday candles on the dessert" })}`, { spot: "Table 5" });
  const [lead] = (await platform.db.query("select kind, spot from leads where business_id = 'kibanda' and session_id = $1", [sessionId])).rows;
  assert.deepEqual(lead, { kind: "request", spot: "Table 5" });
});

test("without a spot, delivery rules apply as before; and the page without one clears it", async () => {
  const { say, sessionId } = await chat("Room 3");
  // The page sends spot: null when its link has none: the earlier table no longer applies.
  assert.equal(await say(`TEST:has64 ${b64("WHERE THE CUSTOMER IS")}`, { spot: null }), "no");
  assert.equal((await platform.db.query("select spot from chat_sessions where id = $1", [sessionId])).rows[0].spot, null);
  await say("Ten mandazi please. Brian, 0733 222 444", { spot: null });
  const asked = said(await say(`TEST:raw64 place_order ${b64({ items: [{ id: ids.Mandazi, quantity: 10 }], name: "Brian", phone: "0733 222 444", fulfilment: "on_site" })}`));
  assert.equal(asked.ok, false);
  assert.equal(asked.error, "no_spot");
  const collect = said(await say(`TEST:raw64 place_order ${b64({ items: [{ id: ids.Mandazi, quantity: 10 }], name: "Brian", phone: "0733 222 444", fulfilment: "collection" })}`));
  assert.equal(collect.error, "no_collection", "this lounge delivers only: collection still isn't offered");
});

// End-to-end: Zaina helps each business the way it works.
//
//   no website     a wholesaler types its catalogue (with what's out of
//                  stock) and its delivery areas; Zaina takes an order, the
//                  server adds up the total with delivery, the team accepts
//                  it and the customer hears (orders.test.ts goes further)
//   a product feed the same catalogue read from the shop's own system every
//                  day, beside what the team typed
//   its own system a custom TypeScript shop answers Zaina through
//                  docs/zaina-connector.ts: she searches it and places the
//                  order there; the shop says the total and how to pay
//
// The model is scripted (scripted-model.mjs); websites and the shop are stand-ins.

import assert from "node:assert/strict";
import http, { type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { handleZaina, type Handlers } from "../../docs/zaina-connector.ts";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5114;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOP = "https://happyfine.store.example";

let platform: Platform;
let api: Api;
let ops: string;
const tokens: Record<string, string> = {};
const staff = (business: string, method: string, route: string, body?: unknown, token = tokens[business]) => api(method, `/v1/staff/businesses/${business}${route}`, body, token);
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;
const PNG = (extra = "") => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(extra), Buffer.alloc(1024, 7)]);
const upload = (business: string, route: string, bytes: Buffer, method = "PUT") => fetch(`${BASE}/v1/staff/businesses/${business}${route}`, {
  method, headers: { authorization: `Bearer ${tokens[business]}`, "content-type": "image/png" }, body: bytes,
});
const said = (reply: string) => JSON.parse(reply.replace(/^(System|Tool) said: /, ""));

// The custom shop, answering with the developer's file.
let secret = "";
const placed: Array<{ args: any; requestId: string }> = [];
const handlers: Handlers = {
  ping: async () => ({ system: "Happyfine" }),
  search: async ({ query }) => (/oil|fry/i.test(query) ? [{ id: "gf-20", name: "Golden Fry cooking oil 20L", price: { amount_minor: 450000, currency: "KES" }, available: true, stock: 40 }] : []),
  createOrder: async (args, _customer, requestId) => {
    placed.push({ args, requestId });
    return { reference: "HF-2041", status: "received", summary: "10 × Golden Fry cooking oil 20L", total: { amount_minor: 4500000, currency: "KES" }, payment_instructions: "Pay to till 600100 once we confirm delivery." };
  },
};
const shop = http.createServer(async (req: IncomingMessage, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const out = await handleZaina(Buffer.concat(chunks), req.headers, secret, handlers);
  res.writeHead(out.status, { "content-type": "application/json" }).end(JSON.stringify(out.body));
});

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}
async function openChat(business: string, origin: string) {
  const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ business }) });
  const body = await opened.json() as { token: string };
  return { ...body, origin };
}
async function chatMessages(chat: { token: string }): Promise<Array<{ from: string; text: string }>> {
  const response = await fetch(`${BASE}/v1/chat/messages`, { headers: { authorization: `Bearer ${chat.token}` } });
  return ((await response.json()) as any).messages;
}
async function say(chat: { token: string; origin: string }, message: string) {
  const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chat.token}`, origin: chat.origin }, body: JSON.stringify({ message }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.reply as string;
}

before(async () => {
  await new Promise<void>((resolve) => shop.listen(0, "127.0.0.1", resolve));
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, FAKE_STORE_URL: `http://127.0.0.1:${(shop.address() as AddressInfo).port}` } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = await login("ops@example.com");
  for (const [id, name, origin] of [["duka", "Duka Wholesalers", "https://duka.example"], ["happy", "Happyfine Wholesalers", "https://happyfine.example"]]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, tier: "full", business_type: "general", allowed_origins: [origin], owner: { email: `${id}@example.com`, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    tokens[id] = await login(`${id}@example.com`);
  }
});

after(async () => {
  await platform?.stop();
  shop.close();
});

test("no website: the team types its catalogue and delivery areas; Zaina takes an order, the server totals it with delivery, and the team accepts it", async () => {
  assert.equal((await staff("duka", "PUT", "/capabilities", { enabled: ["orders"] })).status, 200);
  const zones = await staff("duka", "PUT", "/order-settings", { delivery: true, zones: [{ name: "Kariakor", fee: "300" }, { name: "Eastleigh", fee: 0 }], collection: false });
  assert.equal(zones.status, 200, JSON.stringify(zones.body));
  for (const item of [
    { section: "Oils", name: "Golden Fry cooking oil 20L", price: "4500", unit: "per jerrican" },
    { section: "Rice", name: "Pishori rice 25kg", price: "3,200" },
    { section: "Sugar", name: "Sugar 50kg", price: "6800", available: false },
  ]) assert.equal((await staff("duka", "POST", "/price-list", item)).status, 201, item.name);
  const list = (await staff("duka", "GET", "/price-list")).body.items as any[];
  const id = (name: string) => list.find((item) => item.name === name).id as string;
  assert.equal(list.find((item) => item.name === "Sugar 50kg").available, false);

  const chat = await openChat("duka", "https://duka.example");
  assert.match(await say(chat, "TEST:whoami"), /place_order/);
  assert.equal(await say(chat, raw64("get_prices", { query: "sugar" })), "Our prices: Sugar 50kg: KSh 6,800 (out of stock).");

  await say(chat, "Ten jerricans of Golden Fry and two bags of Pishori rice please, delivered to Kariakor tomorrow morning. I'm Achieng Otieno, 0711 222 333");
  const customer = { name: "Achieng Otieno", phone: "0711 222 333" };
  const out = said(await say(chat, raw64("place_order", { items: [{ id: id("Sugar 50kg"), quantity: 1 }], fulfilment: "delivery", delivery_area: "Kariakor", address: "Kariakor market", ...customer })));
  assert.deepEqual([out.error, out.items], ["out_of_stock", ["Sugar 50kg"]]);
  assert.equal(said(await say(chat, raw64("place_order", { items: [{ id: id("Pishori rice 25kg"), quantity: 2 }], ...customer }))).error, "fulfilment_required");
  assert.equal(said(await say(chat, raw64("place_order", { items: [{ id: "not-an-item", quantity: 2 }], fulfilment: "delivery", delivery_area: "Kariakor", address: "x", ...customer }))).error, "unknown_item");
  assert.equal(said(await say(chat, raw64("place_order", { items: [{ id: id("Pishori rice 25kg"), quantity: 2 }], fulfilment: "collection", ...customer }))).error, "no_collection");
  const where = said(await say(chat, raw64("place_order", { items: [{ id: id("Pishori rice 25kg"), quantity: 2 }], fulfilment: "delivery", delivery_area: "Karen", address: "x", ...customer })));
  assert.deepEqual([where.error, where.zones], ["zone_required", ["Kariakor", "Eastleigh"]], "only the areas the business delivers to");

  const order = said(await say(chat, raw64("place_order", {
    items: [{ id: id("Golden Fry cooking oil 20L"), quantity: 10 }, { id: id("Pishori rice 25kg"), quantity: 2 }],
    fulfilment: "delivery", delivery_area: "kariakor", address: "Kariakor market, stall 12", when: "tomorrow morning", ...customer,
  })));
  assert.equal(order.ok, true, JSON.stringify(order));
  assert.match(order.reference, /^ORD-[0-9A-F]{6}$/);
  assert.equal(order.delivery_fee, "KSh 300");
  assert.equal(order.total, "KSh 51,700", "the server adds it up: 10 × 4,500 + 2 × 3,200 + 300 delivery");
  assert.equal(order.status, "waiting for the business to accept it", "no way to pay online yet: the team says how");

  const waiting = (await staff("duka", "GET", "/orders?filter=needs_you")).body;
  assert.equal(waiting.counts.needs_you, 1);
  const [placedOrder] = waiting.orders;
  assert.deepEqual([placedOrder.reference, placedOrder.customer.name, placedOrder.total, placedOrder.zone, placedOrder.wanted], [order.reference, "Achieng Otieno", "KSh 51,700", "Kariakor", "tomorrow morning"]);
  assert.deepEqual(placedOrder.lines.map((line: any) => [line.name, line.quantity]), [["Golden Fry cooking oil 20L", 10], ["Pishori rice 25kg", 2]]);
  const accepted = await staff("duka", "POST", `/orders/${placedOrder.id}/accept`, {});
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.deepEqual([accepted.body.status, accepted.body.pay_on_delivery], ["confirmed", true], "no online way to pay: paid on delivery");
  await eventually(async () => (await chatMessages(chat)).some((message) => message.text.includes(`Order ${order.reference} is confirmed. We'll deliver to Kariakor market, stall 12, Kariakor. You'll pay KSh 51,700 on delivery.`)), "the customer hears it's confirmed in the chat");
});

test("a product feed from the shop's own system becomes its catalogue, beside what the team typed, and is read again", async () => {
  const feed = (products: unknown[]) => platform.publishPage("duka.example", "api/products.json", JSON.stringify({ products }));
  feed([
    { id: "p1", name: "Golden Fry cooking oil 20L", price: "4,600", category: "Oils" },
    { id: "p2", name: "Maize flour 2kg", price: 210, category: "Flour", stock: 0, url: "/p/flour" },
    { id: "p3", name: "Imported jam", price: "12 EUR" },
  ]);
  const read = await staff("duka", "PUT", "/price-list/feed", { url: "https://duka.example/api/products" });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.deepEqual([read.body.feed.last_items, read.body.feed.last_skipped], [1, 2], "the team's own oil stands; a price in euros is left out");
  let items = (await staff("duka", "GET", "/price-list")).body.items as any[];
  const flour = items.find((item) => item.name === "Maize flour 2kg");
  assert.deepEqual([flour.source, flour.available, flour.url, flour.price_display], ["feed", false, "https://duka.example/p/flour", "KSh 210"]);
  assert.equal(items.find((item) => item.name === "Golden Fry cooking oil 20L").price_display, "KSh 4,500 per jerrican");

  feed([{ id: "p4", name: "Salt 1kg", price: 60, category: "Salt" }]);
  assert.equal((await staff("duka", "POST", "/price-list/feed/sync")).status, 200);
  items = (await staff("duka", "GET", "/price-list")).body.items;
  assert.ok(items.some((item) => item.name === "Salt 1kg" && item.source === "feed"));
  assert.ok(!items.some((item) => item.name === "Maize flour 2kg"), "gone from the feed, gone from the catalogue");
  assert.equal(items.filter((item) => item.source === "manual").length, 3, "what the team typed is untouched");

  platform.publishPage("duka.example", "shop.html", "<!doctype html><html><body><h1>Our shop</h1></body></html>");
  const page = await staff("duka", "PUT", "/price-list/feed", { url: "https://duka.example/shop" });
  assert.equal(page.status, 400);
  assert.match(page.body.message, /web page, not a product feed/);
  assert.equal((await staff("duka", "DELETE", "/price-list/feed")).status, 200);
  assert.ok(!(await staff("duka", "GET", "/price-list")).body.items.some((item: any) => item.source === "feed"));
});

test("its own system: Zaina searches the custom shop and places the order there, through the developer's TypeScript file", async () => {
  assert.equal((await api("PATCH", "/v1/platform/businesses/happy/integration", { enabled: true }, ops)).status, 200);
  const settings = { endpoint: `${SHOP}/zaina`, actions: ["catalog.search", "order.create"] };
  assert.equal((await staff("happy", "PUT", "/integration", settings, ops)).body.error, "writes_not_allowed");
  assert.equal((await staff("happy", "PUT", "/integration", { ...settings, allow_writes: true }, ops)).status, 200);
  secret = (await staff("happy", "POST", "/integration/secret", undefined, ops)).body.secret;
  const tested = await staff("happy", "POST", "/integration/test");
  assert.deepEqual([tested.body.ok, tested.body.system], [true, "Happyfine"]);

  const chat = await openChat("happy", "https://happyfine.example");
  const tools = await say(chat, "TEST:whoami");
  assert.match(tools, /store_order/);
  assert.doesNotMatch(tools, /place_order/, "the shop's own system takes the order");
  const found = said(await say(chat, raw64("store_search", { query: "golden fry" })));
  assert.equal(found.items[0].price.say, "KSh 4,500");

  await say(chat, "Ten jerricans please, delivered to Kariakor. I'm Achieng Otieno, 0711 222 333");
  const order = said(await say(chat, raw64("store_order", { items: [{ id: "gf-20", quantity: 10 }], fulfilment: "delivery", area: "Kariakor", name: "Achieng Otieno", phone: "0711 222 333" })));
  assert.equal(order.ok, true, JSON.stringify(order));
  assert.deepEqual([order.order.reference, order.order.total.say, order.order.payment_instructions], ["HF-2041", "KSh 45,000", "Pay to till 600100 once we confirm delivery."]);
  assert.deepEqual(placed[0].args, { items: [{ id: "gf-20", quantity: 10 }], fulfilment: "delivery", area: "Kariakor", contact: { name: "Achieng Otieno", phone: "0711 222 333" } });
  assert.match(placed[0].requestId, /^[0-9a-f-]{36}$/);

  const kit = await fetch(`${BASE}/api/zaina/integration/zaina-connector.ts`);
  assert.equal(kit.status, 200);
  assert.match(await kit.text(), /export async function handleZaina/);
});

test("pictures: a photo the team uploads is kept in the database, and Zaina shares its link; a feed's pictures come with it", async () => {
  const items = (await staff("duka", "GET", "/price-list")).body.items as any[];
  const oil = items.find((item) => item.name === "Golden Fry cooking oil 20L");
  assert.equal(oil.picture_url, null);
  assert.equal((await upload("duka", `/price-list/${oil.id}/picture`, Buffer.from("<svg onload=alert(1)>"))).status, 400, "only real pictures");
  const saved = await (await upload("duka", `/price-list/${oil.id}/picture`, PNG())).json() as any;
  assert.match(saved.item.picture_url, new RegExp(`^/catalogue/duka/${oil.id}\\?v=[0-9a-f]{12}$`));
  const stored = (await platform.db.query("select content_type, octet_length(bytes) as size from catalogue_images where item_id = $1", [oil.id])).rows[0];
  assert.deepEqual([stored.content_type, stored.size], ["image/png", PNG().length], "kept in the database");

  const served = await fetch(`${BASE}${saved.item.picture_url}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.match(served.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(served.headers.get("cross-origin-resource-policy"), "cross-origin", "the chat on the business's own website shows it");
  assert.equal((await fetch(`${BASE}/catalogue/happy/${oil.id}`)).status, 404, "never from another business");

  // Zaina is given each picture's address, and may pass on an https one as it is (this test service is plain http, so its own is held back here).
  const chat = await openChat("duka", "https://duka.example");
  assert.match(await say(chat, raw64("get_prices", { query: "golden fry" })), /Golden Fry cooking oil 20L: KSh 4,500 per jerrican \(picture: /);
  const rice = items.find((item) => item.name === "Pishori rice 25kg");
  assert.equal((await staff("duka", "PATCH", `/price-list/${rice.id}`, { image_url: "https://cdn.duka.example/rice.jpg" })).status, 200);
  assert.equal(await say(chat, raw64("get_prices", { query: "pishori rice" })), "Our prices: Pishori rice 25kg: KSh 3,200 (picture: https://cdn.duka.example/rice.jpg).");

  // A feed's own pictures, by their address.
  platform.publishPage("duka.example", "api/products.json", JSON.stringify({ products: [{ id: "p9", name: "Maize flour 2kg", price: 210, images: [{ src: "https://cdn.duka.example/flour.jpg" }] }] }));
  assert.equal((await staff("duka", "PUT", "/price-list/feed", { url: "https://duka.example/api/products", daily: false })).status, 200);
  const flour = ((await staff("duka", "GET", "/price-list")).body.items as any[]).find((item) => item.name === "Maize flour 2kg");
  assert.equal(flour.picture_url, "https://cdn.duka.example/flour.jpg");

  // Removed with its item.
  assert.equal((await upload("duka", `/price-list/${oil.id}/picture`, Buffer.alloc(0), "DELETE")).status, 200);
  assert.equal((await fetch(`${BASE}${saved.item.picture_url}`)).status, 404);
  await staff("duka", "DELETE", "/price-list/feed");
});

test("snap your price list: Zaina reads a photo of the board into items to check, and nothing is added until the owner says so", async () => {
  const board = "Mboga\nSukuma wiki — 20 per bunch\nTomatoes: 50 per kg\nMatunda\nAvocado 15";
  const read = await (await upload("duka", "/price-list/read-photo", PNG(`TEST-PRICES:${Buffer.from(board).toString("base64")}`), "POST")).json() as any;
  assert.deepEqual(read.items.map((item: any) => [item.section, item.name, item.price, item.unit]), [
    ["Mboga", "Sukuma wiki", "20", "per bunch"],
    ["Mboga", "Tomatoes", "50", "per kg"],
    ["Matunda", "Avocado", "15", null],
  ]);
  assert.ok(!((await staff("duka", "GET", "/price-list")).body.items as any[]).some((item) => item.name === "Sukuma wiki"), "nothing saved yet");
  const none = await (await upload("duka", "/price-list/read-photo", PNG(), "POST")).json() as any;
  assert.deepEqual(none.items, [], "a photo with no price list in it");
  assert.equal((await upload("duka", "/price-list/read-photo", Buffer.from("not a picture"), "POST")).status, 400);
});

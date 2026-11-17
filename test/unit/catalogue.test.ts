// The catalogue from a business's own feed (src/prices/feed.ts), and the
// rules an order follows (src/orders), without a database.

import assert from "node:assert/strict";
import test from "node:test";
import { feedItem, feedPrice, parseFeed } from "../../src/prices/feed.ts";
import { firstStatus, orderAmountDue, zoneFee } from "../../src/orders/store.ts";
import { DEFAULT_ORDER_SETTINGS, validateOrderSettings } from "../../src/orders/settings.ts";
import { itemPictureUrl } from "../../src/prices/images.ts";

const feedUrl = new URL("https://happyfine.example/api/products");

test("prices as shops write them, in KES or USD only", () => {
  assert.deepEqual(feedPrice("KSh 1,200"), { minor: 120000, currency: "KES" });
  assert.deepEqual(feedPrice("1200.00 KES"), { minor: 120000, currency: "KES" });
  assert.deepEqual(feedPrice("1,500/="), { minor: 150000, currency: "KES" });
  assert.deepEqual(feedPrice("$15"), { minor: 1500, currency: "USD" });
  assert.deepEqual(feedPrice(450), { minor: 45000, currency: "KES" });
  assert.equal(feedPrice("12 EUR"), null);
  assert.equal(feedPrice("call us"), null);
});

test("a feed as JSON, CSV or Google Merchant XML; links only to the feed's own site", () => {
  const json = parseFeed(JSON.stringify({ products: [
    { id: 7, name: "Golden Fry 20L", price: "4,500", category: "Oils", stock: 0, url: "/p/golden-fry" },
    { title: "Rice 25kg", price: 3200, link: "https://elsewhere.example/x" },
    { name: "No price" },
  ] }), "application/json", feedUrl);
  assert.equal(json.skipped, 1);
  assert.deepEqual(json.items.map((item) => [item.name, item.section, item.priceMinor, item.available, item.url, item.externalId]), [
    ["Golden Fry 20L", "Oils", 450000, false, "https://happyfine.example/p/golden-fry", "7"],
    ["Rice 25kg", null, 320000, true, null, null],
  ]);
  const csv = parseFeed('name,price,category,in stock\n"Sugar, 50kg",6800,Sugar,yes\nSalt 1kg,60,,no\n', "text/csv", feedUrl);
  assert.deepEqual(csv.items.map((item) => [item.name, item.priceMinor, item.available]), [["Sugar, 50kg", 680000, true], ["Salt 1kg", 6000, false]]);
  const xml = parseFeed('<rss><channel><item><g:id>A1</g:id><title>Flour 2kg</title><g:price>210.00 KES</g:price><g:availability>out of stock</g:availability><link>https://www.happyfine.example/flour</link></item></channel></rss>', "application/xml", feedUrl);
  assert.deepEqual(xml.items.map((item) => [item.name, item.priceMinor, item.available, item.url, item.externalId]), [["Flour 2kg", 21000, false, "https://www.happyfine.example/flour", "A1"]]);
  assert.throws(() => parseFeed("{ not json", "application/json", feedUrl), /isn't valid JSON/);
  assert.throws(() => parseFeed(JSON.stringify({ hello: 1 }), "application/json", feedUrl), /no list of products/);
});

test("WooCommerce's Store API and Shopify's products.json as they come", () => {
  const woo = feedItem({ id: 9, name: "Oil", prices: { price: "450000", currency_code: "KES", currency_minor_unit: 2 }, categories: [{ name: "Oils" }], is_in_stock: false, permalink: "https://happyfine.example/oil" }, feedUrl);
  assert.deepEqual([woo?.priceMinor, woo?.section, woo?.available], [450000, "Oils", false]);
  const shopify = feedItem({ id: 3, title: "Kikoi", handle: "kikoi", product_type: "Textiles", variants: [{ price: "2500.00", available: false }, { price: "2500.00", available: true }] }, feedUrl);
  assert.deepEqual([shopify?.priceMinor, shopify?.available, shopify?.url], [250000, true, "https://happyfine.example/products/kikoi"]);
});

test("an order's first step: paid online, paid on delivery, or the team accepts it first", () => {
  const settings = { ...DEFAULT_ORDER_SETTINGS };
  const first = (over: Partial<typeof settings>, input: { pricedByTeam?: boolean; online?: boolean; wantsPayOnDelivery?: boolean }) =>
    firstStatus({ settings: { ...settings, ...over }, pricedByTeam: input.pricedByTeam ?? false, online: input.online ?? true, wantsPayOnDelivery: input.wantsPayOnDelivery ?? false });
  assert.deepEqual(first({}, {}), { status: "awaiting_payment", payOnDelivery: false });
  assert.deepEqual(first({}, { wantsPayOnDelivery: true }), { status: "awaiting_payment", payOnDelivery: false }, "the business doesn't take payment on delivery");
  assert.deepEqual(first({ payOnDelivery: true }, { wantsPayOnDelivery: true }), { status: "confirmed", payOnDelivery: true });
  assert.deepEqual(first({ payOnDelivery: true }, { online: false }), { status: "confirmed", payOnDelivery: true }, "no way to pay online: on delivery");
  assert.deepEqual(first({}, { online: false }), { status: "requested", payOnDelivery: false }, "no way to pay at all: the team says how");
  assert.deepEqual(first({}, { pricedByTeam: true }), { status: "requested", payOnDelivery: false }, "a price range: the team sets the total");
  assert.deepEqual(first({ confirm: "team" }, {}), { status: "requested", payOnDelivery: false });
});

test("delivery areas, their fees and the order settings a team can set", () => {
  const checked = validateOrderSettings({ delivery: true, zones: [{ name: "Westlands", fee: "200" }, { name: "CBD", fee: 0 }], minimum: "1,000", collection_point: "  Shop 4,  Gikomba  " }, DEFAULT_ORDER_SETTINGS);
  assert.ok(checked.ok);
  assert.deepEqual(checked.value.zones, [{ name: "Westlands", feeMinor: 20000 }, { name: "CBD", feeMinor: 0 }]);
  assert.deepEqual([checked.value.minimumMinor, checked.value.collectionPoint], [100000, "Shop 4, Gikomba"]);
  assert.deepEqual(zoneFee(checked.value, " westlands "), { name: "Westlands", feeMinor: 20000 });
  assert.equal(zoneFee(checked.value, "Karen"), null);
  assert.equal(zoneFee(checked.value, ""), null);
  const refuse = (input: Record<string, unknown>) => { const result = validateOrderSettings(input, DEFAULT_ORDER_SETTINGS); return result.ok ? "" : result.error; };
  assert.match(refuse({ delivery: true }), /areas you deliver to/);
  assert.match(refuse({ collection: false }), /delivery, collection, or both/);
  assert.match(refuse({ delivery: true, zones: [{ name: "CBD", fee: 1 }, { name: "cbd", fee: 2 }] }), /twice/);
  assert.match(refuse({ hold_minutes: 5 }), /10 to 1,440/);
  assert.match(refuse({ confirm: "maybe" }), /auto or team/);
});

test("what's due on an order: online until it's paid, on delivery when the customer chose that", () => {
  const order = { status: "awaiting_payment", totalMinor: 517000, paidMinor: 0, payOnDelivery: false } as const;
  assert.equal(orderAmountDue(order), 517000);
  assert.equal(orderAmountDue({ ...order, status: "requested" }), 0, "not before the team accepts it");
  assert.equal(orderAmountDue({ ...order, status: "confirmed" }), 0, "paid");
  assert.equal(orderAmountDue({ ...order, status: "out_for_delivery", payOnDelivery: true }), 517000);
  assert.equal(orderAmountDue({ ...order, status: "expired", paidMinor: 17000 }), 500000);
  assert.equal(orderAmountDue({ ...order, status: "cancelled" }), 0);
});

test("a feed's pictures, wherever the shop keeps them, https only; an uploaded photo's address", () => {
  const picture = (row: Record<string, unknown>) => feedItem({ name: "Oil", price: 100, ...row }, feedUrl)?.imageUrl;
  assert.equal(picture({ image: "/img/oil.jpg" }), "https://happyfine.example/img/oil.jpg");
  assert.equal(picture({ images: [{ src: "https://cdn.shopify.example/oil.jpg" }] }), "https://cdn.shopify.example/oil.jpg");
  assert.equal(picture({ image: { src: "https://cdn.shopify.example/oil2.jpg" } }), "https://cdn.shopify.example/oil2.jpg");
  assert.equal(picture({ image_link: "http://insecure.example/oil.jpg" }), null);
  const xml = parseFeed('<rss><item><title>Flour</title><g:price>210 KES</g:price><g:image_link>https://happyfine.example/flour.jpg</g:image_link></item></rss>', "application/xml", feedUrl);
  assert.equal(xml.items[0].imageUrl, "https://happyfine.example/flour.jpg");
  assert.equal(itemPictureUrl({ id: "abc", businessId: "duka", imageUrl: "https://cdn.example/x.jpg", imageVersion: "0123456789ab" }, "https://bilamatata.com"), "https://bilamatata.com/catalogue/duka/abc?v=0123456789ab");
  assert.equal(itemPictureUrl({ id: "abc", businessId: "duka", imageUrl: "https://cdn.example/x.jpg", imageVersion: null }, "https://bilamatata.com"), "https://cdn.example/x.jpg");
});

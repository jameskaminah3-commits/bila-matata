// The catalogue from a business's own feed (src/prices/feed.ts), and an
// order's total from the catalogue (src/orders/tool.ts), without a database.

import assert from "node:assert/strict";
import test from "node:test";
import { feedItem, feedPrice, parseFeed } from "../../src/prices/feed.ts";
import { priceOrder } from "../../src/orders/tool.ts";
import type { PriceItem } from "../../src/db/schema.ts";

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

test("an order's total comes from the catalogue; a range leaves it to the team", () => {
  const item = (id: string, priceMinor: number, priceMaxMinor: number | null = null) => ({ id, name: id, priceMinor, priceMaxMinor, currency: "KES", unit: null } as unknown as PriceItem);
  const fixed = priceOrder([{ item: item("oil", 450000), quantity: 10 }, { item: item("rice", 320000), quantity: 2 }]);
  assert.ok(fixed.ok);
  assert.deepEqual([fixed.totalMinor, fixed.totalText, fixed.lines[1].lineTotalMinor], [5140000, "KSh 51,400", 640000]);
  const range = priceOrder([{ item: item("oil", 450000), quantity: 1 }, { item: item("delivery", 20000, 50000), quantity: 1 }]);
  assert.ok(range.ok);
  assert.equal(range.totalMinor, null);
  assert.match(range.totalText, /confirmed by the team/);
  const mixed = priceOrder([{ item: item("oil", 450000), quantity: 1 }, { item: { ...item("tour", 5000), currency: "USD" } as PriceItem, quantity: 1 }]);
  assert.equal(mixed.ok, false);
});

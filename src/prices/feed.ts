// src/prices/feed.ts
//
// The business's catalogue from its own system: a product feed at an https
// address, read now and (when daily is on) every day, so Zaina quotes and
// takes orders for what the business really sells, at today's prices and
// stock. Whatever the system already publishes is read as it is:
//
//   JSON        a list of products, or { products | items | data | results: […] }:
//               the usual names for each field (name or title, price, category,
//               description, in stock, link, id or sku), WooCommerce's Store API
//               (/wp-json/wc/store/v1/products) and Shopify's /products.json
//   CSV         a header row with those names (a spreadsheet saved as CSV)
//   XML         a Google Merchant feed (<item> or <entry> with g:title, g:price…)
//
// Items go into the price list marked "from your feed" (price-list.ts
// syncFeedItems): updated in place, removed when they leave the feed, never
// touching what the team typed. Only KES and USD prices are kept; links only
// to the feed's own website.

import { formatMoney } from "../booking/money.ts";
import { everyBusiness } from "../businesses/registry.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import type { BookingCurrency, CatalogueFeed } from "../db/schema.ts";
import { htmlToText } from "../knowledge/import.ts";
import { fetchPublic, PublicFetchError } from "../net/public-fetch.ts";
import { MAX_PRICE_ITEMS, syncFeedItems, type FeedItemValues } from "./price-list.ts";

const FEED_BYTES = 5 * 1024 * 1024;
export const FEED_PERIOD_MS = 24 * 60 * 60 * 1000;

export class FeedError extends Error {}

type Raw = Record<string, unknown>;

const text = (value: unknown, max: number): string => {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  const plain = /<[a-z!/]/i.test(value) ? htmlToText(`<body>${value}</body>`).text : value;
  return plain.replace(/\s+/g, " ").trim().slice(0, max);
};
const first = (row: Raw, keys: string[]): unknown => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};
const siteOf = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** "KSh 1,200", "1200.00 KES", "$15", 1200 → minor units and currency; null when it isn't a price in KES or USD. */
export function feedPrice(value: unknown, currencyHint?: unknown): { minor: number; currency: BookingCurrency } | null {
  const hint = typeof currencyHint === "string" ? currencyHint.trim().toUpperCase() : "";
  let raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const said = /\b(USD|US\$)|\$/i.test(raw) ? "USD" : /\b(KES|KSHS?|SH\.?|SHS)\b/i.test(raw) || /\/=\s*$/.test(raw) ? "KES" : /\b[A-Z]{3}\b/.test(raw) ? raw.match(/\b([A-Z]{3})\b/)![1] : null;
  const currency = said ?? (hint || "KES");
  if (currency !== "KES" && currency !== "USD") return null;
  raw = raw.replace(/\b(USD|US\$|KES|KSHS?|SHS?)\b\.?|\$|\/=/gi, "").replace(/,/g, "").trim();
  if (!/^\d{1,10}(\.\d{1,4})?$/.test(raw)) return null;
  return { minor: Math.round(Number(raw) * 100), currency };
}

function availableOf(row: Raw): boolean {
  const flag = first(row, ["available", "in_stock", "is_in_stock", "instock", "inStock", "isAvailable"]);
  if (typeof flag === "boolean") return flag;
  if (typeof flag === "string") return !/^(false|no|0|out)/i.test(flag.trim());
  const status = first(row, ["stock_status", "availability", "status"]);
  if (typeof status === "string" && /out|sold|unavailable|discontinued/i.test(status)) return false;
  const count = first(row, ["stock", "quantity", "inventory_quantity", "stock_quantity", "qty"]);
  if (typeof count === "number") return count > 0;
  if (typeof count === "string" && /^\d+$/.test(count.trim())) return Number(count) > 0;
  if (typeof count === "string" && /out|sold/i.test(count)) return false;
  return true;
}

function categoryOf(row: Raw): string {
  const value = first(row, ["category", "section", "product_type", "type", "collection", "department", "categories"]);
  if (Array.isArray(value)) {
    const top = value[0] as unknown;
    return text(typeof top === "object" && top ? (top as Raw).name : top, 80);
  }
  if (typeof value === "object" && value) return text((value as Raw).name, 80);
  return text(value, 80);
}

/** One product as a catalogue item, or null when it has no name or no price this catalogue can hold. */
export function feedItem(row: Raw, feedUrl: URL): FeedItemValues | null {
  const name = text(first(row, ["name", "title", "product_name", "productName", "product"]), 120);
  if (!name) return null;
  let price: { minor: number; currency: BookingCurrency } | null = null;
  const woo = row.prices as Raw | undefined;
  const variants = Array.isArray(row.variants) ? (row.variants as Raw[]) : null;
  if (woo && typeof woo === "object" && woo.price !== undefined) {
    // WooCommerce's Store API: prices in minor units, with the currency's decimals.
    const digits = Number(woo.currency_minor_unit ?? 2);
    const amount = Number(woo.price);
    const currency = String(woo.currency_code ?? "KES").toUpperCase();
    if (Number.isFinite(amount) && (currency === "KES" || currency === "USD")) price = { minor: Math.round(amount * 10 ** (2 - digits)), currency };
  } else if (variants?.length && first(row, ["price"]) === undefined) {
    // Shopify: the first variant's price; in stock when any variant is.
    price = feedPrice(variants[0].price, first(row, ["currency"]));
    if (!variants.some((variant) => variant.available !== false)) row = { ...row, available: false };
  } else {
    price = feedPrice(first(row, ["price", "sale_price", "regular_price", "amount", "cost", "unit_price"]), first(row, ["currency", "currency_code"]));
  }
  if (!price) return null;
  const highest = feedPrice(first(row, ["price_max", "max_price"]), price.currency);
  const handle = typeof row.handle === "string" ? row.handle : null;
  let url: string | null = null;
  const link = first(row, ["url", "link", "permalink", "product_url", "href"]);
  try {
    const candidate = typeof link === "string" ? new URL(link, feedUrl) : handle ? new URL(`/products/${handle}`, feedUrl) : null;
    if (candidate && candidate.protocol === "https:" && siteOf(candidate.hostname) === siteOf(feedUrl.hostname)) url = candidate.toString().slice(0, 500);
  } catch {
    // Not a link.
  }
  const id = first(row, ["id", "sku", "product_id", "handle", "code"]);
  // Its picture, wherever the shop keeps it (its own site or a picture service), https only.
  const images = Array.isArray(row.images) ? (row.images as Raw[]) : null;
  const picture = first(row, ["image", "image_url", "imageUrl", "image_link", "picture", "photo", "thumbnail"]) ?? images?.[0]?.src ?? images?.[0]?.url;
  let imageUrl: string | null = null;
  try {
    const candidate = typeof picture === "string" ? new URL(picture, feedUrl) : typeof picture === "object" && picture && typeof (picture as Raw).src === "string" ? new URL(String((picture as Raw).src), feedUrl) : null;
    if (candidate && candidate.protocol === "https:" && candidate.toString().length <= 500) imageUrl = candidate.toString();
  } catch {
    // Not a picture address.
  }
  return {
    section: categoryOf(row) || null,
    name,
    description: text(first(row, ["description", "short_description", "summary", "body_html", "details"]), 500) || null,
    priceMinor: price.minor,
    priceMaxMinor: highest && highest.currency === price.currency && highest.minor > price.minor ? highest.minor : null,
    currency: price.currency,
    unit: text(first(row, ["unit", "per", "uom", "pack_size"]), 40) || null,
    available: availableOf(row),
    url,
    imageUrl,
    externalId: id === undefined ? null : String(id).slice(0, 200),
  };
}

/** A CSV text as rows keyed by its header (lower case, spaces as underscores). Quoted fields may hold commas and line breaks. */
export function csvRows(input: string): Raw[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const delimiter = (input.split("\n", 1)[0].match(/;/g)?.length ?? 0) > (input.split("\n", 1)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; } else if (char === '"') quoted = false; else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((entry) => entry.some((cell) => cell.trim()));
  if (!header) return [];
  const keys = header.map((cell) => cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return body.map((cells) => Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? "").trim()])));
}

/** A Google Merchant feed's items, with g: names as plain keys. */
export function merchantRows(xml: string): Raw[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.map((block) => {
    const row: Raw = {};
    for (const match of block.matchAll(/<(?:g:)?([a-z_]+)\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:g:)?\1>)/gi)) {
      const key = match[1].toLowerCase();
      const value = (match[2] ?? "").replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
      if (key === "link" && !value) {
        const href = /href\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1];
        if (href && row.link === undefined) row.link = href;
      } else if (row[key] === undefined) row[key] = value;
    }
    return row;
  });
}

/** A feed's products as catalogue items: what was read, and how many products were left out. */
export function parseFeed(body: string, contentType: string, feedUrl: URL): { items: FeedItemValues[]; skipped: number } {
  const trimmed = body.replace(/^﻿/, "").trim();
  let rows: Raw[];
  if (/json/.test(contentType) || /^[[{]/.test(trimmed)) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new FeedError("The feed isn't valid JSON.");
    }
    const list = Array.isArray(json) ? json : ["products", "items", "data", "results", "entries", "catalogue", "catalog"].map((key) => (json as Raw)?.[key]).find(Array.isArray);
    if (!Array.isArray(list)) throw new FeedError("The feed has no list of products (an array, or { \"products\": [...] }).");
    rows = list.filter((entry): entry is Raw => typeof entry === "object" && entry !== null);
  } else if (/xml|rss|atom/.test(contentType) || trimmed.startsWith("<")) {
    rows = merchantRows(trimmed);
  } else {
    rows = csvRows(trimmed);
  }
  const items: FeedItemValues[] = [];
  const names = new Set<string>();
  let skipped = 0;
  for (const row of rows.slice(0, MAX_PRICE_ITEMS * 2)) {
    const item = feedItem(row, feedUrl);
    const key = item ? `${(item.section ?? "").toLowerCase()}|${item.name.toLowerCase()}` : "";
    if (!item || names.has(key)) {
      skipped += 1;
      continue;
    }
    names.add(key);
    items.push(item);
  }
  if (!items.length) throw new FeedError(rows.length ? "None of the feed's products had a name and a price in KES or USD." : "The feed has no products.");
  return { items, skipped };
}

/** Reads the feed and keeps the catalogue in step with it. Throws FeedError or PublicFetchError with a message for the team. */
export async function readFeed(businessId: string, address: string): Promise<{ items: number; skipped: number; sample: string[] }> {
  const response = await fetchPublic(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`, {
    accept: "application/json, text/csv, application/xml, text/xml;q=0.9, */*;q=0.5",
    maxBytes: FEED_BYTES,
    timeoutMs: 15_000,
  });
  if (response.status !== 200) throw new FeedError(`The feed answered ${response.status}.`);
  if (/^(<!doctype html|<html)/.test(response.body.toString("utf8", 0, 500).replace(/^\uFEFF/, "").trim().toLowerCase())) {
    throw new FeedError("That address is a web page, not a product feed. Give the address of the products' data (JSON, CSV or a Google Merchant feed).");
  }
  const parsed = parseFeed(response.body.toString("utf8"), response.contentType, response.url);
  const synced = await syncFeedItems(businessId, parsed.items);
  return {
    items: synced.items,
    skipped: parsed.skipped + synced.skipped,
    sample: parsed.items.slice(0, 3).map((item) => `${item.name}: ${formatMoney(item.priceMinor, item.currency)}${item.available ? "" : " (out of stock)"}`),
  };
}

/** Reads a business's feed now, and remembers how it went. */
export async function refreshFeed(businessId: string, feed: Pick<CatalogueFeed, "url" | "daily">, userId: string | null, now = new Date()) {
  try {
    const result = await readFeed(businessId, feed.url);
    const saved: CatalogueFeed = { url: feed.url, daily: feed.daily, lastReadAt: now.toISOString(), lastItems: result.items, lastSkipped: result.skipped, lastError: null };
    await updateBusinessSettings(businessId, { catalogueFeed: saved }, userId);
    return { ok: true as const, feed: saved, sample: result.sample };
  } catch (error) {
    if (!(error instanceof FeedError || error instanceof PublicFetchError)) throw error;
    const previous = (await getBusinessSettings(businessId))?.catalogueFeed;
    const saved: CatalogueFeed = { url: feed.url, daily: feed.daily, lastReadAt: now.toISOString(), lastItems: previous?.url === feed.url ? previous.lastItems : 0, lastSkipped: 0, lastError: error.message.slice(0, 300) };
    await updateBusinessSettings(businessId, { catalogueFeed: saved }, userId);
    return { ok: false as const, feed: saved, message: error.message };
  }
}

/** Every business's feed that is due (daily), one at a time; a failure is noted on the business, never thrown. */
export async function syncFeeds(now = new Date()): Promise<number> {
  let read = 0;
  for (const business of await everyBusiness()) {
    if (business.status === "paused") continue;
    const feed = (await getBusinessSettings(business.id))?.catalogueFeed;
    if (!feed?.daily || (feed.lastReadAt && now.getTime() - new Date(feed.lastReadAt).getTime() < FEED_PERIOD_MS)) continue;
    try {
      await refreshFeed(business.id, feed, null, now);
      read += 1;
    } catch (error) {
      console.error(`[catalogue-feed] ${business.id}:`, error);
    }
  }
  return read;
}

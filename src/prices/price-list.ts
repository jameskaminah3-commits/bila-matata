// src/prices/price-list.ts
//
// A business's price list (migration 0014): what it charges for things that
// aren't booked through Zaina. Checked here, kept inside the business
// (row-level security), and the only place besides rooms and services that
// Zaina takes a price from (get_prices, prices/tool.ts).
//
// Staff can paste a list as they have it ("Airport transfer — KSh 3,500 per
// car", a heading line for each section); parsePriceList turns it into items
// to check before saving.

import { and, asc, eq, sql } from "drizzle-orm";
import { formatMoney, toMinor } from "../booking/money.ts";
import { bookingCurrencies, priceItems, type BookingCurrency, type PriceItem } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { itemPictureUrl } from "./images.ts";

export const MAX_PRICE_ITEMS = 500;

export type PriceItemValues = {
  section: string | null;
  name: string;
  description: string | null;
  priceMinor: number;
  priceMaxMinor: number | null;
  currency: BookingCurrency;
  unit: string | null;
  status: "active" | "hidden";
  sortOrder: number;
  /** In stock right now (an item that's out stays listed, and can't be ordered). */
  available: boolean;
  /** Its page on the business's website, if any. */
  url: string | null;
  /** A picture of it elsewhere (https), when none is uploaded here. */
  imageUrl: string | null;
  /** How many are left, counted down by each order (null: not counted). */
  stockQuantity: number | null;
};

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/** Checks an item staff sent (prices in major units: "3,500"); returns the clean values or the first problem. */
export function validatePriceItem(input: Record<string, unknown>, current?: PriceItemValues): { ok: true; value: PriceItemValues } | { ok: false; error: string } {
  const has = (key: string) => key in input;
  const name = has("name") ? clean(input.name) : current?.name ?? "";
  if (!name || name.length > 120) return { ok: false, error: "A name of 1 to 120 characters, please." };
  const section = has("section") ? clean(input.section) || null : current?.section ?? null;
  if (section && section.length > 80) return { ok: false, error: "A section is at most 80 characters." };
  const description = has("description") ? (typeof input.description === "string" ? input.description.trim() : "") || null : current?.description ?? null;
  if (description && description.length > 500) return { ok: false, error: "A description is at most 500 characters." };
  const price = has("price") ? toMinor(input.price) : current?.priceMinor ?? null;
  if (price === null) return { ok: false, error: "The price, like 3500 or 3,500 (0 for free)." };
  const priceMax = has("price_max") ? (input.price_max === null || input.price_max === "" ? null : toMinor(input.price_max)) : current?.priceMaxMinor ?? null;
  if (has("price_max") && input.price_max !== null && input.price_max !== "" && priceMax === null) return { ok: false, error: "The highest price, like 5000, or leave it empty." };
  if (priceMax !== null && priceMax <= price) return { ok: false, error: "The highest price must be more than the price." };
  const currency = (has("currency") ? input.currency : current?.currency ?? "KES") as BookingCurrency;
  if (!bookingCurrencies.includes(currency)) return { ok: false, error: `currency is ${bookingCurrencies.join(" or ")}.` };
  const unit = has("unit") ? clean(input.unit) || null : current?.unit ?? null;
  if (unit && unit.length > 40) return { ok: false, error: "What the price is per is at most 40 characters (\"per person\")." };
  const status = has("status") ? input.status : current?.status ?? "active";
  if (status !== "active" && status !== "hidden") return { ok: false, error: "status is active or hidden." };
  const sortOrder = has("sort_order") ? Number(input.sort_order) : current?.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 100_000) return { ok: false, error: "sort_order is a whole number." };
  const available = has("available") ? input.available : current?.available ?? true;
  if (typeof available !== "boolean") return { ok: false, error: "available is true or false." };
  const url = has("url") ? (typeof input.url === "string" ? input.url.trim() : "") || null : current?.url ?? null;
  if (url && (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 500)) return { ok: false, error: "The item's page is an https:// address." };
  const imageUrl = has("image_url") ? (typeof input.image_url === "string" ? input.image_url.trim() : "") || null : current?.imageUrl ?? null;
  if (imageUrl && (!/^https:\/\/[^\s]+$/i.test(imageUrl) || imageUrl.length > 500)) return { ok: false, error: "A picture's address is an https:// link." };
  const stockQuantity = has("stock") ? (input.stock === null || input.stock === "" ? null : Number(input.stock)) : current?.stockQuantity ?? null;
  if (stockQuantity !== null && (!Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1_000_000)) return { ok: false, error: "How many are left is a whole number (leave it empty to not count)." };
  return { ok: true, value: { section, name, description, priceMinor: price, priceMaxMinor: priceMax, currency, unit, status, sortOrder, available, url, imageUrl, stockQuantity } };
}

/** "KSh 3,500 per car", "KSh 1,000–1,500 per person", "Free". */
export function priceText(item: Pick<PriceItemValues, "priceMinor" | "priceMaxMinor" | "currency" | "unit">): string {
  if (item.priceMinor === 0 && item.priceMaxMinor === null) return item.unit ? `Free (${item.unit})` : "Free";
  const amount = item.priceMaxMinor !== null
    ? `${formatMoney(item.priceMinor, item.currency)}–${formatMoney(item.priceMaxMinor, item.currency).replace(/^(KSh |\$)/, "")}`
    : formatMoney(item.priceMinor, item.currency);
  return item.unit ? `${amount} ${item.unit}` : amount;
}

export const publicPriceItem = (item: PriceItem) => ({
  id: item.id,
  section: item.section,
  name: item.name,
  description: item.description,
  price: item.priceMinor / 100,
  price_max: item.priceMaxMinor === null ? null : item.priceMaxMinor / 100,
  currency: item.currency,
  unit: item.unit,
  status: item.status,
  sort_order: item.sortOrder,
  available: item.available,
  stock: item.stockQuantity,
  source: item.source,
  url: item.url,
  image_url: item.imageUrl,
  // The dashboard is on this service's own address: the uploaded photo by its path.
  picture_url: itemPictureUrl(item, ""),
  price_display: priceText(item),
  updated_at: item.updatedAt,
});

// ── Pasted lists ──────────────────────────────────────────────────────

const CURRENCY = String.raw`(?:ksh?s?\.?|kes|sh\.?|shs\.?|usd|us\$|\$)`;
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const AMOUNT = new RegExp(
  String.raw`(?:(${CURRENCY})\s*)?(${NUMBER})(?:\s*(?:-|–|—|to)\s*(?:${CURRENCY}\s*)?(${NUMBER}))?(\s*\/=)?|\b(free)\b`,
  "gi",
);

function currencyOf(prefix: string | undefined, fallback: BookingCurrency): BookingCurrency {
  if (!prefix) return fallback;
  return /usd|\$/i.test(prefix) ? "USD" : "KES";
}

function unitOf(text: string): string | null {
  const unit = text.replace(/^[\s,;:|.–—-]+|[\s,;:|.–—-]+$/g, "")
    .replace(/^\//, "per ")
    .replace(/^(pp|p\/p)$/i, "per person")
    .replace(/^pax$/i, "per person")
    .replace(/^each$/i, "each")
    .trim();
  return unit ? unit.slice(0, 40) : null;
}

export type ParsedPriceList = {
  items: Array<{ section: string | null; name: string; description: string | null; price: string; price_max: string | null; currency: BookingCurrency; unit: string | null }>;
  /** Lines that looked like neither an item nor a heading. */
  problems: Array<{ line: number; text: string; reason: string }>;
};

/**
 * Reads a price list as a business has it: an item per line with its price
 * ("Airport transfer — KSh 3,500 per car", "Laundry: 200 per item",
 * "Massage 60 min ..... 4,500", "Kids under 5: free"), and short lines with
 * no price as headings for the items after them. After the price, "| ..."
 * is the item's description ("Beef samosa: 575 | 4 pieces, spiced beef").
 * A size in brackets stays part of the name, so each is its own item:
 * "Absolut Vodka (750ml Bottle): 5000", "Absolut Vodka (Shot): 300".
 */
// Groups: 1 currency, 2 amount, 3 a range's highest amount, 4 "/=", 5 "free". A bare
// number under 10 ("5 people", "2 hours") isn't taken for a price.
const pricesIn = (text: string) => [...text.matchAll(AMOUNT)].filter((match) => match[5] || match[1] || match[3] || match[4] || /,/.test(match[2] ?? "") || Number(match[2]) >= 10);

export function parsePriceList(text: string, fallback: BookingCurrency = "KES"): ParsedPriceList {
  const result: ParsedPriceList = { items: [], problems: [] };
  let section: string | null = null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n").slice(0, MAX_PRICE_ITEMS * 2);
  lines.forEach((raw, index) => {
    const whole = raw.replace(/^[\s*•·–—-]+/, "").replace(/\s+/g, " ").trim();
    if (!whole) return;
    // The description starts at the first "|" that comes after a price ("Laundry | 200 | Washed and folded").
    let line = whole;
    let description: string | null = null;
    for (let at = whole.indexOf("|"); at !== -1; at = whole.indexOf("|", at + 1)) {
      if (!pricesIn(whole.slice(0, at)).length) continue;
      line = whole.slice(0, at).trim();
      description = whole.slice(at + 1).trim().slice(0, 500) || null;
      break;
    }
    const matches = pricesIn(line);
    const last = matches.at(-1);
    if (!last) {
      const heading = line.replace(/:$/, "").trim();
      if (heading.length <= 60 && !/[.!?]$/.test(heading) && !/:./.test(heading)) section = heading.slice(0, 80);
      else result.problems.push({ line: index + 1, text: line.slice(0, 200), reason: "No price found." });
      return;
    }
    const name = line.slice(0, last.index).replace(/[\s.:|,–—-]+$/g, "").replace(/\s*\.{2,}\s*/g, " ").trim();
    if (!name) {
      result.problems.push({ line: index + 1, text: line.slice(0, 200), reason: "No name before the price." });
      return;
    }
    const free = Boolean(last[5]);
    const price = free ? "0" : last[2].replace(/,/g, "");
    const priceMax = !free && last[3] ? last[3].replace(/,/g, "") : null;
    if (priceMax !== null && Number(priceMax) <= Number(price)) {
      result.problems.push({ line: index + 1, text: line.slice(0, 200), reason: "The range's second price isn't higher." });
      return;
    }
    result.items.push({
      section,
      name: name.slice(0, 120),
      description,
      price,
      price_max: priceMax,
      currency: currencyOf(last[1], fallback),
      unit: unitOf(line.slice((last.index ?? 0) + last[0].length)),
    });
  });
  return result;
}

// ── Storage ───────────────────────────────────────────────────────────

export async function listPriceItems(businessId: string, options: { activeOnly?: boolean } = {}): Promise<PriceItem[]> {
  return inBusiness((db) => db.select().from(priceItems)
    .where(options.activeOnly ? and(eq(priceItems.businessId, businessId), eq(priceItems.status, "active")) : eq(priceItems.businessId, businessId))
    // Each section together, where its first item is; then its items in order.
    .orderBy(
      sql`min(${priceItems.sortOrder}) over (partition by lower(btrim(coalesce(${priceItems.section}, ''))))`,
      sql`lower(btrim(coalesce(${priceItems.section}, '')))`,
      asc(priceItems.sortOrder),
      asc(priceItems.name),
    ), businessId);
}

export async function getPriceItem(businessId: string, id: string): Promise<PriceItem | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await inBusiness((db) => db.select().from(priceItems).where(and(eq(priceItems.businessId, businessId), eq(priceItems.id, id))).limit(1), businessId);
  return row;
}

const isNameTaken = (error: unknown) => {
  const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
  return database.code === "23505" && database.constraint === "price_items_name_idx";
};

export async function createPriceItem(businessId: string, value: PriceItemValues, userId: string | null): Promise<PriceItem | "name_taken" | "too_many"> {
  try {
    return await inBusiness(async (db) => {
      const section = (value.section ?? "").trim().toLowerCase();
      const [{ count, sectionEnd, listEnd }] = await db.select({
        count: sql<number>`count(*)::int`,
        sectionEnd: sql<number | null>`max(${priceItems.sortOrder}) filter (where lower(btrim(coalesce(${priceItems.section}, ''))) = ${section})`,
        listEnd: sql<number | null>`max(${priceItems.sortOrder})`,
      }).from(priceItems).where(eq(priceItems.businessId, businessId));
      if (count >= MAX_PRICE_ITEMS) return "too_many" as const;
      // With no place given, a new item goes at the end of its section (or a new section at the end of the menu), never to the top.
      const sortOrder = value.sortOrder || (sectionEnd ?? listEnd ?? 0) + 1;
      const [row] = await db.insert(priceItems).values({ businessId, ...value, sortOrder, updatedBy: userId }).returning();
      return row;
    }, businessId);
  } catch (error) {
    if (isNameTaken(error)) return "name_taken";
    throw error;
  }
}

export async function updatePriceItem(businessId: string, id: string, value: PriceItemValues, userId: string | null): Promise<PriceItem | "name_taken" | undefined> {
  try {
    const [row] = await inBusiness((db) => db.update(priceItems).set({ ...value, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(priceItems.businessId, businessId), eq(priceItems.id, id))).returning(), businessId);
    return row;
  } catch (error) {
    if (isNameTaken(error)) return "name_taken";
    throw error;
  }
}

/**
 * Puts the menu in the team's order: these items first, in this order (a
 * section shows where its first item is); any not named keep their order
 * after them.
 */
export async function orderPriceItems(businessId: string, ids: string[]): Promise<void> {
  await inBusiness(async (_db, client) => {
    await client.query(
      `update price_items p set sort_order = o.position * 10
         from unnest($2::uuid[]) with ordinality as o(id, position)
        where p.business_id = $1 and p.id = o.id`,
      [businessId, ids],
    );
    await client.query(
      `with rest as (
         select id, row_number() over (order by sort_order, lower(coalesce(section, '')), name) as n
           from price_items where business_id = $1 and not (id = any($2::uuid[])))
       update price_items p set sort_order = ($3 + rest.n) * 10 from rest where p.business_id = $1 and p.id = rest.id`,
      [businessId, ids, ids.length],
    );
  }, businessId);
}

export async function deletePriceItem(businessId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await inBusiness((db) => db.delete(priceItems).where(and(eq(priceItems.businessId, businessId), eq(priceItems.id, id))).returning({ id: priceItems.id }), businessId);
  return rows.length > 0;
}

/**
 * Adds many items at once (a pasted list), in one transaction: an item with
 * the same section and name as one already listed replaces its price. With
 * replace, the list becomes exactly these items.
 */
export async function importPriceItems(businessId: string, values: PriceItemValues[], options: { replace: boolean; userId: string | null }): Promise<{ added: number; updated: number; removed: number }> {
  return inBusiness(async (db, client) => {
    let removed = 0;
    // Replacing the list replaces what the team typed; items from the business's own feed stay.
    if (options.replace) removed = (await db.delete(priceItems).where(and(eq(priceItems.businessId, businessId), eq(priceItems.source, "manual"))).returning({ id: priceItems.id })).length;
    const { rows: [{ count, top }] } = await client.query<{ count: number; top: number }>("select count(*)::int as count, coalesce(max(sort_order), 0)::int as top from price_items");
    let added = 0;
    let updated = 0;
    for (const [index, value] of values.entries()) {
      const { rows } = await client.query<{ inserted: boolean }>(
        `insert into price_items (business_id, section, name, description, price_minor, price_max_minor, currency, unit, status, sort_order, updated_by, available, url)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (business_id, (lower(btrim(coalesce(section, '')))), (lower(btrim(name))))
         do update set price_minor = excluded.price_minor, price_max_minor = excluded.price_max_minor, currency = excluded.currency,
           unit = excluded.unit, description = coalesce(excluded.description, price_items.description), updated_by = excluded.updated_by, updated_at = now()
         returning (xmax = 0) as inserted`,
        [businessId, value.section, value.name, value.description, value.priceMinor, value.priceMaxMinor, value.currency, value.unit, value.status, value.sortOrder || top + 1 + index, options.userId, value.available, value.url],
      );
      if (rows[0]?.inserted) added += 1;
      else updated += 1;
    }
    if (count + added > MAX_PRICE_ITEMS) throw new PriceListFull();
    return { added, updated, removed };
  }, businessId);
}

/** An item from the business's own product feed (feed.ts). */
export type FeedItemValues = Omit<PriceItemValues, "status" | "sortOrder" | "stockQuantity"> & { externalId: string | null };

/**
 * The business's own feed, kept in step: each item is added or updated in
 * place (so its id stays the same while its name does), feed items no longer
 * in the feed go, and what the team typed is never touched. An item named
 * like one the team typed is skipped: theirs stands. A hidden item stays
 * hidden. At most MAX_PRICE_ITEMS in all.
 */
export async function syncFeedItems(businessId: string, values: FeedItemValues[]): Promise<{ items: number; skipped: number }> {
  return inBusiness(async (_db, client) => {
    const { rows: [{ count }] } = await client.query<{ count: number }>("select count(*)::int as count from price_items where source = 'manual'");
    const room = Math.max(0, MAX_PRICE_ITEMS - count);
    const kept: string[] = [];
    let skipped = Math.max(0, values.length - room);
    for (const [index, value] of values.slice(0, room).entries()) {
      const { rows } = await client.query<{ id: string }>(
        `insert into price_items (business_id, section, name, description, price_minor, price_max_minor, currency, unit, status, sort_order, available, source, external_id, url, image_url)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, 'feed', $11, $12, $13)
         on conflict (business_id, (lower(btrim(coalesce(section, '')))), (lower(btrim(name))))
         do update set description = excluded.description, price_minor = excluded.price_minor, price_max_minor = excluded.price_max_minor,
           currency = excluded.currency, unit = excluded.unit, sort_order = excluded.sort_order, available = excluded.available,
           external_id = excluded.external_id, url = excluded.url, image_url = excluded.image_url, updated_at = now()
         where price_items.source = 'feed'
         returning id`,
        [businessId, value.section, value.name, value.description, value.priceMinor, value.priceMaxMinor, value.currency, value.unit, 10_000 + index, value.available, value.externalId, value.url, value.imageUrl],
      );
      if (rows[0] && !kept.includes(rows[0].id)) kept.push(rows[0].id);
      else skipped += 1;
    }
    await client.query("delete from price_items where source = 'feed' and not (id = any($1::uuid[]))", [kept]);
    return { items: kept.length, skipped };
  }, businessId);
}

export class PriceListFull extends Error {
  constructor() {
    super(`A price list has at most ${MAX_PRICE_ITEMS} items.`);
  }
}

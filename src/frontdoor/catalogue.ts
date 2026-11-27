// src/frontdoor/catalogue.ts
//
// What a business offers, as its own page (/c/<business>) shows it: the
// price list's visible items and the bookable rooms, services and tables,
// read under the business's own row rules like everything else. Nothing here
// is new information: it's what Zaina already quotes from, laid out so a
// customer can browse it on their own, and ask her or order through her only
// if they want to.
//
// The tab is named for the business's industry (or, without one, its type):
// "Browse Menu" for a restaurant, bar or club, "Rooms & Rates" for a place to
// stay, "Services & Prices" for a salon or clinic, "Browse Catalogue" for
// anyone else. Sizes of one thing ("Absolut Vodka (750ml Bottle)", "Absolut
// Vodka (Shot)") show as one card with a price for each.

import { getBookingSettings } from "../booking/settings.ts";
import { listOfferings } from "../booking/offerings.ts";
import { formatMoney } from "../booking/money.ts";
import { capabilitiesOf } from "../capabilities/catalog.ts";
import type { Business, BusinessSettings } from "../db/schema.ts";
import { listPriceItems, priceText } from "../prices/price-list.ts";
import { sectionKey, sectionPictureUrls } from "../prices/section-images.ts";

/** A price as a number, for search engines (the page shows the words in price). */
export type DoorAmount = { value: number; max: number | null; currency: string };

export type DoorVariant = { label: string; price: string | null; inStock: boolean; amount?: DoorAmount | null };

export type DoorItem = {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  amount?: DoorAmount | null;
  /** A room, service or table booked through Zaina, not an item on the list. */
  booking?: boolean;
  section: string | null;
  /** Same-origin address of the item's uploaded photo, or null (feed pictures live elsewhere and aren't shown here). */
  picture: string | null;
  /** In stock, or for sizes, any size in stock. */
  inStock: boolean;
  /** Sizes of one thing, each with its own price; empty for a single item. */
  variants: DoorVariant[];
  /** What "Ask Zaina about this" sends. */
  tell: string;
  /** The optional button to order or book through Zaina, only where the business takes them online. */
  order: { verb: "order" | "book"; text: string } | null;
};

export type DoorCatalogue = {
  tab: string; search: string; items: DoorItem[]; sections: string[];
  /** What the business shows: a menu, rooms, services or a catalogue. */
  kind?: CatalogueKind;
  /** Each section's banner picture (same origin), where the business added one. */
  banners?: Record<string, string>;
};

export type CatalogueKind = "menu" | "stays" | "services" | "catalogue";
type Kind = CatalogueKind;

/** Which words the page uses: the industry the business chose, else its type. */
export function catalogueKind(businessType: Business["businessType"], industry: BusinessSettings["industry"] | null | undefined): Kind {
  if (industry === "restaurant") return "menu";
  if (industry === "stays") return "stays";
  if (industry === "salon" || industry === "clinic" || industry === "services") return "services";
  if (industry === "shop" || industry === "other") return "catalogue";
  if (businessType === "restaurant") return "menu";
  if (businessType === "guesthouse") return "stays";
  if (businessType === "salon") return "services";
  return "catalogue";
}

export const CATALOGUE_WORDS: Record<Kind, { tab: string; search: string }> = {
  menu: { tab: "Browse Menu", search: "Search the menu" },
  stays: { tab: "Rooms & Rates", search: "Search rooms and extras" },
  services: { tab: "Services & Prices", search: "Search services" },
  catalogue: { tab: "Browse Catalogue", search: "Search the catalogue" },
};

const OFFERING_SECTION = { room_type: "Rooms", service: "Services", table: "Tables" } as const;
const SIZE = /^(.+?)\s*\(([^()]{1,40})\)$/;
/** What a size looks like: "750ml Bottle", "Shot", "6 Pieces", "Large". */
const SIZE_WORDS = /\d+(\.\d+)?\s*(ml|cl|l|ltr|litres?|liters?|oz|g|kg|pcs?|pieces?)\b|\b(bottle|shot|glass|pint|jug|pitcher|carafe|can|tot|double|single|half|full|small|medium|large|regular|cup|portion)\b/i;

/**
 * Items of one section that differ only by a size in brackets become one
 * card: "Absolut Vodka" with "750ml Bottle", "1L Bottle" and "Shot", each at
 * its price. One with a single size ("Don Julio 1942 (750ml Bottle)") reads
 * the same way, its size on a line with the price; any other name in
 * brackets ("Airport transfer (Moi Airport)") stays as it is.
 */
export function groupVariants(items: DoorItem[]): DoorItem[] {
  const keyOf = (item: DoorItem) => {
    const size = SIZE.exec(item.name);
    return size && !item.variants.length ? `${(item.section ?? "").toLowerCase()}|${size[1].trim().toLowerCase()}` : null;
  };
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const groups = new Map<string, DoorItem>();
  const result: DoorItem[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || ((counts.get(key) ?? 0) < 2 && !SIZE_WORDS.test(SIZE.exec(item.name)![2]))) {
      result.push(item);
      continue;
    }
    const [, base, label] = SIZE.exec(item.name)!;
    const variant: DoorVariant = { label: label.trim(), price: item.price, inStock: item.inStock, ...(item.amount ? { amount: item.amount } : {}) };
    const group = groups.get(key);
    if (group) {
      group.variants.push(variant);
      group.inStock ||= item.inStock;
      group.description ??= item.description;
      group.picture ??= item.picture;
      group.order ??= item.order && { ...item.order, text: item.order.text.replace(item.name, group.name) };
      continue;
    }
    const name = base.trim();
    // The prices are the sizes' now.
    const { amount: _each, ...one } = item;
    const merged: DoorItem = {
      ...one, name, price: null, variants: [variant], tell: `Tell me about ${name}`,
      order: item.order && { ...item.order, text: item.order.text.replace(item.name, name) },
    };
    groups.set(key, merged);
    result.push(merged);
  }
  return result;
}

/**
 * The same, kept for a few seconds per business: a room full of guests scanning at once is one read of
 * the menu, not eighty. A change the team makes shows within that time.
 */
const CACHE_MS = 10_000;
const cache = new Map<string, { until: number; value: Promise<DoorCatalogue | null> }>();
export function cachedDoorCatalogue(business: Business, settings: BusinessSettings | null): Promise<DoorCatalogue | null> {
  const key = `${business.id}|${business.businessType}|${settings?.industry ?? ""}|${JSON.stringify(settings?.capabilities ?? null)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.value;
  const value = doorCatalogue(business, settings);
  cache.set(key, { until: now + CACHE_MS, value });
  value.catch(() => cache.delete(key));
  if (cache.size > 2000) for (const [stale, entry] of cache) if (entry.until <= now) cache.delete(stale);
  return value;
}

/** Drops a business's kept catalogue: its team just changed something, and its page shows it at once. */
export function forgetDoorCatalogue(businessId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${businessId}|`)) cache.delete(key);
}

/** The page's catalogue, or null when the business shows nothing (the page stays chat only). */
export async function doorCatalogue(business: Business, settings: BusinessSettings | null): Promise<DoorCatalogue | null> {
  if (business.businessType === "custom") return null;
  const kind = catalogueKind(business.businessType, settings?.industry);
  const takesOrders = capabilitiesOf(business, settings).includes("orders");
  const [priceItems, offerings, booking, pictures] = await Promise.all([
    listPriceItems(business.id, { activeOnly: true }),
    listOfferings(business.id, { activeOnly: true }),
    getBookingSettings(business.id),
    sectionPictureUrls(business.id),
  ]);

  const fromList: DoorItem[] = priceItems.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description?.trim() || null,
    price: priceText(item),
    amount: { value: item.priceMinor / 100, max: item.priceMaxMinor === null ? null : item.priceMaxMinor / 100, currency: item.currency },
    section: item.section?.trim() || null,
    picture: item.imageVersion ? `/catalogue/${encodeURIComponent(business.id)}/${item.id}?v=${encodeURIComponent(item.imageVersion)}` : null,
    inStock: item.available && (item.stockQuantity === null || item.stockQuantity > 0),
    variants: [],
    tell: `Tell me about ${item.name}`,
    order: takesOrders ? { verb: "order", text: `I'd like to order ${item.name}` } : null,
  }));

  const fromBookings: DoorItem[] = offerings.map((offering) => {
    const rules = (offering.pricing ?? {}) as Record<string, unknown>;
    const amount = (value: unknown) => (typeof value === "number" && value > 0 ? formatMoney(value, booking.currency) : null);
    const price = offering.kind === "room_type"
      ? (amount(rules.nightly) ? `From ${amount(rules.nightly)} a night` : null)
      : amount(rules.price) ?? (amount(rules.per_person) ? `${amount(rules.per_person)} per person` : null);
    const minor = (offering.kind === "room_type" ? [rules.nightly] : [rules.price, rules.per_person]).find((value): value is number => typeof value === "number" && value > 0);
    return {
      id: offering.id,
      name: offering.name,
      description: offering.description?.trim() || null,
      price,
      amount: minor === undefined ? null : { value: minor / 100, max: null, currency: booking.currency },
      booking: true,
      section: OFFERING_SECTION[offering.kind] ?? null,
      picture: null,
      inStock: true,
      variants: [],
      tell: `Tell me about ${offering.name}`,
      order: { verb: "book", text: `I'd like to book ${offering.name}` },
    };
  });

  // What the business is mostly about comes first: rooms and services for those who book, the list for the rest.
  const books = kind === "stays" || kind === "services";
  const items = groupVariants(books ? [...fromBookings, ...fromList] : [...fromList, ...fromBookings]);
  if (!items.length) return null;
  const sections: string[] = [];
  for (const item of items) if (item.section && !sections.includes(item.section)) sections.push(item.section);
  const banners = Object.fromEntries(sections.flatMap((name) => (pictures.has(sectionKey(name)) ? [[name, pictures.get(sectionKey(name))!]] : [])));
  return { ...CATALOGUE_WORDS[kind], kind, items, sections, banners };
}

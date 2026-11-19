// src/frontdoor/catalogue.ts
//
// What a business offers, as its own page (/c/<business>) shows it: the
// price list's visible items and the bookable rooms, services and tables,
// read under the business's own row rules like everything else. Nothing here
// is new information: it's what Zaina already quotes from, laid out so a
// customer can browse it and tap to order or book through her.
//
// The words follow the business's industry (or, without one, its type): a
// restaurant's page says "Browse Menu" and "Order / Ask", a place to stay
// "Rooms & Rates" and "Check Dates / Book", a salon or clinic "Services &
// Prices" and "Book / Ask", anyone else "Browse Catalogue" and "Order / Ask".

import { getBookingSettings } from "../booking/settings.ts";
import { listOfferings } from "../booking/offerings.ts";
import { formatMoney } from "../booking/money.ts";
import type { Business, BusinessSettings } from "../db/schema.ts";
import { listPriceItems, priceText } from "../prices/price-list.ts";

export type DoorItem = {
  id: string;
  name: string;
  description: string | null;
  price: string | null;
  section: string | null;
  /** Same-origin address of the item's uploaded photo, or null (feed pictures live elsewhere and aren't shown here). */
  picture: string | null;
  inStock: boolean;
  /** The button's words, and what tapping it says to Zaina. */
  button: string;
  ask: string;
};

export type DoorCatalogue = { tab: string; button: string; search: string; items: DoorItem[]; sections: string[] };

type Kind = "menu" | "stays" | "services" | "catalogue";

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

export const CATALOGUE_WORDS: Record<Kind, { tab: string; button: string; search: string }> = {
  menu: { tab: "Browse Menu", button: "Order / Ask", search: "Search the menu" },
  stays: { tab: "Rooms & Rates", button: "Check Dates / Book", search: "Search rooms and extras" },
  services: { tab: "Services & Prices", button: "Book / Ask", search: "Search services" },
  catalogue: { tab: "Browse Catalogue", button: "Order / Ask", search: "Search the catalogue" },
};

const ROOM_SECTION = "Rooms";
const OFFERING_SECTION = { room_type: ROOM_SECTION, service: "Services", table: "Tables" } as const;

/** The page's catalogue, or null when the business shows nothing (the page stays chat only). */
export async function doorCatalogue(business: Business, settings: BusinessSettings | null): Promise<DoorCatalogue | null> {
  if (business.businessType === "custom") return null;
  const kind = catalogueKind(business.businessType, settings?.industry);
  const words = CATALOGUE_WORDS[kind];
  const books = kind === "stays" || kind === "services";
  const [priceItems, offerings, booking] = await Promise.all([
    listPriceItems(business.id, { activeOnly: true }),
    listOfferings(business.id, { activeOnly: true }),
    getBookingSettings(business.id),
  ]);

  const fromList: DoorItem[] = priceItems.map((item) => {
    const verb = books ? "book" : "order";
    return {
      id: item.id,
      name: item.name,
      description: item.description?.trim() || null,
      price: priceText(item),
      section: item.section?.trim() || null,
      picture: item.imageVersion ? `/catalogue/${encodeURIComponent(business.id)}/${item.id}?v=${encodeURIComponent(item.imageVersion)}` : null,
      inStock: item.available && (item.stockQuantity === null || item.stockQuantity > 0),
      button: kind === "stays" ? CATALOGUE_WORDS.services.button : words.button,
      ask: `I'd like to ${verb} ${item.name}`,
    };
  });

  const fromBookings: DoorItem[] = offerings.map((offering) => {
    const rules = (offering.pricing ?? {}) as Record<string, unknown>;
    const amount = (value: unknown) => (typeof value === "number" && value > 0 ? formatMoney(value, booking.currency) : null);
    const price = offering.kind === "room_type"
      ? (amount(rules.nightly) ? `From ${amount(rules.nightly)} a night` : null)
      : amount(rules.price) ?? (amount(rules.per_person) ? `${amount(rules.per_person)} per person` : null);
    return {
      id: offering.id,
      name: offering.name,
      description: offering.description?.trim() || null,
      price,
      section: OFFERING_SECTION[offering.kind] ?? null,
      picture: null,
      inStock: true,
      button: offering.kind === "room_type" ? CATALOGUE_WORDS.stays.button : CATALOGUE_WORDS.services.button,
      ask: `I'd like to book ${offering.name}`,
    };
  });

  // What the business is mostly about comes first: rooms and services for those who book, the list for the rest.
  const items = books ? [...fromBookings, ...fromList] : [...fromList, ...fromBookings];
  if (!items.length) return null;
  const sections: string[] = [];
  for (const item of items) if (item.section && !sections.includes(item.section)) sections.push(item.section);
  return { ...words, items, sections };
}

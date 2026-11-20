// src/businesses/registry.ts
//
// The business directory: businesses on the platform, looked up by id or by
// the public key their website widget sends. Readable by the app role (a
// widget's key must be looked up before any business is in scope); only the
// platform creates businesses. Cached briefly: settings change rarely, and
// every chat message needs them.

import { businessOrigin, canBeSubdomain } from "../frontdoor/subdomains.ts";
import { eq } from "drizzle-orm";
import { appDb } from "../db/platform-db.ts";
import { businesses, type Business } from "../db/schema.ts";

const CACHE_MS = Number(process.env.BUSINESS_CACHE_MS ?? "") || 30_000;
let cache: { at: number; list: Business[] } | null = null;
let extraOrigins: string[] = [];

/** Extra origins allowed for every business (local development and staging only). */
export function setExtraAllowedOrigins(origins: string[]) {
  extraOrigins = origins.map((origin) => origin.trim()).filter(Boolean);
}

let ownSite: { businessId: string; origins: string[] } | null = null;

/**
 * The service's own address, allowed for the one business whose chat is on
 * the service's own pages (the studio's Zaina on the home page): so that chat
 * also works on a staging address, without opening every business to it.
 */
export function setOwnSiteOrigins(businessId: string, origins: Array<string | null>) {
  ownSite = { businessId, origins: origins.filter((origin): origin is string => Boolean(origin)) };
}

async function all(): Promise<Business[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;
  const list = await appDb().select().from(businesses);
  cache = { at: Date.now(), list };
  return list;
}

export function clearBusinessCache() {
  cache = null;
}

/** Every live business (for jobs that answer customers, business by business). */
export async function allBusinesses(): Promise<Business[]> {
  return (await all()).filter((business) => business.status === "active");
}

/**
 * Every business, live or not: one setting up (onboarding) or paused still
 * has bookings to expire, payments to settle, calendars and conversations to
 * keep, and a team that signs in.
 */
export async function everyBusiness(): Promise<Business[]> {
  return all();
}

/** A live business: what customers reach (the website chat, WhatsApp). */
export async function businessById(id: string): Promise<Business | undefined> {
  return (await all()).find((business) => business.id === id && business.status === "active");
}

/** A business in any state: for its team, and for payments and calendars already under way. */
export async function anyBusinessById(id: string): Promise<Business | undefined> {
  return (await all()).find((business) => business.id === id);
}

export async function businessByPublicKey(publicKey: string): Promise<Business | undefined> {
  return (await all()).find((business) => business.publicKey === publicKey && business.status === "active");
}

let frontDoor: string[] = [];

/**
 * The service's own address, where every business has a page of its own
 * (/c/<business>, behind its QR code). Only this service's pages are served
 * there, and the only one that opens a business's chat is that business's.
 */
export function setFrontDoorOrigins(origins: Array<string | null>) {
  frontDoor = origins.filter((origin): origin is string => Boolean(origin));
}

/** The main address, for each business's own (clubxo.bilamatata.com, src/frontdoor/subdomains.ts). */
let ownAddressBase: string | null = null;
export function setBusinessAddressBase(publicBaseUrl: string | null) {
  ownAddressBase = publicBaseUrl;
}

export function allowedOriginsFor(business: Business): string[] {
  // A business's own address opens its chat, and only its chat.
  const own = ownAddressBase && canBeSubdomain(business.id) ? [businessOrigin(ownAddressBase, business.id)] : [];
  return [...business.allowedOrigins, ...extraOrigins, ...frontDoor, ...own, ...(ownSite?.businessId === business.id ? ownSite.origins : [])];
}

/** Every origin any active business allows (answers browsers' CORS preflight). */
export async function anyAllowedOrigins(): Promise<string[]> {
  return [...(await all()).filter((business) => business.status === "active").flatMap((business) => business.allowedOrigins), ...extraOrigins, ...(ownSite?.origins ?? [])];
}

export async function reloadBusiness(id: string): Promise<Business | undefined> {
  clearBusinessCache();
  const [row] = await appDb().select().from(businesses).where(eq(businesses.id, id)).limit(1);
  return row;
}

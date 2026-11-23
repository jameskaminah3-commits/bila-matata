// src/businesses/settings.ts
//
// How a business presents itself and what Zaina may pass on for it: its
// name, the assistant's name, how customers reach it, and which links and
// phone numbers can appear in replies. Kept inside the business (row-level
// security) and cached briefly.

import { eq } from "drizzle-orm";
import { businessSettings, cardDesigns, qrDestinations, type BusinessSettings, type CardDesign, type CardDetails, type QrDestination } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";

const CACHE_MS = Number(process.env.BUSINESS_CACHE_MS ?? "") || 30_000;
const cache = new Map<string, { at: number; settings: BusinessSettings | null }>();

export async function getBusinessSettings(businessId: string): Promise<BusinessSettings | null> {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;
  const [row] = await inBusiness((db) => db.select().from(businessSettings).where(eq(businessSettings.businessId, businessId)).limit(1), businessId);
  cache.set(businessId, { at: Date.now(), settings: row ?? null });
  return row ?? null;
}

export type SettingsPatch = Partial<Pick<BusinessSettings,
  | "displayName" | "assistantName" | "about" | "contactPhone" | "contactPhoneDisplay" | "websiteUrl" | "supportEmail"
  | "allowedLinkHosts" | "allowedLinkHostSuffixes" | "defaultCurrency" | "widgetColor" | "widgetPosition" | "widgetGreeting" | "widgetWhatsapp" | "personaRole" | "brandTagline" | "menuStyle" | "logoHasName" | "titleFont" | "chatAvatar" | "frontDoor" | "qrDestination" | "cardDetails" | "industry" | "interview" | "websiteSync" | "capabilities" | "widgetSeen" | "catalogueFeed" | "orderSettings" | "customerRecognition" | "outreach">>;

const TEXT_FIELDS = ["displayName", "assistantName", "about", "contactPhone", "contactPhoneDisplay", "websiteUrl", "supportEmail"] as const;
const HOST_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/;

/** Checks a patch sent by staff; returns the clean patch or the first problem. */
export function validateSettingsPatch(input: Record<string, unknown>): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  const patch: SettingsPatch = {};
  for (const field of TEXT_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value === null && field !== "displayName" && field !== "assistantName" && field !== "about") {
      (patch as Record<string, unknown>)[field] = null;
      continue;
    }
    if (typeof value !== "string" || value.length > (field === "about" ? 4000 : 200)) return { ok: false, error: `${field} must be text` };
    if ((field === "displayName" || field === "assistantName") && !value.trim()) return { ok: false, error: `${field} can't be empty` };
    (patch as Record<string, unknown>)[field] = value.trim();
  }
  if (typeof patch.contactPhone === "string" && !/^\+\d{7,15}$/.test(patch.contactPhone)) {
    return { ok: false, error: "contactPhone must be in international form, e.g. +254718475264" };
  }
  if (typeof patch.websiteUrl === "string" && !/^https:\/\/[^\s/]+/.test(patch.websiteUrl)) {
    return { ok: false, error: "websiteUrl must start with https://" };
  }
  if (typeof patch.supportEmail === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(patch.supportEmail)) {
    return { ok: false, error: "supportEmail must be an email address" };
  }
  for (const field of ["allowedLinkHosts", "allowedLinkHostSuffixes"] as const) {
    if (!(field in input)) continue;
    const value = input[field];
    if (!Array.isArray(value) || value.length > 50 || !value.every((host) => typeof host === "string")) {
      return { ok: false, error: `${field} must be a list of host names` };
    }
    const hosts = value.map((host) => (host as string).trim().toLowerCase());
    const valid = field === "allowedLinkHosts"
      ? hosts.every((host) => HOST_PATTERN.test(host))
      : hosts.every((host) => host.startsWith(".") && HOST_PATTERN.test(host.slice(1)));
    if (!valid) return { ok: false, error: `${field} has an entry that isn't a host name` };
    patch[field] = hosts;
  }
  if ("defaultCurrency" in input) {
    if (input.defaultCurrency !== "USD" && input.defaultCurrency !== "KES") return { ok: false, error: "defaultCurrency must be USD or KES" };
    patch.defaultCurrency = input.defaultCurrency;
  }
  // The website widget's look and first words.
  if ("widgetColor" in input) {
    if (typeof input.widgetColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(input.widgetColor)) return { ok: false, error: "widgetColor is a colour like #0f766e" };
    patch.widgetColor = input.widgetColor.toLowerCase();
  }
  if ("widgetPosition" in input) {
    if (input.widgetPosition !== "right" && input.widgetPosition !== "left") return { ok: false, error: "widgetPosition is right or left" };
    patch.widgetPosition = input.widgetPosition;
  }
  if ("widgetGreeting" in input) {
    const greeting = input.widgetGreeting;
    if (greeting === null || greeting === "") patch.widgetGreeting = null;
    else if (typeof greeting !== "string" || greeting.length > 300) return { ok: false, error: "widgetGreeting is up to 300 characters" };
    else patch.widgetGreeting = greeting.trim();
  }
  if ("personaRole" in input) {
    const role = input.personaRole;
    if (role === null || role === "") patch.personaRole = null;
    else if (typeof role !== "string" || role.trim().length < 2 || role.trim().length > 60) return { ok: false, error: "personaRole is 2 to 60 characters, like guest experience host" };
    else patch.personaRole = role.trim().replace(/\s+/g, " ");
  }
  // The business's brand wherever Zaina speaks for it, and its own page on this service.
  if ("brandTagline" in input) {
    const tagline = input.brandTagline;
    if (tagline === null || tagline === "") patch.brandTagline = null;
    else if (typeof tagline !== "string" || tagline.trim().length < 2 || tagline.trim().length > 120) return { ok: false, error: "brandTagline is 2 to 120 characters" };
    else patch.brandTagline = tagline.trim().replace(/\s+/g, " ");
  }
  if ("titleFont" in input) {
    if (!["classic", "roman", "elegant", "modern"].includes(input.titleFont as string)) return { ok: false, error: "titleFont is classic, roman, elegant or modern" };
    patch.titleFont = input.titleFont as "classic" | "roman" | "elegant" | "modern";
  }
  if ("logoHasName" in input) {
    if (typeof input.logoHasName !== "boolean") return { ok: false, error: "logoHasName is true or false" };
    patch.logoHasName = input.logoHasName;
  }
  if ("menuStyle" in input) {
    if (!["auto", "light", "dark", "backdrop"].includes(input.menuStyle as string)) return { ok: false, error: "menuStyle is auto, light, dark or backdrop" };
    patch.menuStyle = input.menuStyle as "auto" | "light" | "dark" | "backdrop";
  }
  if ("chatAvatar" in input) {
    if (input.chatAvatar !== "zaina" && input.chatAvatar !== "logo") return { ok: false, error: "chatAvatar is zaina or logo" };
    patch.chatAvatar = input.chatAvatar;
  }
  if ("frontDoor" in input) {
    if (typeof input.frontDoor !== "boolean") return { ok: false, error: "frontDoor is true or false" };
    patch.frontDoor = input.frontDoor;
  }
  if ("qrDestination" in input) {
    if (!qrDestinations.includes(input.qrDestination as QrDestination)) return { ok: false, error: "qrDestination is page, website or whatsapp" };
    patch.qrDestination = input.qrDestination as QrDestination;
  }
  if ("cardDetails" in input) {
    const card = checkCardDetails(input.cardDetails);
    if (!card.ok) return card;
    patch.cardDetails = card.value;
  }
  if ("widgetWhatsapp" in input) {
    if (typeof input.widgetWhatsapp !== "boolean") return { ok: false, error: "widgetWhatsapp is true or false" };
    patch.widgetWhatsapp = input.widgetWhatsapp;
  }
  return { ok: true, patch };
}

const CARD_LIMITS = { personName: 60, personTitle: 60, phone: 40, email: 120, website: 120, address: 120 } as const;

/** What a business card says: short single lines, each optional; a design from the list. */
export function checkCardDetails(input: unknown): { ok: true; value: CardDetails | null } | { ok: false; error: string } {
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "cardDetails is an object" };
  const body = input as Record<string, unknown>;
  const design = body.design ?? "signature";
  if (!cardDesigns.includes(design as CardDesign)) return { ok: false, error: "cardDetails.design is signature, minimal or bold" };
  const value: CardDetails = { design: design as CardDesign, personName: null, personTitle: null, phone: null, email: null, website: null, address: null };
  for (const [field, limit] of Object.entries(CARD_LIMITS) as Array<[keyof typeof CARD_LIMITS, number]>) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string") return { ok: false, error: `cardDetails.${field} is text` };
    const clean = raw.replace(/\s+/g, " ").trim();
    if (clean.length > limit) return { ok: false, error: `cardDetails.${field} is up to ${limit} characters` };
    value[field] = clean || null;
  }
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.email)) return { ok: false, error: "cardDetails.email must be an email address" };
  return { ok: true, value };
}

export async function updateBusinessSettings(businessId: string, patch: SettingsPatch, updatedBy: string | null): Promise<BusinessSettings> {
  const [row] = await inBusiness((db) => db
    .update(businessSettings)
    .set({ ...patch, updatedBy, updatedAt: new Date() })
    .where(eq(businessSettings.businessId, businessId))
    .returning(), businessId);
  cache.delete(businessId);
  if (!row) throw new Error(`No settings for business ${businessId}`);
  return row;
}

export async function createBusinessSettings(businessId: string, displayName: string): Promise<void> {
  await inBusiness((db) => db.insert(businessSettings).values({ businessId, displayName }).onConflictDoNothing(), businessId);
  cache.delete(businessId);
}

/** The reply rules the business's settings give: which links and numbers Zaina may pass on. */
export function replyRulesFor(settings: BusinessSettings | null): { allowedHosts: string[]; allowedHostSuffixes: string[]; officialPhones: string[] } {
  const siteHost = (() => {
    try {
      return settings?.websiteUrl ? new URL(settings.websiteUrl).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();
  return {
    allowedHosts: [...new Set([...(settings?.allowedLinkHosts ?? []), ...(siteHost ? [siteHost] : [])])],
    allowedHostSuffixes: settings?.allowedLinkHostSuffixes ?? [],
    officialPhones: settings?.contactPhone ? [settings.contactPhone] : [],
  };
}

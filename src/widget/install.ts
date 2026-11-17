// src/widget/install.ts
//
// Putting the chat on a business's own website, and knowing it's there:
//
//   sightings   where the chat last opened (an allowed website), and the
//               websites it was refused on because they aren't on the
//               business's list yet. Written at most once every ten minutes
//               per business, website and outcome, and at most five refused
//               websites are kept: addresses only, never anything about visitors.
//   variants    a website and its www twin (https://example.co.ke and
//               https://www.example.co.ke), which visitors use interchangeably.
//   inspect     what a page shows: the chat's code for this business, for
//               another, or none (and whether a tag manager may be adding it).

import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import type { WidgetSeen } from "../db/schema.ts";
import { normalizeOrigin } from "../gateway/origin.ts";

const MAX_REFUSED = 5;
const QUIET_MS = 10 * 60 * 1000;
const lastWritten = new Map<string, number>();

/** The chat was asked for from a website: remembered for the business's dashboard. Never throws. */
export async function noteWidgetSighting(businessId: string, origin: string | undefined, allowed: boolean, now = new Date()): Promise<void> {
  const normalized = origin ? normalizeOrigin(origin) : null;
  if (!normalized) return;
  const key = `${businessId} ${normalized} ${allowed}`;
  if (now.getTime() - (lastWritten.get(key) ?? 0) < QUIET_MS) return;
  if (lastWritten.size > 5000) lastWritten.clear();
  lastWritten.set(key, now.getTime());
  try {
    const seen: WidgetSeen = (await getBusinessSettings(businessId))?.widgetSeen ?? {};
    const at = now.toISOString();
    const next: WidgetSeen = allowed
      ? { ...seen, loaded: { origin: normalized, at }, refused: (seen.refused ?? []).filter((entry) => entry.origin !== normalized) }
      : { ...seen, refused: [{ origin: normalized, at }, ...(seen.refused ?? []).filter((entry) => entry.origin !== normalized)].slice(0, MAX_REFUSED) };
    await updateBusinessSettings(businessId, { widgetSeen: next }, null);
  } catch {
    // Only a note for the dashboard: the chat never waits on it.
  }
}

/** A website's address and its www twin, both https. Null when it isn't a website address. */
export function originVariants(input: string): string[] | null {
  const text = input.trim();
  const origin = normalizeOrigin(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  if (!origin) return null;
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.port || !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname)) return null;
  const host = url.hostname;
  const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return [`https://${host}`, ...(twin.includes(".") ? [`https://${twin}`] : [])];
}

export type Installed = "yes" | "other_business" | "no";

/** Whether a page carries the chat's code for this business (zaina.js with its id, or the older widget.js with its key). */
export function inspectPage(html: string, business: { id: string; publicKey: string }): { installed: Installed; tagManager: boolean } {
  let installed: Installed = "no";
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    if (!/\/(zaina|widget)\.js(?:[?#]|$)/i.test(src)) continue;
    const id = /\bdata-business\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    const key = /\bdata-key\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (id === business.id || key === business.publicKey) return { installed: "yes", tagManager: false };
    if (id || key) installed = "other_business";
  }
  return { installed, tagManager: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/.test(html) };
}

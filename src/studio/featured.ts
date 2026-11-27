// src/studio/featured.ts
//
// "Businesses powered by Zaina" on bilamatata.com: only the businesses the
// studio has turned on in /admin (featured_on_studio), only while they are
// live and on a plan with Zaina, never the studio itself. Each shows its
// public face and nothing else: its name, logo, line and the link to its own
// page. With none turned on the row doesn't show at all.

import { eq } from "drizzle-orm";
import { brandAssetsOf, brandAssetUrl } from "../brand/assets.ts";
import { clearBusinessCache, everyBusiness } from "../businesses/registry.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { ownerDb } from "../db/platform-db.ts";
import { businesses, chatsOnTier } from "../db/schema.ts";
import { doorUrl } from "../frontdoor/routes.ts";
import { STUDIO } from "./brand.ts";

export type FeaturedBusiness = { id: string; name: string; tagline: string | null; logoUrl: string | null; url: string };

/** Turns a business's place on the site on or off (the studio's admins only). */
export async function setFeaturedOnStudio(businessId: string, featured: boolean): Promise<void> {
  await ownerDb().update(businesses).set({ featuredOnStudio: featured, updatedAt: new Date() }).where(eq(businesses.id, businessId));
  clearBusinessCache();
  forgetFeatured();
}

const MAX_SHOWN = 12;
let kept: { until: number; value: Promise<FeaturedBusiness[]> } | null = null;
export const forgetFeatured = () => { kept = null; };

/** The businesses the home page shows, kept a minute (the home page is busy; a change shows within that time). */
export function featuredBusinesses(baseUrl: string): Promise<FeaturedBusiness[]> {
  const now = Date.now();
  if (kept && kept.until > now) return kept.value;
  const value = loadFeatured(baseUrl).catch(() => []);
  kept = { until: now + 60_000, value };
  return value;
}

async function loadFeatured(baseUrl: string): Promise<FeaturedBusiness[]> {
  const shown = (await everyBusiness())
    .filter((business) => business.featuredOnStudio && business.status === "active" && chatsOnTier(business.tier) && business.id !== STUDIO.businessId)
    .slice(0, MAX_SHOWN);
  return Promise.all(shown.map(async (business) => {
    const [settings, assets] = await Promise.all([getBusinessSettings(business.id), brandAssetsOf(business.id)]);
    return {
      id: business.id,
      name: settings?.displayName ?? business.name,
      tagline: settings?.brandTagline ?? null,
      logoUrl: brandAssetUrl(baseUrl, business.id, assets.logo),
      url: doorUrl(baseUrl, business.id),
    };
  }));
}

// src/widget/routes.ts
//
// Putting the chat on the business's own website (Settings → Website widget):
//
//   GET  /v1/staff/businesses/:id/widget/install   viewer   its website, the websites allowed, and where the
//                                                           chat last opened or was refused (install.ts)
//   POST /v1/staff/businesses/:id/widget/allow     owner    { url } the website and its www twin may use the chat
//   POST /v1/staff/businesses/:id/widget/check     manager  { url? } reads the page and says whether the chat's
//                                                           code is on it, and whether that website is allowed

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { clearBusinessCache, reloadBusiness } from "../businesses/registry.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import { updateBusinessDirectory } from "../db/platform-scope.ts";
import type { Business } from "../db/schema.ts";
import { isOriginAllowed } from "../gateway/origin.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { fetchPublic, PublicFetchError } from "../net/public-fetch.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { inspectPage, originVariants } from "./install.ts";

const MAX_ORIGINS = 20;

async function installView(business: Business) {
  const settings = await getBusinessSettings(business.id);
  const website = settings?.websiteUrl ?? settings?.websiteSync?.url ?? business.allowedOrigins[0] ?? null;
  return {
    website,
    allowed_origins: business.allowedOrigins,
    loaded: settings?.widgetSeen?.loaded ?? null,
    refused: (settings?.widgetSeen?.refused ?? []).filter((entry) => !isOriginAllowed(entry.origin, business.allowedOrigins)),
  };
}

/** The website and its www twin added to the websites that may use the chat; the first becomes the business's website if it has none. */
export async function allowWebsite(business: Business, url: string, userId: string | null): Promise<{ added: string[]; business: Business } | { error: string }> {
  const variants = originVariants(url);
  if (!variants) return { error: "That isn't a website address. It looks like https://www.yourbusiness.co.ke." };
  const added = variants.filter((origin) => !business.allowedOrigins.includes(origin));
  if (business.allowedOrigins.length + added.length > MAX_ORIGINS) return { error: `At most ${MAX_ORIGINS} websites may use the chat. Remove one under "Websites that may use the chat" first.` };
  if (added.length) {
    await updateBusinessDirectory(business.id, { allowedOrigins: [...business.allowedOrigins, ...added] });
    clearBusinessCache();
  }
  const settings = await getBusinessSettings(business.id);
  if (settings && !settings.websiteUrl) await updateBusinessSettings(business.id, { websiteUrl: variants[0] }, userId);
  return { added, business: (await reloadBusiness(business.id)) ?? business };
}

export function registerWidgetInstallRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId/widget";

  app.get(`${base}/install`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await installView(staffOf(req).business!));
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/allow`, staff, requireBusinessRole("owner"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      const result = await allowWebsite(business!, String(req.body?.url ?? ""), user.id);
      if ("error" in result) return res.status(400).json({ error: "invalid_website", message: result.error });
      res.json({ added: result.added, ...(await installView(result.business)) });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/check`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = staffOf(req).business!;
      const view = await installView(business);
      const address = typeof req.body?.url === "string" && req.body.url.trim() ? req.body.url.trim() : view.website;
      if (!address) return res.status(400).json({ error: "url_required", message: "Your website's address, please." });
      const verdict = await consumeLimits([{ key: `widget-check:business:${business.id}`, limit: 30, windowSeconds: 3600 }]);
      if (!verdict.allowed) {
        res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
        return res.status(429).json({ error: "rate_limited", message: "Checked many times this hour. Please try again later." });
      }
      let page;
      try {
        page = await fetchPublic(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`, { accept: "text/html", maxBytes: 3 * 1024 * 1024, timeoutMs: 10_000 });
      } catch (error) {
        if (error instanceof PublicFetchError) return res.status(400).json({ error: "website_unreadable", message: `Your website couldn't be opened: ${error.message}` });
        throw error;
      }
      if (page.status !== 200) return res.status(400).json({ error: "website_unreadable", message: `Your website answered ${page.status}.` });
      const origin = page.url.origin;
      const found = inspectPage(page.body.toString("utf8"), business);
      res.json({
        ...view,
        checked: page.url.toString(),
        origin,
        allowed: isOriginAllowed(origin, business.allowedOrigins),
        installed: found.installed,
        tag_manager: found.tagManager,
      });
    } catch (error) {
      next(error);
    }
  });
}

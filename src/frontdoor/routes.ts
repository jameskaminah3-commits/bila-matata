// src/frontdoor/routes.ts
//
// A business's front door on this service, and its brand:
//
//   GET  /c/:business                 its own page: name, logo, colours, and Zaina ready to talk
//   GET  /c/:business/brand.css       its colours (the page allows no inline style)
//   GET  /c/:business/qr.svg          the QR code that opens the page (counted as a scan)
//   GET  /c-assets/door.css           the page's look
//   GET  /brand/:business/:kind       its logo or cover picture (kind: logo | cover)
//
//   Its team, from the dashboard (/v1/staff/businesses/:businessId/…):
//   GET    front-door                 viewer   the address, the QR code, whether it's open, and how many came through it
//   GET    brand                      viewer   its pictures' addresses and size limits
//   PUT    brand/:kind                manager  a new logo or cover (the picture itself as the request body)
//   DELETE brand/:kind                manager  remove it
//
// The welcome line, the chat's picture (Zaina's face or the logo) and whether
// the page is open are settings (PATCH settings: brandTagline, chatAvatar,
// frontDoor).

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { BRAND_MAX_BYTES, brandAssetUrl, brandAssetsOf, checkBrandImage, isBrandKind, readBrandAsset, removeBrandAsset, saveBrandAsset } from "../brand/assets.ts";
import { anyBusinessById, businessById } from "../businesses/registry.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { getNumber } from "../channels/whatsapp/numbers.ts";
import { personaRole } from "../engine/persona.ts";
import { whatsappLink } from "../gateway/routes.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { brandCss, DOOR_CSS, renderDoorClosed, renderFrontDoor } from "./page.ts";
import { qrSvg } from "./qr.ts";
import { doorSource, doorStats, looksLikePerson, recordDoorVisit } from "./stats.ts";

const BUSINESS_ID = /^[a-z][a-z0-9-]{1,39}$/;

/** The page runs only the service's own script and styles, and shows only its own pictures. */
const DOOR_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

/** The address of a business's page, and the one its QR code carries (so scans are told from links). */
export const doorUrl = (baseUrl: string, businessId: string) => `${baseUrl}/c/${encodeURIComponent(businessId)}`;
export const doorQrTarget = (baseUrl: string, businessId: string) => `${doorUrl(baseUrl, businessId)}?s=qr`;

export function registerFrontDoorRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const baseOf = (req: Request) => config.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
  const live = async (id: string) => (BUSINESS_ID.test(id) ? businessById(id) : undefined);

  app.get("/c-assets/door.css", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("text/css").send(DOOR_CSS);
  });

  app.get("/c/:business/brand.css", async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Colours aren't secret, and a paused business's customers still reach its payment page.
      const id = String(req.params.business);
      const business = BUSINESS_ID.test(id) ? await anyBusinessById(id) : undefined;
      const settings = business ? await getBusinessSettings(business.id) : null;
      res.setHeader("Cache-Control", "public, max-age=300");
      res.type("text/css").send(brandCss(settings?.widgetColor ?? "#0f766e"));
    } catch (error) {
      next(error);
    }
  });

  app.get("/c/:business/qr.svg", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await live(String(req.params.business));
      if (!business) return res.status(404).type("text/plain").send("Not found");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type("image/svg+xml").send(qrSvg(doorQrTarget(baseOf(req), business.id)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/c/:business", async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Content-Security-Policy", DOOR_CSP);
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
      const business = await live(String(req.params.business));
      const settings = business ? await getBusinessSettings(business.id) : null;
      if (!business || !settings || settings.frontDoor === false) return res.status(404).type("html").send(renderDoorClosed());
      const base = baseOf(req);
      const [assets, number] = await Promise.all([brandAssetsOf(business.id), settings.widgetWhatsapp === false ? null : getNumber(business.id)]);
      const via = doorSource(req.query.s);
      if (looksLikePerson(req.header("user-agent"))) void recordDoorVisit(business.id, via);
      res.type("html").send(renderFrontDoor({
        businessId: business.id,
        name: settings.displayName ?? business.name,
        tagline: settings.brandTagline,
        assistant: settings.assistantName ?? "Zaina",
        role: personaRole(business, settings),
        color: settings.widgetColor ?? "#0f766e",
        logoUrl: brandAssetUrl(base, business.id, assets.logo),
        coverUrl: brandAssetUrl(base, business.id, assets.cover),
        phone: settings.contactPhone,
        phoneDisplay: settings.contactPhone ? settings.contactPhoneDisplay ?? settings.contactPhone : null,
        whatsapp: number?.status === "active" ? whatsappLink(number.displayPhoneNumber) : null,
        via,
        brandVersion: (settings.widgetColor ?? "0f766e").replace("#", ""),
      }));
    } catch (error) {
      next(error);
    }
  });

  // A business's pictures. Their address carries a part of their fingerprint, so a browser may keep them for good.
  app.get("/brand/:business/:kind", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, kind } = req.params;
      if (!BUSINESS_ID.test(String(business)) || !isBrandKind(kind)) return res.status(404).type("text/plain").send("Not found");
      const asset = await readBrandAsset(String(business), kind);
      if (!asset) return res.status(404).type("text/plain").send("Not found");
      const pinned = typeof req.query.v === "string" && asset.sha256.startsWith(req.query.v) && req.query.v.length >= 8;
      res.setHeader("Cache-Control", pinned ? "public, max-age=31536000, immutable" : "public, max-age=300");
      res.setHeader("ETag", `"${asset.sha256.slice(0, 32)}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      // The chat box shows the logo on the business's own website.
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      if (req.header("if-none-match") === `"${asset.sha256.slice(0, 32)}"`) return res.status(304).end();
      res.type(asset.contentType).send(asset.bytes);
    } catch (error) {
      next(error);
    }
  });

  // ── The business's team ──────────────────────────────────────────────
  const base = "/v1/staff/businesses/:businessId";

  const brandView = async (businessId: string, baseUrl: string) => {
    const assets = await brandAssetsOf(businessId);
    return {
      logo_url: brandAssetUrl(baseUrl, businessId, assets.logo),
      cover_url: brandAssetUrl(baseUrl, businessId, assets.cover),
      limits: { logo_kb: Math.round(BRAND_MAX_BYTES.logo / 1024), cover_kb: Math.round(BRAND_MAX_BYTES.cover / 1024) },
    };
  };

  app.get(`${base}/front-door`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = staffOf(req).business!;
      const baseUrl = baseOf(req);
      const [settings, stats, brand] = await Promise.all([getBusinessSettings(business.id), doorStats(business.id, 30), brandView(business.id, baseUrl)]);
      res.json({
        url: doorUrl(baseUrl, business.id),
        qr_svg: qrSvg(doorQrTarget(baseUrl, business.id)),
        open: settings?.frontDoor !== false,
        // Customers reach it once the business is live.
        live: business.status === "active",
        name: settings?.displayName ?? business.name,
        tagline: settings?.brandTagline ?? null,
        assistant: settings?.assistantName ?? "Zaina",
        role: personaRole(business, settings),
        color: settings?.widgetColor ?? "#0f766e",
        logo_url: brand.logo_url,
        stats,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/brand`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await brandView(staffOf(req).business!.id, baseOf(req)));
    } catch (error) {
      next(error);
    }
  });

  const picture = express.raw({ type: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"], limit: BRAND_MAX_BYTES.cover + 1024 });
  app.put(`${base}/brand/:kind`, staff, requireBusinessRole("manager"), picture, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kind = req.params.kind;
      if (!isBrandKind(kind)) return res.status(404).json({ error: "not_found" });
      const checked = checkBrandImage(kind, req.body);
      if (!checked.ok) return res.status(400).json({ error: "invalid_picture", message: checked.message });
      const { business, user } = staffOf(req);
      await saveBrandAsset(business!.id, kind, checked, user.id);
      res.json(await brandView(business!.id, baseOf(req)));
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${base}/brand/:kind`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kind = req.params.kind;
      if (!isBrandKind(kind)) return res.status(404).json({ error: "not_found" });
      const business = staffOf(req).business!;
      await removeBrandAsset(business.id, kind);
      res.json(await brandView(business.id, baseOf(req)));
    } catch (error) {
      next(error);
    }
  });
}

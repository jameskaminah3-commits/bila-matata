// src/frontdoor/routes.ts
//
// A business's front door on this service, and its brand:
//
//   GET  /c/:business                 its own page: name, logo, colours, and Zaina ready to talk; with a
//                                     tab of what it offers when it shows anything (catalogue.ts), and
//                                     ?spot=Table+5 for where the customer is (spot.ts)
//   GET  /c/:business/brand.css       its colours (the page allows no inline style)
//   GET  /c/:business/qr.svg          its QR code (?style=classic for plain black and white; ?for=card for the business card's)
//   GET  /q/:business, /k/:business   what its printed codes carry (/k on business cards; a table card's
//                                     /q/<business>?spot=Table+5 says where the customer is): the scan is
//                                     counted, then the customer goes wherever its Zaina works (its
//                                     page here, its website with the chat open, or its WhatsApp)
//   GET  /c-assets/door.css           the page's look
//   GET  /c-assets/door.js            the page's tabs, pills, search and Order / Ask buttons
//   GET  /brand/:business/:kind       its logo or cover picture (kind: logo | cover)
//
//   Its team, from the dashboard (/v1/staff/businesses/:businessId/…):
//   GET    front-door                 viewer   the address, the QR codes, where scans go, whether it's open, and how many came through it
//   GET    brand                      viewer   its pictures' addresses and size limits
//   PUT    brand/:kind                manager  a new logo or cover (the picture itself as the request body)
//   DELETE brand/:kind                manager  remove it
//
// The welcome line, the chat's picture (Zaina's face or the logo), whether
// the page is open, where scans go and what the business cards say are
// settings (PATCH settings: brandTagline, chatAvatar, frontDoor,
// qrDestination, cardDetails).

import { rateLimited } from "../gateway/rate-limit.ts";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { BRAND_MAX_BYTES, brandAssetUrl, brandAssetsOf, checkBrandImage, isBrandKind, readableOn, readBrandAsset, removeBrandAsset, saveBrandAsset } from "../brand/assets.ts";
import { anyBusinessById, businessById } from "../businesses/registry.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { getNumber } from "../channels/whatsapp/numbers.ts";
import { personaRole } from "../engine/persona.ts";
import { whatsappLink } from "../gateway/routes.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { brandCss, DOOR_CSS, DOOR_JS, initials, renderDoorClosed, renderFrontDoor } from "./page.ts";
import { cachedDoorCatalogue, doorCatalogue } from "./catalogue.ts";
import { cleanSpot } from "./spot.ts";
import { businessOrigin, canBeSubdomain, subdomainsOn } from "./subdomains.ts";
import { qrSvg } from "./qr.ts";
import { isOriginAllowed } from "../gateway/origin.ts";
import type { QrDestination } from "../db/schema.ts";
import { doorSource, doorStats, looksLikePerson, recordDoorVisit, type DoorSource } from "./stats.ts";

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

/** The address of a business's page: its own (clubxo.bilamatata.com) once those are on, else /c/<business>. */
export const doorUrl = (baseUrl: string, businessId: string) => (subdomainsOn(baseUrl) && canBeSubdomain(businessId)
  ? `${businessOrigin(baseUrl, businessId)}/`
  : `${baseUrl}/c/${encodeURIComponent(businessId)}`);
/**
 * What a printed code carries: short (a smaller code reads from further away),
 * and never changing, whatever the business later chooses as its destination.
 */
export const doorQrTarget = (baseUrl: string, businessId: string, on: "qr" | "card" = "qr") => (subdomainsOn(baseUrl) && canBeSubdomain(businessId)
  ? `${businessOrigin(baseUrl, businessId)}/${on === "card" ? "k" : "q"}`
  : `${baseUrl}/${on === "card" ? "k" : "q"}/${encodeURIComponent(businessId)}`);

type Destination = { kind: QrDestination; url: string };

/**
 * Where a scan goes. The business's choice, when Zaina really works there:
 * its website only when the chat may run on it (one of its allowed websites),
 * its WhatsApp only when the number is connected to Zaina. Otherwise its page
 * here, which always works.
 */
export function scanDestination(input: { base: string; businessId: string; name: string; choice: QrDestination; websiteUrl: string | null; allowedOrigins: string[]; whatsapp: string | null; on: DoorSource; spot?: string | null }): Destination {
  // A table or room code's spot goes along: on the page and the website it reaches the chat, on WhatsApp it's in the first message.
  const spot = input.spot ? cleanSpot(input.spot) : null;
  const page: Destination = { kind: "page", url: `${doorUrl(input.base, input.businessId)}?s=${input.on}${spot ? `&spot=${spotParam(spot)}` : ""}` };
  if (input.choice === "website" && input.websiteUrl) {
    const site = websiteWithChat(input.websiteUrl, input.allowedOrigins, spot);
    if (site) return { kind: "website", url: site };
  }
  if (input.choice === "whatsapp" && input.whatsapp && /^https:\/\/wa\.me\/\d{8,15}$/.test(input.whatsapp)) {
    return { kind: "whatsapp", url: `${input.whatsapp}?text=${encodeURIComponent(spot ? `Hi ${input.name}! I'm at ${spot}.` : `Hi ${input.name}!`)}` };
  }
  return page;
}

/** "Table 5" → "Table+5": short in a printed code, and read back by cleanSpot. */
export const spotParam = (spot: string) => encodeURIComponent(spot).replace(/%20/g, "+");

/** The business's website, opening the chat (#zaina), when the chat may run there; otherwise null. */
export function websiteWithChat(websiteUrl: string, allowedOrigins: string[], spot: string | null = null): string | null {
  try {
    const url = new URL(websiteUrl);
    if (url.protocol !== "https:" || !isOriginAllowed(url.origin, allowedOrigins)) return null;
    // The widget on the website reads its own, namespaced parameter (never the site's ?spot).
    if (spot) url.searchParams.set("zaina_spot", spot);
    url.hash = "zaina";
    return url.toString();
  } catch {
    return null;
  }
}

/** A business's logo as a data: URI, to sit in the centre of its code. */
export async function logoDataUri(businessId: string): Promise<string | null> {
  const logo = await readBrandAsset(businessId, "logo");
  return logo ? `data:${logo.contentType};base64,${logo.bytes.toString("base64")}` : null;
}

/** The business's premium code: its colour, and its logo or initials in the centre. */
export async function premiumQr(target: string, business: { id: string; name: string }, color: string | null | undefined): Promise<string> {
  return qrSvg(target, { style: "premium", color: color ?? undefined, logo: await logoDataUri(business.id), initials: initials(business.name) });
}

export function registerFrontDoorRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const baseOf = (req: Request) => config.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
  const live = async (id: string) => (BUSINESS_ID.test(id) ? businessById(id) : undefined);
  // On a business's own address the page is a different origin from the main one: its pictures from the main address are allowed too.
  const doorCsp = config.publicBaseUrl ? DOOR_CSP.replace("img-src 'self' data:", `img-src 'self' data: ${new URL(config.publicBaseUrl).origin}`) : DOOR_CSP;

  app.get("/c-assets/door.css", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("text/css").send(DOOR_CSS);
  });
  app.get("/c-assets/door.js", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("application/javascript").send(DOOR_JS);
  });

  // A busy counter is many phones; one phone reloading in a loop is not.
  // Per address, and an address is often a whole venue on one Wi-Fi: generous, so a full room scanning at once all get in.
  const doorLimit = rateLimited(config.sessionTokenSecret, "door", config.rateLimits.doorRequestsPerMinute, 60);
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
      const settings = await getBusinessSettings(business.id);
      // A table or room card's code: /q/<business>?spot=Table+5.
      const spot = req.query.for === "card" ? null : cleanSpot(req.query.spot);
      const target = `${doorQrTarget(baseOf(req), business.id, req.query.for === "card" ? "card" : "qr")}${spot ? `?spot=${spotParam(spot)}` : ""}`;
      const svg = req.query.style === "classic"
        ? qrSvg(target)
        : await premiumQr(target, { id: business.id, name: settings?.displayName ?? business.name }, settings?.widgetColor);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type("image/svg+xml").send(svg);
    } catch (error) {
      next(error);
    }
  });

  // What printed codes carry. Counted, then on to wherever the business's Zaina works.
  const scan = (on: "qr" | "card") => async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      const business = await live(String(req.params.business));
      const settings = business ? await getBusinessSettings(business.id) : null;
      if (!business || !settings) return res.status(404).type("html").send(renderDoorClosed());
      const base = baseOf(req);
      const number = settings.qrDestination === "whatsapp" ? await getNumber(business.id) : null;
      const destination = scanDestination({
        base,
        businessId: business.id,
        name: settings.displayName ?? business.name,
        choice: settings.qrDestination,
        websiteUrl: settings.websiteUrl,
        allowedOrigins: business.allowedOrigins,
        whatsapp: number?.status === "active" ? whatsappLink(number.displayPhoneNumber) : null,
        on,
        spot: cleanSpot(req.query.spot),
      });
      // The page counts its own visits; a scan that goes elsewhere is counted here.
      if (destination.kind !== "page" && looksLikePerson(req.header("user-agent"))) void recordDoorVisit(business.id, on);
      if (destination.kind === "page" && settings.frontDoor === false) return res.status(404).type("html").send(renderDoorClosed());
      res.redirect(302, destination.url);
    } catch (error) {
      next(error);
    }
  };
  app.get("/q/:business", doorLimit, scan("qr"));
  app.get("/k/:business", doorLimit, scan("card"));

  app.get("/c/:business", doorLimit, async (req: Request, res: Response, next: NextFunction) => {
    try {
      // A link to the main address's page goes on to the business's own address (the name shows first there too).
      const id = String(req.params.business);
      if (!res.locals.businessHost && config.publicBaseUrl && subdomainsOn(config.publicBaseUrl) && canBeSubdomain(id)) {
        return res.redirect(302, `${businessOrigin(config.publicBaseUrl, id)}/${req.url.slice(req.path.length)}`);
      }
      res.setHeader("Content-Security-Policy", doorCsp);
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
      const business = await live(String(req.params.business));
      const settings = business ? await getBusinessSettings(business.id) : null;
      if (!business || !settings || settings.frontDoor === false) return res.status(404).type("html").send(renderDoorClosed());
      // Served on the business's own address, its pictures come from that address too.
      const base = res.locals.businessHost === business.id ? `${req.protocol}://${req.get("host")}` : baseOf(req);
      const [assets, number] = await Promise.all([brandAssetsOf(business.id), settings.widgetWhatsapp === false ? null : getNumber(business.id)]);
      const via = doorSource(req.query.s);
      if (looksLikePerson(req.header("user-agent"))) void recordDoorVisit(business.id, via);
      const catalogue = await cachedDoorCatalogue(business, settings).catch(() => null);
      res.type("html").send(renderFrontDoor({
        businessId: business.id,
        name: settings.displayName ?? business.name,
        tagline: settings.brandTagline,
        menuStyle: settings.menuStyle ?? "auto",
        assistant: settings.assistantName ?? "Zaina",
        role: personaRole(business, settings),
        color: settings.widgetColor ?? "#0f766e",
        logoUrl: brandAssetUrl(base, business.id, assets.logo),
        coverUrl: brandAssetUrl(base, business.id, assets.cover),
        phone: settings.contactPhone,
        phoneDisplay: settings.contactPhone ? settings.contactPhoneDisplay ?? settings.contactPhone : null,
        whatsapp: number?.status === "active" ? whatsappLink(number.displayPhoneNumber) : null,
        // The chat counts where it came from: a card's scan counts as a card.
        via: via === "card" ? "card" : via,
        brandVersion: (settings.widgetColor ?? "0f766e").replace("#", ""),
        catalogue,
        spot: cleanSpot(req.query.spot),
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
      const [settings, stats, brand, number] = await Promise.all([getBusinessSettings(business.id), doorStats(business.id, 30), brandView(business.id, baseUrl), getNumber(business.id)]);
      const name = settings?.displayName ?? business.name;
      const whatsapp = number?.status === "active" ? whatsappLink(number.displayPhoneNumber) : null;
      const target = doorQrTarget(baseUrl, business.id);
      const cardTarget = doorQrTarget(baseUrl, business.id, "card");
      const choice = settings?.qrDestination ?? "page";
      const website = settings?.websiteUrl ? websiteWithChat(settings.websiteUrl, business.allowedOrigins) : null;
      res.json({
        url: doorUrl(baseUrl, business.id),
        scan_url: target,
        card_url: cardTarget,
        qr_svg: await premiumQr(target, { id: business.id, name }, settings?.widgetColor),
        qr_classic_svg: qrSvg(target),
        card_qr_svg: await premiumQr(cardTarget, { id: business.id, name }, settings?.widgetColor),
        // Where scans go, and which destinations Zaina really works at.
        destination: {
          chosen: choice,
          effective: scanDestination({ base: baseUrl, businessId: business.id, name, choice, websiteUrl: settings?.websiteUrl ?? null, allowedOrigins: business.allowedOrigins, whatsapp, on: "qr" }).kind,
          website: website ? { url: settings!.websiteUrl } : { url: settings?.websiteUrl ?? null, problem: settings?.websiteUrl ? "The chat isn't allowed on this website yet: add it under Website widget." : "Add your website's address under Business." },
          whatsapp: whatsapp ? { number: number!.displayPhoneNumber } : { number: null, problem: "Connect your WhatsApp number to Zaina under WhatsApp." },
        },
        card: settings?.cardDetails ?? null,
        contact: { phone: settings?.contactPhoneDisplay ?? settings?.contactPhone ?? null, email: settings?.supportEmail ?? null, website: settings?.websiteUrl ?? null },
        open: settings?.frontDoor !== false,
        // Customers reach it once the business is live.
        live: business.status === "active",
        name: settings?.displayName ?? business.name,
        tagline: settings?.brandTagline ?? null,
        assistant: settings?.assistantName ?? "Zaina",
        role: personaRole(business, settings),
        color: settings?.widgetColor ?? "#0f766e",
        on_color: readableOn(settings?.widgetColor ?? "#0f766e"),
        logo_url: brand.logo_url,
        // The page's catalogue tab ("Browse Menu"), if it has one: the printed cards say the same.
        browse: (await doorCatalogue(business, settings ?? null).catch(() => null))?.tab ?? null,
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

// src/cards/routes.ts
//
// A business's premium business cards, for its team (dashboard → Settings →
// Business cards). They come with an active Zaina plan:
//
//   POST /v1/staff/businesses/:businessId/business-card   viewer
//        { details?, bleed?, thumbnails? } → { front, back, thumbnails? }
//
// details are the card's lines and design as the team is typing them (the
// saved ones when left out), so the preview follows every keystroke; bleed
// adds the 3 mm print margin (for print files); thumbnails adds the front of
// each design, for choosing one. Downloads (PDF and pictures) are made in
// the browser from exactly these pictures. Saving the details is a setting
// (PATCH settings: cardDetails).

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { billingOf } from "../billing/store.ts";
import { getBusinessSettings, checkCardDetails } from "../businesses/settings.ts";
import { cardDesigns, type Business, type CardDetails } from "../db/schema.ts";
import { personaRole } from "../engine/persona.ts";
import { doorQrTarget, logoDataUri } from "../frontdoor/routes.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { renderCard, type CardInput } from "./render.ts";

/** Plans that are running: a trial, a paid month, or one waiting on its invoice (not yet paused). */
const RUNNING = new Set(["trialing", "active", "past_due"]);

/**
 * Whether a business may make its cards: it is live (not paused, not still
 * setting up), and its plan is running. A business the studio bills by hand
 * has no plan record and is live: it qualifies.
 */
export async function cardsAvailable(business: Business): Promise<{ ok: true } | { ok: false; message: string }> {
  if (business.status === "paused") return { ok: false, message: "Your Zaina is paused, so business cards are off for now. They come back as soon as it's running again." };
  if (business.status !== "active") return { ok: false, message: "Business cards come with an active Zaina plan: they open once your business is live." };
  const { subscription } = await billingOf(business.id);
  if (subscription && !RUNNING.has(subscription.status)) return { ok: false, message: "Business cards come with an active Zaina plan. Choose a plan under Plan & billing to make yours." };
  return { ok: true };
}

const BLANK: CardDetails = { design: "signature", personName: null, personTitle: null, phone: null, email: null, website: null, address: null };

export function registerCardRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);

  app.post("/v1/staff/businesses/:businessId/business-card", staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = staffOf(req).business!;
      const allowed = await cardsAvailable(business);
      if (!allowed.ok) return res.status(402).json({ error: "plan_required", message: allowed.message });
      const settings = await getBusinessSettings(business.id);
      let details: CardDetails = settings?.cardDetails ?? {
        ...BLANK,
        phone: settings?.contactPhoneDisplay ?? settings?.contactPhone ?? null,
        email: settings?.supportEmail ?? null,
        website: settings?.websiteUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null,
      };
      if (req.body?.details !== undefined) {
        const checked = checkCardDetails(req.body.details);
        if (!checked.ok) return res.status(400).json({ error: "invalid_card", message: checked.error });
        details = checked.value ?? BLANK;
      }
      const base = config.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
      const target = doorQrTarget(base, business.id, "card");
      const input: CardInput = {
        name: settings?.displayName ?? business.name,
        tagline: settings?.brandTagline ?? null,
        assistant: settings?.assistantName ?? "Zaina",
        role: personaRole(business, settings),
        color: settings?.widgetColor ?? "#0f766e",
        logo: await logoDataUri(business.id),
        qrTarget: target,
        qrLabel: target.replace(/^https?:\/\//, ""),
        details,
      };
      const bleed = req.body?.bleed === true;
      res.setHeader("Cache-Control", "no-store");
      res.json({
        name: input.name,
        design: details.design,
        details,
        front: renderCard(input, "front", { bleed }).svg,
        back: renderCard(input, "back", { bleed }).svg,
        ...(req.body?.thumbnails === true ? { thumbnails: Object.fromEntries(cardDesigns.map((design) => [design, renderCard({ ...input, details: { ...details, design } }, "front").svg])) } : {}),
      });
    } catch (error) {
      next(error);
    }
  });
}

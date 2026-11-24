// src/billing/tier-gate.ts
//
// What the Starter tier doesn't include, at the door: rooms, services,
// availability, bookings, payments and calendars are the Full tier's. A
// Starter business's team can still read what's already there (a business
// that moved down keeps its history), but can't add or change any of it,
// and Zaina has no booking tools (connectors/registry.ts).

import type { NextFunction, Request, Response } from "express";
import { anyBusinessById } from "../businesses/registry.ts";
import { booksOnTier } from "../db/schema.ts";

/** The staff API's sections that belong to the Full tier. */
export const FULL_TIER_SECTIONS = new Set([
  "blocks", "booking-settings", "mark-full", "bookings", "calendar", "calendars", "closures", "offerings", "payments", "quote", "resources", "schedule", "slots",
]);

export const FULL_TIER_MESSAGE = "Availability, bookings, payments and calendars are part of the Full Booking & Quote Engine plan. Upgrade in Settings → Plan & billing, or ask the Zaina team.";

/** Mounted at /v1/staff/businesses/:businessId, before the routes. */
export async function fullTierOnly(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const section = req.path.split("/")[1] ?? "";
    if (!FULL_TIER_SECTIONS.has(section)) return next();
    const business = await anyBusinessById(String(req.params.businessId ?? ""));
    if (business && !booksOnTier(business.tier)) {
      res.status(402).json({ error: "plan_required", message: FULL_TIER_MESSAGE });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

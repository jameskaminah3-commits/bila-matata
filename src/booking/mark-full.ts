// src/booking/mark-full.ts
//
// "We're full", in one step from a phone: for a business that sells out
// somewhere else (a walk-in, a phone call, another booking site) and has no
// calendar connected. Zaina stops offering those days at once.
//
//   POST /v1/staff/businesses/:businessId/mark-full   manager
//        { from: "YYYY-MM-DD", until: "YYYY-MM-DD" (the first day open again), reason? }
//
// A place to stay closes every room type for those nights; a salon or
// restaurant closes the whole business for those days. Reopening is the
// existing Reopen (Rooms → Closed dates) or delete (Services → Closures).

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { businessCapabilities, roomTypesOf } from "../capabilities/of-business.ts";
import { offeringBlocks, type Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { zonedInstant } from "./local-time.ts";
import { listOfferings } from "./offerings.ts";
import { parseDate } from "./pricing.ts";
import { createResourceBlock } from "./resources.ts";

export type MarkFullResult = { ok: true; closed: "rooms" | "business"; rooms?: number; from: string; until: string } | { ok: false; status: number; error: string; message: string };

/** Closes the days from `from` until `until` (the first day open again). */
export async function markFull(business: Business, input: { from: string; until: string; reason?: string | null; userId: string }): Promise<MarkFullResult> {
  const { from, until } = input;
  const start = parseDate(from);
  const end = parseDate(until);
  if (!start || !end || end <= start || (end.getTime() - start.getTime()) / 86_400_000 > 92) {
    return { ok: false, status: 400, error: "invalid_dates", message: "until is the first day open again, after from, within three months." };
  }
  const reason = input.reason?.trim().slice(0, 200) || "Full";
  // What's booked here follows the business's capabilities (a hotel with a restaurant closes its rooms).
  const { enabled } = await businessCapabilities(business);
  const booksHere = enabled.some((capability) => capability === "rooms" || capability === "tables" || capability === "appointments");
  if (!booksHere) return { ok: false, status: 409, error: "no_bookings", message: "This business doesn't take bookings through Zaina." };
  if (enabled.includes("rooms")) {
    const rooms = roomTypesOf(await listOfferings(business.id, { activeOnly: true }));
    if (!rooms.length) return { ok: false, status: 409, error: "no_rooms", message: "Add your rooms first." };
    await inBusiness((db) => db.insert(offeringBlocks).values(rooms.map((room) => ({ businessId: business.id, offeringId: room.id, startsOn: from, endsOn: until, units: room.units, reason, createdBy: input.userId }))), business.id);
    return { ok: true, closed: "rooms", rooms: rooms.length, from, until };
  }
  await createResourceBlock(business.id, { resourceId: null, startsAt: zonedInstant(from, "00:00", business.timeZone), endsAt: zonedInstant(until, "00:00", business.timeZone), reason, createdBy: input.userId });
  return { ok: true, closed: "business", from, until };
}

export function registerMarkFullRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  app.post("/v1/staff/businesses/:businessId/mark-full", staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      const result = await markFull(business!, {
        from: String(req.body?.from ?? ""), until: String(req.body?.until ?? ""),
        reason: typeof req.body?.reason === "string" ? req.body.reason : null, userId: user.id,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error, message: result.message });
      res.status(201).json(result.closed === "rooms" ? { closed: "rooms", rooms: result.rooms, from: result.from, until: result.until } : { closed: "business", from: result.from, until: result.until });
    } catch (error) {
      next(error);
    }
  });
}

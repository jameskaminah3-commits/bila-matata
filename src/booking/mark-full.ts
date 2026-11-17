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
import { offeringBlocks } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { zonedInstant } from "./local-time.ts";
import { listOfferings } from "./offerings.ts";
import { parseDate } from "./pricing.ts";
import { createResourceBlock } from "./resources.ts";

export function registerMarkFullRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  app.post("/v1/staff/businesses/:businessId/mark-full", staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      const from = String(req.body?.from ?? "");
      const until = String(req.body?.until ?? "");
      const start = parseDate(from);
      const end = parseDate(until);
      if (!start || !end || end <= start || (end.getTime() - start.getTime()) / 86_400_000 > 92) {
        return res.status(400).json({ error: "invalid_dates", message: "until is the first day open again, after from, within three months." });
      }
      const reason = typeof req.body?.reason === "string" && req.body.reason.trim() ? req.body.reason.trim().slice(0, 200) : "Full";
      // What's booked here follows the business's capabilities (a hotel with a restaurant closes its rooms).
      const { enabled } = await businessCapabilities(business!);
      const booksHere = enabled.some((capability) => capability === "rooms" || capability === "tables" || capability === "appointments");
      if (!booksHere) return res.status(409).json({ error: "no_bookings", message: "This business doesn't take bookings through Zaina." });
      if (enabled.includes("rooms")) {
        const rooms = roomTypesOf(await listOfferings(business!.id, { activeOnly: true }));
        if (!rooms.length) return res.status(409).json({ error: "no_rooms", message: "Add your rooms first." });
        await inBusiness((db) => db.insert(offeringBlocks).values(rooms.map((room) => ({ businessId: business!.id, offeringId: room.id, startsOn: from, endsOn: until, units: room.units, reason, createdBy: user.id }))), business!.id);
        return res.status(201).json({ closed: "rooms", rooms: rooms.length, from, until });
      }
      await createResourceBlock(business!.id, { resourceId: null, startsAt: zonedInstant(from, "00:00", business!.timeZone), endsAt: zonedInstant(until, "00:00", business!.timeZone), reason, createdBy: user.id });
      res.status(201).json({ closed: "business", from, until });
    } catch (error) {
      next(error);
    }
  });
}

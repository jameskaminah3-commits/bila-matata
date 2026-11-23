// src/whats-on/routes.ts
//
// What's on, from the dashboard (/v1/staff/businesses/:businessId/…):
//   GET    whats-on        viewer    everything still to come, and every week's
//   POST   whats-on        manager   { text, date?, until?, weekday? }: post one (today unless a day is given)
//   DELETE whats-on/:id    manager   take one down
// The same can be posted by WhatsApp (owner/changes.ts). Zaina knows it at once,
// and the business's page shows it.

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { addWhatsOn, checkWhatsOn, listWhatsOn, localDay, removeWhatsOn, type WhatsOn } from "./whats-on.ts";

const publicEntry = (entry: WhatsOn) => ({ id: entry.id, text: entry.text, date: entry.date, until: entry.until, weekday: entry.weekday, created_at: entry.createdAt });

export function registerWhatsOnRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId/whats-on";
  const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };
  app.get(base, staff, requireBusinessRole("viewer"), handle(async (req, res) => {
    const business = staffOf(req).business!;
    res.json({ today: localDay(business.timeZone), entries: (await listWhatsOn(business)).map(publicEntry) });
  }));
  app.post(base, staff, requireBusinessRole("manager"), handle(async (req, res) => {
    const { business, user } = staffOf(req);
    const checked = checkWhatsOn(req.body ?? {}, localDay(business!.timeZone));
    if (!checked.ok) return res.status(400).json({ error: "invalid_whats_on", message: checked.error });
    const added = await addWhatsOn(business!, checked.value, user.id);
    if (added === "too_many") return res.status(409).json({ error: "too_many", message: "That's a lot on: take down something that's over first." });
    res.status(201).json({ entry: publicEntry(added) });
  }));
  app.delete(`${base}/:entryId`, staff, requireBusinessRole("manager"), handle(async (req, res) => {
    const removed = await removeWhatsOn(staffOf(req).business!, String(req.params.entryId));
    if (!removed) return res.status(404).json({ error: "not_found" });
    res.json({ removed: publicEntry(removed) });
  }));
}

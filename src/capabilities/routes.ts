// src/capabilities/routes.ts
//
// What a business offers through Zaina, for its team (dashboard → Setup):
//
//   GET /v1/staff/businesses/:businessId/capabilities   viewer
//       → { enabled, chosen, industry, books, catalog: [{ key, label, what, module, usual, primary }] }
//   PUT /v1/staff/businesses/:businessId/capabilities   manager
//       { enabled: ["rooms", "tables", …] }
//
// Switching one on gives Zaina its tools and rules on her next message.

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import type { Business } from "../db/schema.ts";
import { defaultIndustry } from "../engine/playbooks.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { bookingModules, CAPABILITIES, capabilitiesOf, capabilityKeys, cleanCapabilities, usualCapabilities } from "./catalog.ts";

export async function capabilitiesView(business: Business) {
  const settings = await getBusinessSettings(business.id);
  const enabled = capabilitiesOf(business, settings);
  const industry = settings?.industry ?? defaultIndustry(business.businessType);
  const primary = new Set(usualCapabilities(industry));
  const modules = bookingModules(business, enabled);
  return {
    enabled,
    chosen: Boolean(settings?.capabilities),
    industry,
    // What is booked here (Full plan), and what Zaina passes to the team.
    books: { rooms: modules.rooms, services: modules.slotKinds.includes("service"), tables: modules.slotKinds.includes("table") },
    catalog: capabilityKeys.map((key) => ({
      key,
      label: CAPABILITIES[key].label,
      what: CAPABILITIES[key].what,
      module: CAPABILITIES[key].module,
      // Usual for its industry (offered first), and the one it's mainly set up with.
      usual: CAPABILITIES[key].usualFor.includes(industry),
      primary: primary.has(key),
    })),
  };
}

export function registerCapabilityRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId/capabilities";

  app.get(base, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await capabilitiesView(staffOf(req).business!));
    } catch (error) {
      next(error);
    }
  });

  app.put(base, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      if (business!.businessType === "custom") return res.status(409).json({ error: "own_system", message: "This business's tools come from its own system." });
      const checked = cleanCapabilities(req.body?.enabled);
      if (!checked.ok) return res.status(400).json({ error: "invalid_capabilities", message: checked.error });
      await updateBusinessSettings(business!.id, { capabilities: { enabled: checked.value, updatedAt: new Date().toISOString() } }, user.id);
      res.json(await capabilitiesView(business!));
    } catch (error) {
      next(error);
    }
  });
}

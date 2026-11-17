// src/owner/routes.ts
//
// Managing the business from WhatsApp, set up in the dashboard, under
// /v1/staff/businesses/:businessId:
//
//   GET    /my-whatsapp       my linked number, or the code waiting to link it, and the business's number
//   POST   /my-whatsapp       a new code to send from my phone ("LINK 123456")
//   DELETE /my-whatsapp       unlink my number
//   GET    /owner-changes     the changes made (or not) from WhatsApp, newest first        manager

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { getNumber } from "../channels/whatsapp/numbers.ts";
import { inBusiness } from "../db/tenant.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { linkedNumber, newLinkCode, unlinkNumber } from "./assistant.ts";

export function registerOwnerRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId";
  const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };
  const view = async (businessId: string, userId: string) => {
    const [mine, number] = await Promise.all([linkedNumber(businessId, userId), getNumber(businessId)]);
    return {
      linked_number: mine.address ? `+${mine.address}` : null,
      code: mine.code,
      code_expires_at: mine.expiresAt,
      business_number: number?.displayPhoneNumber ?? null,
      whatsapp_connected: Boolean(number),
    };
  };

  app.get(`${base}/my-whatsapp`, staff, requireBusinessRole("agent"), handle(async (req, res) => {
    const { business, user } = staffOf(req);
    res.json(await view(business!.id, user.id));
  }));
  app.post(`${base}/my-whatsapp`, staff, requireBusinessRole("agent"), handle(async (req, res) => {
    const { business, user } = staffOf(req);
    if (!(await getNumber(business!.id))) return res.status(409).json({ error: "whatsapp_not_connected", message: "Connect the business's WhatsApp number first." });
    await newLinkCode(business!.id, user.id);
    res.status(201).json(await view(business!.id, user.id));
  }));
  app.delete(`${base}/my-whatsapp`, staff, requireBusinessRole("agent"), handle(async (req, res) => {
    const { business, user } = staffOf(req);
    await unlinkNumber(business!.id, user.id);
    res.json(await view(business!.id, user.id));
  }));
  app.get(`${base}/owner-changes`, staff, requireBusinessRole("manager"), handle(async (req, res) => {
    const { business } = staffOf(req);
    const rows = await inBusiness(async (_db, client) => (await client.query(
      `select c.id, c.kind, c.summary, c.status, c.result, c.created_at, c.decided_at, u.name as by
       from owner_changes c join staff_users u on u.id = c.user_id where c.business_id = $1 order by c.created_at desc limit 50`, [business!.id])).rows, business!.id);
    res.json({ changes: rows });
  }));
}

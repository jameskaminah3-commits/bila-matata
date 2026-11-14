// src/notifications/routes.ts
//
// A business's notification emails (/v1/staff/businesses/:businessId/…):
//   GET    notification-emails            viewer   the addresses, how many its plan allows, and what each gets
//   POST   notification-emails            manager  { email, label?, alerts?, transcripts? }
//   PATCH  notification-emails/:id        manager  { alerts?, transcripts?, label? }
//   DELETE notification-emails/:id        manager
//   POST   notification-emails/:id/test   manager  sends that address a sample email
//
// A new address is emailed to say who added it and what it will get.

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { sendEmail } from "../platform/mailer.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { recipientEmail } from "./dispatch.ts";
import {
  addRecipient,
  notificationAllowance,
  NotificationError,
  recipientsOf,
  removeRecipient,
  TIER_NOTIFICATION_EMAILS,
  updateRecipient,
  validateRecipient,
  type Recipient,
} from "./store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const json = (row: Recipient) => ({ id: row.id, email: row.email, label: row.label, alerts: row.notifyAlerts, transcripts: row.sendTranscripts, added_at: row.createdAt });

export function registerNotificationRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId/notification-emails";
  const handle = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof NotificationError) return void res.status(error.status).json({ error: error.code, message: error.message });
      next(error);
    }
  };
  const idOf = (req: Request) => {
    const id = String(req.params.id ?? "");
    if (!UUID.test(id)) throw new NotificationError(404, "not_found", "That address wasn't found.");
    return id;
  };
  const nameOf = async (businessId: string, fallback: string) => (await getBusinessSettings(businessId))?.displayName ?? fallback;

  app.get(base, staff, requireBusinessRole("viewer"), handle(async (req, res) => {
    const business = staffOf(req).business!;
    const [rows, allowance] = await Promise.all([recipientsOf(business.id), notificationAllowance(business)]);
    res.json({
      recipients: rows.map(json),
      limit: allowance.limit,
      used: rows.length,
      plan: allowance.planName,
      tier: business.tier,
      // What the Full tier allows, so a Starter business sees what upgrading adds.
      full_limit: TIER_NOTIFICATION_EMAILS.full,
    });
  }));

  app.post(base, staff, requireBusinessRole("manager"), handle(async (req, res) => {
    const checked = validateRecipient(req.body);
    if (!checked.ok) return res.status(400).json({ error: "invalid_recipient", message: checked.message });
    const { business, user } = staffOf(req);
    const added = await addRecipient(business!, checked.value, user.id);
    // Whoever it is hears that they were added, by whom, and what they'll get.
    const name = await nameOf(business!.id, business!.name);
    void sendEmail({
      to: added.email,
      subject: `${name} added you to its Zaina notifications`,
      text: [
        `${user.name} at ${name} added ${added.email} to the emails Zaina sends about its chats.`,
        "",
        `You'll get: ${[added.notifyAlerts ? "an email when a customer is waiting, wants a callback, leaves their details or books, with a link to open the chat and take over" : null, added.sendTranscripts ? "the conversation written out" : null].filter(Boolean).join(", and ")}.`,
        "",
        `If this isn't for you, ask ${user.name} to remove it (Settings → Notifications).`,
      ].join("\n"),
    });
    res.status(201).json({ recipient: json(added) });
  }));

  app.patch(`${base}/:id`, staff, requireBusinessRole("manager"), handle(async (req, res) => {
    res.json({ recipient: json(await updateRecipient(staffOf(req).business!.id, idOf(req), req.body ?? {})) });
  }));

  app.delete(`${base}/:id`, staff, requireBusinessRole("manager"), handle(async (req, res) => {
    const removed = await removeRecipient(staffOf(req).business!.id, idOf(req));
    res.status(removed ? 200 : 404).json({ removed });
  }));

  app.post(`${base}/:id/test`, staff, requireBusinessRole("manager"), handle(async (req, res) => {
    const business = staffOf(req).business!;
    const recipient = (await recipientsOf(business.id)).find((row) => row.id === idOf(req));
    if (!recipient) throw new NotificationError(404, "not_found", "That address wasn't found.");
    const link = config.publicBaseUrl ? `${config.publicBaseUrl}/app/#/b/${encodeURIComponent(business.id)}/inbox` : null;
    const email = recipientEmail(recipient, {
      business: await nameOf(business.id, business.name),
      alert: { title: "A test from Zaina", body: "This is a test. When a customer is waiting for your team, an email like this arrives within seconds.", sessionId: null, takeover: true },
      link,
      conversation: recipient.sendTranscripts ? "Customer · 10:42\nHi, do you have a room this weekend?\n\nZaina · 10:42\nHi! Yes, we do. How many guests, and which nights?" : "",
    });
    const sent = await sendEmail({ to: recipient.email, ...email });
    res.json({ sent });
  }));
}

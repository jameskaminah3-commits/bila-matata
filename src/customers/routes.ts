// src/customers/routes.ts
//
// The team's view of its customers, under /v1/staff/businesses/:businessId:
//
//   GET    /customers?q=&filter=all|follow_up|open   most recently in touch first
//   GET    /customers/:id                 the record, what's open, follow-ups, history
//   PATCH  /customers/:id                 { name?, team_note?, preferences?: string[], followed_up?: true }
//   DELETE /customers/:id                 forget them: chats and requests deleted, bookings and orders kept without their details
//   PUT    /customer-settings             { recognition: boolean }  Zaina greets returning customers (WhatsApp, signed in)
//
// Agents see and update customers; forgetting one, and the setting, are for managers.

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { formatMoney } from "../booking/money.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import { eraseCustomer } from "../conversations/retention.ts";
import type { Business } from "../db/schema.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { followUps, openItems, paidSoFar } from "./insights.ts";
import { customerRow, deleteCustomerRow, listCustomerRows, profilesFor, updateCustomer, type Profile } from "./store.ts";

type Filter = "all" | "follow_up" | "open";

function summary(profile: Profile, business: Business, now: Date) {
  const { customer } = profile;
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    signed_in: Boolean(customer.externalId),
    whatsapp: profile.chats.some((chat) => chat.channel === "whatsapp"),
    first_seen_at: customer.firstSeenAt,
    last_seen_at: customer.lastSeenAt,
    counts: {
      chats: profile.chats.length,
      requests: profile.leads.length,
      bookings: profile.bookings.filter((booking) => booking.status === "confirmed").length,
      orders: profile.orders.filter((order) => ["confirmed", "out_for_delivery", "ready_for_collection", "completed"].includes(order.status)).length,
    },
    paid: paidSoFar(profile),
    open: openItems(profile).length,
    follow_ups: followUps(profile, now, business.timeZone).map((entry) => entry.text),
  };
}

function detail(profile: Profile, business: Business, now: Date) {
  const money = (minor: number, currency: string) => formatMoney(minor, currency);
  const history = [
    ...profile.chats.map((chat) => ({ kind: "chat", id: chat.id, at: chat.startedAt, text: chat.firstMessage ?? "A chat", channel: chat.channel })),
    ...profile.leads.map((lead) => ({ kind: lead.kind === "callback" ? "callback" : "request", id: String(lead.id), at: lead.createdAt, text: lead.interest ?? "Left their details", status: lead.status })),
    ...profile.bookings.map((booking) => ({ kind: "booking", id: booking.id, at: booking.createdAt, text: `${booking.reference} · ${booking.what} · ${booking.startsAt ? booking.startsAt.toISOString().slice(0, 10) : `${booking.checkIn} to ${booking.checkOut}`} · ${money(booking.totalMinor, booking.currency)}`, status: booking.status })),
    ...profile.orders.map((order) => ({ kind: "order", id: order.id, at: order.createdAt, text: `${order.reference} · ${order.items} · ${money(order.totalMinor, order.currency)}`, status: order.status })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  return {
    ...summary(profile, business, now),
    preferences: profile.customer.preferences,
    team_note: profile.customer.teamNote,
    followed_up_at: profile.customer.followedUpAt,
    open_items: openItems(profile).map((item) => ({ kind: item.kind, ref: item.ref, text: item.text, at: item.at })),
    history,
  };
}

export function registerCustomerRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId";
  const handle = (fn: (req: Request, res: Response, business: Business) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await fn(req, res, staffOf(req).business!);
      } catch (error) {
        next(error);
      }
    };

  app.get(`${base}/customers`, staff, requireBusinessRole("agent"), handle(async (req, res, business) => {
    const filter: Filter = req.query.filter === "follow_up" || req.query.filter === "open" ? req.query.filter : "all";
    const now = new Date();
    const profiles = await profilesFor(business.id, await listCustomerRows(business.id, typeof req.query.q === "string" ? req.query.q : null));
    const all = profiles.map((profile) => summary(profile, business, now));
    const settings = await getBusinessSettings(business.id);
    res.json({
      customers: all.filter((entry) => filter === "all" || (filter === "follow_up" ? entry.follow_ups.length > 0 : entry.open > 0)),
      counts: { all: all.length, follow_up: all.filter((entry) => entry.follow_ups.length).length, open: all.filter((entry) => entry.open).length },
      recognition: settings?.customerRecognition !== false,
    });
  }));

  app.get(`${base}/customers/:customerId`, staff, requireBusinessRole("agent"), handle(async (req, res, business) => {
    const row = await customerRow(business.id, String(req.params.customerId));
    if (!row) return res.status(404).json({ error: "not_found" });
    const [profile] = await profilesFor(business.id, [row]);
    res.json(detail(profile, business, new Date()));
  }));

  app.patch(`${base}/customers/:customerId`, staff, requireBusinessRole("agent"), handle(async (req, res, business) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if ("preferences" in body && (!Array.isArray(body.preferences) || body.preferences.some((entry: unknown) => typeof entry !== "string"))) {
      return res.status(400).json({ error: "invalid_preferences", message: "preferences is a list of short texts." });
    }
    const row = await updateCustomer(business.id, String(req.params.customerId), {
      ...("name" in body ? { name: typeof body.name === "string" ? body.name : null } : {}),
      ...("team_note" in body ? { teamNote: typeof body.team_note === "string" ? body.team_note : null } : {}),
      ...("preferences" in body ? { preferences: body.preferences } : {}),
      ...(body.followed_up === true ? { followedUp: true } : {}),
    });
    if (!row) return res.status(404).json({ error: "not_found" });
    const [profile] = await profilesFor(business.id, [row]);
    res.json(detail(profile, business, new Date()));
  }));

  app.delete(`${base}/customers/:customerId`, staff, requireBusinessRole("manager"), handle(async (req, res, business) => {
    const row = await customerRow(business.id, String(req.params.customerId));
    if (!row) return res.status(404).json({ error: "not_found" });
    const erased = row.phone || row.email ? await eraseCustomer({ phone: row.phone ?? undefined, email: row.email ?? undefined }) : { conversations: 0, leads: 0, bookings: 0, orders: 0 };
    await deleteCustomerRow(business.id, row.id);
    res.json({ deleted_conversations: erased.conversations, deleted_leads: erased.leads, anonymized_bookings: erased.bookings, anonymized_orders: erased.orders });
  }));

  app.put(`${base}/customer-settings`, staff, requireBusinessRole("manager"), handle(async (req, res, business) => {
    if (typeof req.body?.recognition !== "boolean") return res.status(400).json({ error: "invalid_settings", message: "recognition is true or false." });
    await updateBusinessSettings(business.id, { customerRecognition: req.body.recognition }, staffOf(req).user.id);
    res.json({ recognition: req.body.recognition });
  }));
}

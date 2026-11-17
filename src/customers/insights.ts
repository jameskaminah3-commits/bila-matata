// src/customers/insights.ts
//
// What a customer's record says at a glance, worked out from what's linked
// to it (store.ts Profile), without a database:
//
//   openItems    what's still waiting: a request, a call-back, a booking or
//                order not settled yet
//   followUps    good moments to get in touch: asked and didn't buy, let an
//                order or booking lapse, or a past customer gone quiet
//   paidSoFar    what they've paid the business, per currency
//
// Follow-ups are suggestions for the team, never messages sent by Zaina.

import { formatMoney } from "../booking/money.ts";
import type { Profile } from "./store.ts";

const DAY = 86_400_000;
export type OpenItem = { kind: "request" | "callback" | "booking" | "order" | "chat"; ref: string; text: string; at: Date };
export type FollowUp = { kind: "no_purchase" | "lapsed" | "come_back"; text: string; at: Date };

const BOOKING_OPEN: Record<string, string> = { requested: "waiting for the team", held: "held, waiting for payment", awaiting_payment: "waiting for payment", conflict: "paid, needs the team" };
const ORDER_OPEN: Record<string, string> = { requested: "waiting for the team", awaiting_payment: "waiting for payment", confirmed: "confirmed, to deliver", out_for_delivery: "on its way", ready_for_collection: "ready to collect" };
const BOOKED = ["confirmed"];
const BOUGHT = ["confirmed", "out_for_delivery", "ready_for_collection", "completed"];

/** "12 Nov" in the business's time. */
export const shortDay = (at: Date, timeZone: string) => at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone });

export function openItems(profile: Profile): OpenItem[] {
  const items: OpenItem[] = [];
  for (const lead of profile.leads) {
    if (lead.status !== "new" && lead.status !== "contacted") continue;
    items.push(lead.kind === "callback"
      ? { kind: "callback", ref: String(lead.id), text: `Asked for a call back${lead.interest ? ` about ${lead.interest}` : ""}`, at: lead.createdAt }
      : { kind: "request", ref: String(lead.id), text: lead.interest ? `Asked for ${lead.interest}` : "Left their details", at: lead.createdAt });
  }
  for (const booking of profile.bookings) {
    if (BOOKING_OPEN[booking.status]) items.push({ kind: "booking", ref: booking.id, text: `Booking ${booking.reference} (${booking.what}): ${BOOKING_OPEN[booking.status]}`, at: booking.createdAt });
  }
  for (const order of profile.orders) {
    if (ORDER_OPEN[order.status] || order.conflict) items.push({ kind: "order", ref: order.id, text: `Order ${order.reference}: ${order.conflict ? "needs the team" : ORDER_OPEN[order.status]}`, at: order.createdAt });
  }
  for (const chat of profile.chats) {
    if (chat.withTeam) items.push({ kind: "chat", ref: chat.id, text: "A chat waiting for the team", at: chat.lastAt });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** When they last stayed or bought, if they have. */
function lastPurchase(profile: Profile): { at: Date; what: "stayed" | "bought" } | null {
  const stays = profile.bookings.filter((booking) => BOOKED.includes(booking.status)).map((booking) => ({ at: booking.startsAt ?? new Date(`${booking.checkOut}T12:00:00Z`), what: "stayed" as const }));
  const buys = profile.orders.filter((order) => BOUGHT.includes(order.status)).map((order) => ({ at: order.completedAt ?? order.createdAt, what: "bought" as const }));
  return [...stays, ...buys].sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
}

export function followUps(profile: Profile, now: Date, timeZone: string): FollowUp[] {
  const since = profile.customer.followedUpAt?.getTime() ?? 0;
  const out: FollowUp[] = [];
  const madeAfter = (at: Date) => [...profile.bookings, ...profile.orders].some((record) => record.createdAt.getTime() >= at.getTime() - 60_000);

  // Asked in the last month (but not today) and hasn't booked or ordered since.
  const asked = [...profile.chats.map((chat) => chat.startedAt), ...profile.leads.map((lead) => lead.createdAt)]
    .filter((at) => at.getTime() > since && now.getTime() - at.getTime() > DAY && now.getTime() - at.getTime() < 30 * DAY)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (asked && !madeAfter(asked) && !openItems(profile).length) out.push({ kind: "no_purchase", text: `Asked on ${shortDay(asked, timeZone)} and hasn't booked or ordered since.`, at: asked });

  // Let something lapse unpaid in the last month, and nothing since.
  const lapsed = [...profile.bookings.map((booking) => ({ ...booking, label: "Booking" })), ...profile.orders.map((order) => ({ ...order, label: "Order" }))]
    .filter((record) => record.status === "expired" && record.createdAt.getTime() > since && now.getTime() - record.createdAt.getTime() < 30 * DAY)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (lapsed && !madeAfter(new Date(lapsed.createdAt.getTime() + 120_000))) out.push({ kind: "lapsed", text: `${lapsed.label} ${lapsed.reference} lapsed unpaid on ${shortDay(lapsed.createdAt, timeZone)}.`, at: lapsed.createdAt });

  // A past customer quiet for two months.
  const last = lastPurchase(profile);
  const lastContact = Math.max(0, ...profile.chats.map((chat) => chat.lastAt.getTime()), ...profile.leads.map((lead) => lead.createdAt.getTime()));
  const quiet = last ? now.getTime() - last.at.getTime() : 0;
  // Two months to a year since, no word from them after it, and not already followed up since it came due.
  if (last && quiet > 60 * DAY && quiet < 365 * DAY && lastContact <= last.at.getTime() + 3 * DAY && since < last.at.getTime() + 60 * DAY) {
    out.push({ kind: "come_back", text: `Last ${last.what} on ${shortDay(last.at, timeZone)}: a good moment to invite them back.`, at: last.at });
  }
  return out;
}

/** What they've paid the business, per currency: "KSh 12,400". */
export function paidSoFar(profile: Profile): string[] {
  const totals = new Map<string, number>();
  for (const record of [...profile.bookings, ...profile.orders]) if (record.paidMinor > 0) totals.set(record.currency, (totals.get(record.currency) ?? 0) + record.paidMinor);
  return [...totals].map(([currency, minor]) => formatMoney(minor, currency));
}

// src/owner/changes.ts
//
// A change the team asks for on WhatsApp, prepared and only then applied.
// Preparing it (prepare*) checks it, works out what it will affect, and
// writes it to owner_changes as pending, with a summary in plain words. It
// is applied only when the same person replies YES within 30 minutes
// (applyChange), and only if nothing it depends on moved meanwhile: a price
// that changed since, an area already removed. Every change, applied or not,
// stays in the log with who decided it.
//
//   price           an item's price (a range becomes one price)
//   stock           in or out of stock, or how many are left
//   new_item        a new item or service in the catalogue
//   closed_days     "we're full": days Zaina stops offering
//   delivery_area   stop delivering to an area, add one, change its fee
//   whats_on        post today's special or an event to What's on, or take one down

import { toMinor, formatMoney } from "../booking/money.ts";
import { markFull } from "../booking/mark-full.ts";
import { addDays, isoDate, parseDate } from "../booking/pricing.ts";
import { updateBusinessSettings } from "../businesses/settings.ts";
import { businessCapabilities } from "../capabilities/of-business.ts";
import type { Business, OrderSettings, PriceItem } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { getOrderSettings, validateOrderSettings } from "../orders/settings.ts";
import { addWhatsOn, checkWhatsOn, listWhatsOn, localDay, removeWhatsOn, whenOf } from "../whats-on/whats-on.ts";
import { createPriceItem, getPriceItem, listPriceItems, priceText, updatePriceItem, validatePriceItem, type PriceItemValues } from "../prices/price-list.ts";

export type ChangeKind = "price" | "stock" | "new_item" | "closed_days" | "delivery_area" | "whats_on";
export const CHANGE_MINUTES = 30;
const OPEN_ORDER = "('requested', 'awaiting_payment', 'confirmed', 'out_for_delivery', 'ready_for_collection')";

export type Prepared = { ok: true; kind: ChangeKind; payload: Record<string, unknown>; summary: string } | { ok: false; error: string; message: string };
const refuse = (error: string, message: string): Prepared => ({ ok: false, error, message });
const money = (minor: number, currency: string) => formatMoney(minor, currency);

const valuesOf = (item: PriceItem): PriceItemValues => ({
  section: item.section, name: item.name, description: item.description, priceMinor: item.priceMinor, priceMaxMinor: item.priceMaxMinor,
  currency: item.currency, unit: item.unit, status: item.status, sortOrder: item.sortOrder, available: item.available, url: item.url,
  imageUrl: item.imageUrl, stockQuantity: item.stockQuantity,
});

async function openOrdersWith(businessId: string, itemId: string): Promise<number> {
  return inBusiness(async (_db, client) => (await client.query<{ n: number }>(
    `select count(*)::int as n from orders where business_id = $1 and status in ${OPEN_ORDER} and lines @> $2::jsonb`,
    [businessId, JSON.stringify([{ itemId }])])).rows[0].n, businessId);
}

async function activeItem(businessId: string, id: unknown): Promise<PriceItem | Prepared> {
  const item = typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? await getPriceItem(businessId, id) : undefined;
  if (!item || item.status !== "active") return refuse("unknown_item", "No such item: find it with find_items and use its id.");
  return item;
}
const feedNote = (item: PriceItem) => (item.source === "feed" ? "\nNote: this item comes from your own system's product feed. Its next daily refresh puts the feed's value back: change it there too." : "");

// ── Preparing ─────────────────────────────────────────────────────────

export async function preparePrice(business: Business, args: any): Promise<Prepared> {
  const item = await activeItem(business.id, args?.item_id);
  if ("ok" in item) return item;
  const price = toMinor(args?.price);
  if (price === null) return refuse("price_required", "The new price, like 450.");
  if (price === item.priceMinor && item.priceMaxMinor === null) return refuse("same_price", `${item.name} is already ${priceText(item)}.`);
  const open = await openOrdersWith(business.id, item.id);
  return {
    ok: true, kind: "price",
    payload: { itemId: item.id, priceMinor: price, beforeMinor: item.priceMinor, beforeMaxMinor: item.priceMaxMinor },
    summary: [
      `Change the price of ${item.name}: ${priceText(item)} → ${priceText({ ...item, priceMinor: price, priceMaxMinor: null })}.`,
      `Zaina quotes the new price from now on. ${open ? `${open} open order${open === 1 ? "" : "s"} with it keep the price they were placed at.` : "No open orders include it."}${feedNote(item)}`,
    ].join("\n"),
  };
}

export async function prepareStock(business: Business, args: any): Promise<Prepared> {
  const item = await activeItem(business.id, args?.item_id);
  if ("ok" in item) return item;
  const available = typeof args?.in_stock === "boolean" ? args.in_stock : item.available;
  const left = args?.left === null ? null : args?.left === undefined ? item.stockQuantity : Number(args.left);
  if (left !== null && (!Number.isInteger(left) || left < 0 || left > 1_000_000)) return refuse("left_invalid", "How many are left is a whole number.");
  if (available === item.available && left === item.stockQuantity) return refuse("no_change", `${item.name} is already ${item.available ? "in stock" : "out of stock"}${item.stockQuantity !== null ? `, ${item.stockQuantity} left` : ""}.`);
  const words = (on: boolean, count: number | null) => (!on || count === 0 ? "out of stock" : count === null ? "in stock" : `${count} left`);
  const out = !available || left === 0;
  return {
    ok: true, kind: "stock",
    payload: { itemId: item.id, available, left, beforeAvailable: item.available, beforeLeft: item.stockQuantity },
    summary: [
      `${item.name}: ${words(item.available, item.stockQuantity)} → ${words(available, left)}.`,
      out ? "Zaina tells customers it's out and stops taking orders for it. Orders already placed keep their items." : "Zaina offers it again from now on.",
    ].join("\n") + feedNote(item),
  };
}

export async function prepareNewItem(business: Business, args: any): Promise<Prepared> {
  const checked = validatePriceItem({
    name: args?.name, price: args?.price, unit: args?.unit ?? null, section: args?.section ?? null, description: args?.description ?? null,
    ...(args?.price_max !== undefined ? { price_max: args.price_max } : {}),
  });
  if (!checked.ok) return refuse("invalid_item", checked.error);
  const existing = (await listPriceItems(business.id)).find((item) => item.name.toLowerCase() === checked.value.name.toLowerCase());
  if (existing) return refuse("already_listed", `${existing.name} is already listed at ${priceText(existing)}: change its price instead.`);
  const { enabled } = await businessCapabilities(business);
  return {
    ok: true, kind: "new_item",
    payload: { item: checked.value },
    summary: [
      `Add to your catalogue: ${checked.value.name}, ${priceText(checked.value)}${checked.value.section ? ` (in ${checked.value.section})` : ""}.`,
      `Zaina can quote it${enabled.includes("orders") ? " and take orders for it" : ""} at once. A photo and description can be added in the dashboard.`,
    ].join("\n"),
  };
}

export async function prepareClosedDays(business: Business, args: any): Promise<Prepared> {
  const from = String(args?.from ?? "");
  const start = parseDate(from);
  if (!start) return refuse("date_required", "Which day, as YYYY-MM-DD.");
  const until = args?.until ? String(args.until) : isoDate(addDays(start, 1));
  const end = parseDate(until);
  if (!end || end <= start || (end.getTime() - start.getTime()) / 86_400_000 > 92) return refuse("invalid_dates", "until is the first day open again, after from, within three months.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: business.timeZone }).format(new Date());
  if (from < today) return refuse("past_date", "That day has passed.");
  const { enabled } = await businessCapabilities(business);
  if (!enabled.some((capability) => capability === "rooms" || capability === "tables" || capability === "appointments")) return refuse("no_bookings", "This business doesn't take bookings through Zaina.");
  const rooms = enabled.includes("rooms");
  const booked = await inBusiness(async (_db, client) => (await client.query<{ n: number }>(
    rooms
      ? "select count(*)::int as n from bookings where business_id = $1 and status in ('confirmed', 'held', 'awaiting_payment', 'requested') and starts_at is null and check_in < $3::date and check_out > $2::date"
      : `select count(*)::int as n from bookings where business_id = $1 and status in ('confirmed', 'held', 'awaiting_payment', 'requested') and starts_at is not null
           and starts_at >= ($2::date::timestamp at time zone $4) and starts_at < ($3::date::timestamp at time zone $4)`,
    rooms ? [business.id, from, until] : [business.id, from, until, business.timeZone])).rows[0].n, business.id);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const day = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const reason = typeof args?.reason === "string" && args.reason.trim() ? args.reason.trim().slice(0, 200) : "Full";
  return {
    ok: true, kind: "closed_days",
    payload: { from, until, reason },
    summary: [
      `Mark ${days === 1 ? day(from) : `${day(from)} to ${day(isoDate(addDays(end, -1)))} (${days} days)`} as full: ${rooms ? "every room type" : "the whole business"}.`,
      `Zaina stops offering ${days === 1 ? "that day" : "those days"}. ${booked ? `${booked} booking${booked === 1 ? "" : "s"} already in ${days === 1 ? "it" : "them"} stay as they are.` : "No bookings are affected."} Reopen it in the dashboard if plans change.`,
    ].join("\n"),
  };
}

export async function prepareDeliveryArea(business: Business, args: any): Promise<Prepared> {
  const settings = await getOrderSettings(business.id);
  const action = args?.action;
  const area = typeof args?.area === "string" ? args.area.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (!area) return refuse("area_required", "Which area?");
  const zone = settings.zones.find((entry) => entry.name.toLowerCase() === area.toLowerCase());
  const list = settings.zones.map((entry) => entry.name).join(", ") || "none";
  if (action === "remove") {
    if (!zone) return refuse("unknown_area", `You don't deliver to ${area}. Your areas: ${list}.`);
    const rest = settings.zones.filter((entry) => entry !== zone);
    if (!rest.length && !settings.collection) return refuse("last_way", "That's the last area and customers can't collect: add collection or another area first, in the dashboard.");
    const open = await inBusiness(async (_db, client) => (await client.query<{ n: number }>(
      `select count(*)::int as n from orders where business_id = $1 and status in ${OPEN_ORDER} and fulfilment = 'delivery' and lower(zone) = lower($2)`, [business.id, zone.name])).rows[0].n, business.id);
    return {
      ok: true, kind: "delivery_area", payload: { action, area: zone.name, beforeFeeMinor: zone.feeMinor },
      summary: [
        `Stop delivering to ${zone.name} (fee ${zone.feeMinor ? formatMoney(zone.feeMinor, "KES") : "free"}).${rest.length ? "" : " That's your last area: delivery turns off."}`,
        `Customers there are offered ${settings.collection ? "collection instead" : "another area"}. ${open ? `${open} open order${open === 1 ? "" : "s"} to ${zone.name} still go out.` : "No open orders go there."}`,
      ].join("\n"),
    };
  }
  const fee = toMinor(args?.fee ?? "");
  if (fee === null) return refuse("fee_required", `The delivery fee for ${area}, like 200 (0 for free).`);
  if (action === "add") {
    if (zone) return refuse("already_area", `You already deliver to ${zone.name} for ${formatMoney(zone.feeMinor, "KES")}.`);
    return {
      ok: true, kind: "delivery_area", payload: { action, area, feeMinor: fee },
      summary: `Deliver to ${area} for ${fee ? formatMoney(fee, "KES") : "free"}.${settings.delivery ? "" : " Delivery turns on."}\nZaina offers it to customers there at once and adds the fee to their orders.`,
    };
  }
  if (action === "change_fee") {
    if (!zone) return refuse("unknown_area", `You don't deliver to ${area}. Your areas: ${list}.`);
    if (zone.feeMinor === fee) return refuse("same_fee", `Delivery to ${zone.name} is already ${formatMoney(fee, "KES")}.`);
    return {
      ok: true, kind: "delivery_area", payload: { action, area: zone.name, feeMinor: fee, beforeFeeMinor: zone.feeMinor },
      summary: `Delivery to ${zone.name}: ${zone.feeMinor ? formatMoney(zone.feeMinor, "KES") : "free"} → ${fee ? formatMoney(fee, "KES") : "free"}.\nNew orders pay the new fee; orders already placed keep theirs.`,
    };
  }
  return refuse("action_required", "remove, add or change_fee.");
}

// ── Pending, applied, cancelled ───────────────────────────────────────

/** Saves a prepared change as pending (replacing any this person had waiting); its id. */
export async function savePending(businessId: string, userId: string, prepared: Extract<Prepared, { ok: true }>, now = new Date()): Promise<string> {
  return inBusiness(async (_db, client) => {
    await client.query("update owner_changes set status = 'cancelled', result = 'Replaced by a newer change', decided_at = now() where business_id = $1 and user_id = $2 and status = 'pending'", [businessId, userId]);
    const { rows: [row] } = await client.query<{ id: string }>(
      "insert into owner_changes (business_id, user_id, kind, payload, summary, expires_at) values ($1, $2, $3, $4, $5, $6) returning id",
      [businessId, userId, prepared.kind, JSON.stringify(prepared.payload), prepared.summary.slice(0, 1000), new Date(now.getTime() + CHANGE_MINUTES * 60_000)]);
    return row.id;
  }, businessId);
}

/** Posting to What's on: "Karaoke tonight from 8pm", "Today's special: grilled tilapia, 1,200", "Live band every Friday". */
export async function prepareWhatsOn(business: Business, args: any): Promise<Prepared> {
  const today = localDay(business.timeZone);
  const checked = checkWhatsOn(args ?? {}, today);
  if (!checked.ok) return refuse("invalid_whats_on", checked.error);
  return {
    ok: true, kind: "whats_on",
    payload: { action: "add", value: checked.value },
    summary: `Post to What's on, ${whenOf(checked.value, today)}:\n"${checked.value.text}"\nGuests see it on your page, and Zaina mentions it.`,
  };
}

export async function prepareRemoveWhatsOn(business: Business, args: any): Promise<Prepared> {
  const id = String(args?.id ?? "");
  const entry = (await listWhatsOn(business)).find((item) => item.id === id);
  if (!entry) return refuse("not_found", "That isn't on What's on (whats_on lists what is, with ids).");
  return { ok: true, kind: "whats_on", payload: { action: "remove", id, text: entry.text }, summary: `Take down from What's on (${whenOf(entry, localDay(business.timeZone))}):\n"${entry.text}"` };
}

export type PendingChange = { id: string; kind: ChangeKind; payload: any; summary: string; expiresAt: Date };

/** This person's change waiting for YES; one past its time is marked expired. */
export async function pendingChange(businessId: string, userId: string, now = new Date()): Promise<PendingChange | null> {
  return inBusiness(async (_db, client) => {
    await client.query("update owner_changes set status = 'expired', decided_at = now() where business_id = $1 and user_id = $2 and status = 'pending' and expires_at <= $3", [businessId, userId, now]);
    const { rows: [row] } = await client.query("select id, kind, payload, summary, expires_at from owner_changes where business_id = $1 and user_id = $2 and status = 'pending' order by created_at desc limit 1", [businessId, userId]);
    return row ? { id: row.id, kind: row.kind, payload: row.payload, summary: row.summary, expiresAt: row.expires_at } : null;
  }, businessId);
}

export async function decide(businessId: string, id: string, status: "applied" | "cancelled" | "failed", result: string): Promise<void> {
  await inBusiness((_db, client) => client.query("update owner_changes set status = $3, result = $4, decided_at = now() where business_id = $1 and id = $2 and status = 'pending'", [businessId, id, status, result.slice(0, 500)]), businessId);
}

/** Applies a confirmed change, if what it depends on is as it was; what to tell the person. */
export async function applyChange(business: Business, change: PendingChange, userId: string): Promise<{ ok: boolean; message: string }> {
  const p = change.payload;
  const moved = (message: string) => ({ ok: false, message: `${message} Nothing was changed: ask again if you still want it.` });
  switch (change.kind) {
    case "price": {
      const item = await getPriceItem(business.id, p.itemId);
      if (!item || item.status !== "active") return moved("That item is no longer in the catalogue.");
      if (item.priceMinor !== p.beforeMinor || item.priceMaxMinor !== p.beforeMaxMinor) return moved(`${item.name}'s price changed meanwhile: it's now ${priceText(item)}.`);
      await updatePriceItem(business.id, item.id, { ...valuesOf(item), priceMinor: p.priceMinor, priceMaxMinor: null }, userId);
      return { ok: true, message: `Done: ${item.name} is now ${priceText({ ...item, priceMinor: p.priceMinor, priceMaxMinor: null })}.` };
    }
    case "stock": {
      const item = await getPriceItem(business.id, p.itemId);
      if (!item || item.status !== "active") return moved("That item is no longer in the catalogue.");
      if (item.available !== p.beforeAvailable || item.stockQuantity !== p.beforeLeft) return moved(`${item.name}'s stock changed meanwhile.`);
      await updatePriceItem(business.id, item.id, { ...valuesOf(item), available: p.available, stockQuantity: p.left }, userId);
      return { ok: true, message: `Done: ${item.name} is ${!p.available || p.left === 0 ? "out of stock" : p.left === null ? "in stock" : `in stock, ${p.left} left`}.` };
    }
    case "new_item": {
      const created = await createPriceItem(business.id, p.item, userId);
      if (created === "name_taken") return moved(`${p.item.name} was added meanwhile.`);
      if (created === "too_many") return moved("The catalogue is full.");
      return { ok: true, message: `Done: ${created.name} is in your catalogue at ${priceText(created)}.` };
    }
    case "closed_days": {
      const result = await markFull(business, { from: p.from, until: p.until, reason: p.reason, userId });
      if (!result.ok) return moved(result.message);
      return { ok: true, message: `Done: Zaina won't offer ${p.from}${addDays(parseDate(p.from)!, 1).getTime() === parseDate(p.until)!.getTime() ? "" : ` to the day before ${p.until}`}. Reopen it in the dashboard if plans change.` };
    }
    case "whats_on": {
      if (p.action === "remove") {
        const removed = await removeWhatsOn(business, p.id);
        return removed ? { ok: true, message: `Done: "${p.text}" is off What's on.` } : moved("That was already taken down.");
      }
      const added = await addWhatsOn(business, p.value, userId);
      if (added === "too_many") return moved("What's on is full: take down something that's over first.");
      return { ok: true, message: `Done: it's on your page, and Zaina will mention it to guests.` };
    }
    case "delivery_area": {
      const settings = await getOrderSettings(business.id);
      const zone = settings.zones.find((entry) => entry.name.toLowerCase() === String(p.area).toLowerCase());
      let next: Partial<OrderSettings> & { zones: OrderSettings["zones"] };
      if (p.action === "remove") {
        if (!zone || zone.feeMinor !== p.beforeFeeMinor) return moved(`${p.area} changed meanwhile.`);
        const zones = settings.zones.filter((entry) => entry !== zone);
        next = { zones, delivery: zones.length > 0 && settings.delivery };
      } else if (p.action === "add") {
        if (zone) return moved(`${zone.name} was added meanwhile.`);
        next = { zones: [...settings.zones, { name: p.area, feeMinor: p.feeMinor }], delivery: true };
      } else {
        if (!zone || zone.feeMinor !== p.beforeFeeMinor) return moved(`${p.area}'s fee changed meanwhile.`);
        next = { zones: settings.zones.map((entry) => (entry === zone ? { ...entry, feeMinor: p.feeMinor } : entry)) };
      }
      const checked = validateOrderSettings({}, { ...settings, ...next });
      if (!checked.ok) return moved(checked.error);
      await updateBusinessSettings(business.id, { orderSettings: checked.value }, userId);
      return { ok: true, message: p.action === "remove" ? `Done: no more deliveries to ${p.area}.` : p.action === "add" ? `Done: you now deliver to ${p.area}.` : `Done: delivery to ${p.area} is now ${p.feeMinor ? money(p.feeMinor, "KES") : "free"}.` };
    }
  }
}

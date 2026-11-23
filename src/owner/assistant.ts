// src/owner/assistant.ts
//
// The team running the business from WhatsApp. A team member whose number is
// linked (staff_whatsapp) writes to the business's own WhatsApp number; their
// messages come here instead of becoming a customer's chat.
//
//   LINK 123456     the code from the dashboard (Settings → Manage from
//                   WhatsApp), sent from their own phone: links that number
//   YES / NO        apply or cancel the change waiting for them. This is
//                   decided here, by the server, never by the model: Zaina
//                   can prepare a change, she can't apply one
//   anything else   Zaina, as the team's assistant: questions about the
//                   business answered from the records (orders today,
//                   prices, delivery areas), and changes prepared with what
//                   they'll affect (changes.ts)
//
// Changing anything needs a manager or owner, checked when it's prepared and
// again when it's applied. Every change is logged with who said YES or NO.

import { randomInt } from "node:crypto";
import { Type, type FunctionDeclaration } from "@google/genai";
import { formatMoney } from "../booking/money.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { businessCapabilities } from "../capabilities/of-business.ts";
import type { WhatsappContext } from "../channels/whatsapp/context.ts";
import { splitMessage, toWhatsappText } from "../channels/whatsapp/format.ts";
import { sendText } from "../channels/whatsapp/graph.ts";
import { connectionFor } from "../channels/whatsapp/numbers.ts";
import type { InboundMessage } from "../channels/whatsapp/webhook.ts";
import type { Business } from "../db/schema.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { getOrderSettings } from "../orders/settings.ts";
import { listPriceItems, priceText } from "../prices/price-list.ts";
import { matchPriceItems } from "../prices/tool.ts";
import { ROLE_RANK } from "../staff/auth.ts";
import {
  applyChange, CHANGE_MINUTES, decide, pendingChange, prepareClosedDays, prepareDeliveryArea, prepareNewItem, preparePrice, prepareRemoveWhatsOn, prepareStock, prepareWhatsOn, savePending, type Prepared,
} from "./changes.ts";
import { refusedThinking, thinkingConfigFor } from "../engine/agent.ts";
import { listWhatsOn, localDay, whenOf } from "../whats-on/whats-on.ts";

type Staff = { userId: string; name: string; role: string };

const YES = /^(yes|y|yes please|ndio|ndiyo|confirm|apply|sawa)[.! ]*$/i;
const NO = /^(no|n|hapana|cancel|stop|don'?t)[.! ]*$/i;
const LINK = /^\s*link\s+(\d{6})\s*$/i;

// ── Linking a number ──────────────────────────────────────────────────

/** A fresh code for this team member to send from their phone (15 minutes). */
export async function newLinkCode(businessId: string, userId: string): Promise<{ code: string; expiresAt: Date }> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await inBusiness((_db, client) => client.query(
    `insert into staff_whatsapp (business_id, user_id, link_code, link_expires_at) values ($1, $2, $3, $4)
     on conflict (business_id, user_id) do update set link_code = $3, link_expires_at = $4`, [businessId, userId, code, expiresAt]), businessId);
  return { code, expiresAt };
}

export async function linkedNumber(businessId: string, userId: string): Promise<{ address: string | null; code: string | null; expiresAt: Date | null }> {
  return inBusiness(async (_db, client) => {
    const { rows: [row] } = await client.query("select address, link_code, link_expires_at from staff_whatsapp where business_id = $1 and user_id = $2", [businessId, userId]);
    const live = row?.link_code && row.link_expires_at > new Date();
    return { address: row?.address ?? null, code: live ? row.link_code : null, expiresAt: live ? row.link_expires_at : null };
  }, businessId);
}

export async function unlinkNumber(businessId: string, userId: string): Promise<void> {
  await inBusiness((_db, client) => client.query("delete from staff_whatsapp where business_id = $1 and user_id = $2", [businessId, userId]), businessId);
}

/** The team member this number belongs to, while they still work for the business. */
async function staffForNumber(businessId: string, address: string): Promise<Staff | null> {
  return inBusiness(async (_db, client) => {
    const { rows: [row] } = await client.query<{ user_id: string; name: string; role: string }>(
      `select w.user_id, u.name, m.role from staff_whatsapp w
       join staff_memberships m on m.business_id = w.business_id and m.user_id = w.user_id
       join staff_users u on u.id = w.user_id and u.disabled_at is null
       where w.business_id = $1 and w.address = $2`, [businessId, address]);
    return row ? { userId: row.user_id, name: row.name, role: row.role } : null;
  }, businessId);
}

// ── Sending and remembering ───────────────────────────────────────────

async function reply(ctx: WhatsappContext, business: Business, staff: Staff | null, address: string, text: string): Promise<void> {
  const connection = await connectionFor(business.id);
  if (!connection) return;
  const target = { version: ctx.whatsapp.graphVersion, phoneNumberId: connection.phoneNumberId, accessToken: connection.accessToken };
  for (const part of splitMessage(toWhatsappText(text))) {
    const sent = await sendText(target, address, part);
    if (!sent.ok) {
      console.warn(`[owner] ${business.id}: a reply to a team member wasn't sent`);
      break;
    }
  }
  if (staff) await remember(business.id, staff.userId, "zaina", text, null);
}

/** Keeps a message; false when WhatsApp sent this one before. */
async function remember(businessId: string, userId: string, role: "owner" | "zaina", content: string, messageId: string | null): Promise<boolean> {
  return inBusiness(async (_db, client) => (await client.query(
    "insert into owner_messages (business_id, user_id, role, content, message_id) values ($1, $2, $3, $4, $5) on conflict do nothing returning id",
    [businessId, userId, role, content.slice(0, 4000), messageId])).rowCount === 1, businessId);
}

// ── The entry point, from the WhatsApp webhook ────────────────────────

/** True when a message is for the team's assistant (a link code, or a linked team member), and it's handled here. */
export async function takeOwnerMessage(ctx: WhatsappContext, business: Business, message: InboundMessage): Promise<boolean> {
  const link = message.kind === "text" && message.text ? LINK.exec(message.text) : null;
  if (link) {
    void runForBusiness(business.id, () => linkFrom(ctx, business, message.from, link[1])).catch((error) => console.error("[owner] linking failed:", error));
    return true;
  }
  const staff = await staffForNumber(business.id, message.from);
  if (!staff) return false;
  void runForBusiness(business.id, () => answerOwner(ctx, business, staff, message)).catch((error) => console.error("[owner] answering failed:", error));
  return true;
}

async function linkFrom(ctx: WhatsappContext, business: Business, address: string, code: string): Promise<void> {
  const verdict = await consumeLimits([{ key: `owner-link:${business.id}:${address}`, limit: 5, windowSeconds: 3600 }]);
  if (!verdict.allowed) return;
  const linked = await inBusiness(async (_db, client) => {
    const { rows: [row] } = await client.query<{ user_id: string }>(
      "select user_id from staff_whatsapp where business_id = $1 and link_code = $2 and link_expires_at > now()", [business.id, code]);
    if (!row) return null;
    // A number belongs to one team member at a time.
    await client.query("update staff_whatsapp set address = null where business_id = $1 and address = $2 and user_id <> $3", [business.id, address, row.user_id]);
    await client.query("update staff_whatsapp set address = $3, linked_at = now(), link_code = null, link_expires_at = null where business_id = $1 and user_id = $2", [business.id, row.user_id, address]);
    return row.user_id;
  }, business.id);
  if (!linked) {
    await reply(ctx, business, null, address, "That code isn't valid or has expired. Get a new one in the dashboard: Settings → Manage from WhatsApp.");
    return;
  }
  const staff = await staffForNumber(business.id, address);
  await reply(ctx, business, staff, address, `Linked. This number now manages ${business.name} with Zaina. Try "How many orders today?" or "Change the price of chicken to 450". Nothing changes until you reply YES.`);
}

async function answerOwner(ctx: WhatsappContext, business: Business, staff: Staff, message: InboundMessage): Promise<void> {
  const text = (message.text ?? "").trim();
  if (!(await remember(business.id, staff.userId, "owner", text || `(${message.kind})`, message.messageId))) return;
  const address = message.from;
  if (!text) return reply(ctx, business, staff, address, "I can read text messages here for now.");

  // YES and NO are the server's to decide, for the change waiting for this person.
  if (YES.test(text) || NO.test(text)) {
    const change = await pendingChange(business.id, staff.userId);
    if (!change) return reply(ctx, business, staff, address, "There's nothing waiting for a yes or no. Tell me what you'd like to change.");
    if (NO.test(text)) {
      await decide(business.id, change.id, "cancelled", "Cancelled by NO");
      return reply(ctx, business, staff, address, "Cancelled: nothing was changed.");
    }
    if (ROLE_RANK[staff.role as keyof typeof ROLE_RANK] < ROLE_RANK.manager) {
      await decide(business.id, change.id, "failed", "Needs a manager");
      return reply(ctx, business, staff, address, "Only a manager or the owner can make changes. Nothing was changed.");
    }
    const result = await applyChange(business, change, staff.userId).catch((error) => {
      console.error(`[owner] ${business.id}: applying a change failed:`, error);
      return { ok: false, message: "Something went wrong, so nothing was changed. Please try again, or use the dashboard." };
    });
    await decide(business.id, change.id, result.ok ? "applied" : "failed", result.message);
    return reply(ctx, business, staff, address, result.message);
  }

  const answer = await runAssistant(ctx, business, staff);
  return reply(ctx, business, staff, address, answer);
}

// ── Zaina as the team's assistant ─────────────────────────────────────

const declarations: FunctionDeclaration[] = [
  { name: "business_numbers", description: "Orders, payments, bookings, chats and requests for a period, from the records.", parameters: { type: Type.OBJECT, properties: { period: { type: Type.STRING, enum: ["today", "yesterday", "this_week", "this_month"] } }, required: ["period"] } },
  { name: "find_items", description: "Catalogue items matching words (or all, without), with their ids, prices and stock.", parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING } } } },
  { name: "list_orders", description: "Orders: those waiting for the team, those in progress, or today's.", parameters: { type: Type.OBJECT, properties: { which: { type: Type.STRING, enum: ["needs_you", "in_progress", "today"] } }, required: ["which"] } },
  { name: "delivery_settings", description: "The delivery areas and their fees, collection, the smallest order.", parameters: { type: Type.OBJECT, properties: {} } },
  { name: "prepare_price_change", description: "Prepare a new price for a catalogue item (its id from find_items). Shows what changes; applied only if they reply YES.", parameters: { type: Type.OBJECT, properties: { item_id: { type: Type.STRING }, price: { type: Type.NUMBER, description: "The new price, in the item's currency (450, not 45000)." } }, required: ["item_id", "price"] } },
  { name: "prepare_stock_change", description: "Prepare an item going out of stock or back in, or how many are left. Applied only if they reply YES.", parameters: { type: Type.OBJECT, properties: { item_id: { type: Type.STRING }, in_stock: { type: Type.BOOLEAN }, left: { type: Type.INTEGER, description: "How many are left, if they said." } }, required: ["item_id"] } },
  { name: "prepare_new_item", description: "Prepare a new product or service in the catalogue. Applied only if they reply YES.", parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, price: { type: Type.NUMBER }, price_max: { type: Type.NUMBER, description: "Only for a range: the highest price." }, unit: { type: Type.STRING, description: "What the price is per: per plate, per kg, per person." }, section: { type: Type.STRING }, description: { type: Type.STRING } }, required: ["name", "price"] } },
  { name: "prepare_closed_days", description: "Prepare marking days as full (no bookings offered), like \"we're fully booked tomorrow\". Applied only if they reply YES.", parameters: { type: Type.OBJECT, properties: { from: { type: Type.STRING, description: "The first full day, YYYY-MM-DD." }, until: { type: Type.STRING, description: "The first day open again, YYYY-MM-DD (the next day, for one day)." }, reason: { type: Type.STRING } }, required: ["from"] } },
  { name: "whats_on", description: "What's on: today's specials and events, what's coming up, and every week's, with their ids.", parameters: { type: Type.OBJECT, properties: {} } },
  { name: "prepare_whats_on", description: "Prepare posting to What's on: today's special, an event (karaoke tonight, a live band on Friday), an offer. Guests see it on the business's page and Zaina tells them about it. Applied only if they reply YES.", parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "What's on, in their words, up to 200 characters" }, date: { type: Type.STRING, description: "The day, YYYY-MM-DD (today if not given)" }, until: { type: Type.STRING, description: "The last day, YYYY-MM-DD, for a run of days" }, weekday: { type: Type.INTEGER, description: "For every week: 0 Sunday to 6 Saturday (no date then)" } }, required: ["text"] } },
  { name: "prepare_remove_whats_on", description: "Prepare taking something down from What's on (its id from whats_on). Applied only if they reply YES.", parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ["id"] } },
  { name: "prepare_delivery_area_change", description: "Prepare removing a delivery area, adding one, or changing its fee. Applied only if they reply YES.", parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, enum: ["remove", "add", "change_fee"] }, area: { type: Type.STRING }, fee: { type: Type.NUMBER } }, required: ["action", "area"] } },
];

const PREPARERS: Record<string, (business: Business, args: any) => Promise<Prepared>> = {
  prepare_price_change: preparePrice,
  prepare_stock_change: prepareStock,
  prepare_new_item: prepareNewItem,
  prepare_closed_days: prepareClosedDays,
  prepare_delivery_area_change: prepareDeliveryArea,
  prepare_whats_on: prepareWhatsOn,
  prepare_remove_whats_on: prepareRemoveWhatsOn,
};

/** A period in the business's time: [from, to). */
async function periodBounds(business: Business, period: string): Promise<{ from: Date; to: Date; label: string }> {
  return inBusiness(async (_db, client) => {
    const unit = period === "this_week" ? "week" : period === "this_month" ? "month" : "day";
    const { rows: [row] } = await client.query<{ start: Date }>(
      `select (date_trunc($2, now() at time zone $1) - case when $3 then interval '1 day' else interval '0' end) at time zone $1 as start`,
      [business.timeZone, unit, period === "yesterday"]);
    const to = period === "yesterday" ? new Date(row.start.getTime() + 86_400_000) : new Date();
    return { from: row.start, to, label: period.replace("_", " ") };
  }, business.id);
}

async function runTool(business: Business, staff: Staff, name: string, args: any, made: { summary: string | null }): Promise<unknown> {
  if (PREPARERS[name]) {
    if (ROLE_RANK[staff.role as keyof typeof ROLE_RANK] < ROLE_RANK.manager) return { ok: false, error: "needs_manager", message: "Only a manager or the owner can make changes." };
    const prepared = await PREPARERS[name](business, args);
    if (!prepared.ok) return prepared;
    await savePending(business.id, staff.userId, prepared);
    made.summary = prepared.summary;
    return { ok: true, prepared: prepared.summary, next_step: "Tell them in one short line what you've prepared. The summary and the YES/NO question are added to your message by the system: don't repeat them, and never say it's done." };
  }
  if (name === "whats_on") {
    const today = localDay(business.timeZone);
    return { ok: true, today, entries: (await listWhatsOn(business)).map((entry) => ({ id: entry.id, text: entry.text, when: whenOf(entry, today) })) };
  }
  if (name === "find_items") {
    const items = await listPriceItems(business.id, { activeOnly: true });
    const query = typeof args?.query === "string" ? args.query.trim() : "";
    const found = query ? matchPriceItems(items, query) : items.slice(0, 30);
    return { ok: true, items: found.slice(0, 15).map((item) => ({ id: item.id, name: item.name, price: priceText(item), in_stock: item.available && item.stockQuantity !== 0, ...(item.stockQuantity !== null ? { left: item.stockQuantity } : {}), ...(item.source === "feed" ? { from_your_system: true } : {}) })) };
  }
  if (name === "delivery_settings") {
    const settings = await getOrderSettings(business.id);
    return { ok: true, delivery: settings.delivery, areas: settings.zones.map((zone) => ({ area: zone.name, fee: zone.feeMinor ? formatMoney(zone.feeMinor, "KES") : "free" })), collection: settings.collection ? settings.collectionPoint ?? "yes" : "no", smallest_order: settings.minimumMinor ? formatMoney(settings.minimumMinor, "KES") : "none" };
  }
  if (name === "list_orders") {
    const which = args?.which === "in_progress" ? "status in ('awaiting_payment', 'confirmed', 'out_for_delivery', 'ready_for_collection')"
      : args?.which === "today" ? "created_at >= (date_trunc('day', now() at time zone $2) at time zone $2)"
        : "(status = 'requested' or conflict is not null or exists (select 1 from payments p where p.business_id = orders.business_id and p.order_id = orders.id and p.method = 'mpesa_code' and p.status = 'pending'))";
    const rows = await inBusiness(async (_db, client) => (await client.query(
      `select reference, status, customer_name, lines, total_minor, currency, fulfilment, zone, created_at from orders where business_id = $1 and ${which} order by created_at desc limit 10`,
      [business.id, business.timeZone])).rows, business.id);
    return { ok: true, orders: rows.map((row: any) => ({ reference: row.reference, status: row.status.replace(/_/g, " "), customer: row.customer_name, items: row.lines.map((line: any) => `${line.quantity} × ${line.name}`).join(", "), total: formatMoney(Number(row.total_minor), row.currency), how: row.fulfilment === "delivery" ? `delivery to ${row.zone}` : "collection" })) };
  }
  if (name === "business_numbers") {
    const { from, to, label } = await periodBounds(business, String(args?.period ?? "today"));
    const numbers = await inBusiness(async (_db, client) => (await client.query(
      `select
         (select count(*)::int from orders where business_id = $1 and created_at >= $2 and created_at < $3) as orders,
         (select count(*)::int from orders where business_id = $1 and created_at >= $2 and created_at < $3 and status in ('confirmed', 'out_for_delivery', 'ready_for_collection', 'completed')) as orders_confirmed,
         (select count(*)::int from orders where business_id = $1 and created_at >= $2 and created_at < $3 and status = 'awaiting_payment') as orders_waiting_payment,
         (select count(*)::int from bookings where business_id = $1 and created_at >= $2 and created_at < $3) as bookings,
         (select count(*)::int from bookings where business_id = $1 and created_at >= $2 and created_at < $3 and status = 'confirmed') as bookings_confirmed,
         (select count(*)::int from chat_sessions where business_id = $1 and created_at >= $2 and created_at < $3 and not preview) as chats,
         (select count(*)::int from leads where business_id = $1 and created_at >= $2 and created_at < $3) as requests,
         (select coalesce(json_agg(json_build_object('currency', currency, 'minor', minor)), '[]') from (
            select currency, sum(amount_minor) as minor from payments where business_id = $1 and status = 'succeeded' and settled_at >= $2 and settled_at < $3 group by currency) p) as paid`,
      [business.id, from, to])).rows[0], business.id);
    return {
      ok: true, period: label,
      orders: { placed: numbers.orders, confirmed: numbers.orders_confirmed, waiting_for_payment: numbers.orders_waiting_payment },
      bookings: { made: numbers.bookings, confirmed: numbers.bookings_confirmed },
      chats: numbers.chats, requests: numbers.requests,
      verified_payments: (numbers.paid as Array<{ currency: string; minor: number }>).map((entry) => formatMoney(Number(entry.minor), entry.currency)),
      note: "verified_payments are payments that settled; say so, and don't add anything else to them.",
    };
  }
  return { ok: false, error: "unknown_tool" };
}

async function systemPrompt(business: Business, staff: Staff): Promise<string> {
  const settings = await getBusinessSettings(business.id);
  const { enabled } = await businessCapabilities(business);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: business.timeZone }).format(new Date());
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: business.timeZone, weekday: "long" }).format(new Date());
  return [
    `You are Zaina, helping the team of ${settings?.displayName ?? business.name} run the business from WhatsApp. You're talking to ${staff.name.split(" ")[0]}, ${staff.role === "owner" ? "the owner" : `a ${staff.role}`}. Today is ${weekday} ${today} (${business.timeZone}).`,
    `It offers: ${enabled.join(", ") || "answers only"}.`,
    "Answer questions with the read tools: never guess a number. Payments that settled are verified; nothing else is revenue.",
    "When they ask to change something, find what it applies to (find_items for an item's id) and prepare it with the matching prepare_ tool. Nothing changes until they reply YES: never say a change is done. One change at a time.",
    "Today's specials, events and offers (\"Karaoke tonight from 8pm\", \"Today's special: grilled tilapia 1200\", \"Live band every Friday\"): prepare_whats_on, with their words as the text (only tidied: capitals, spelling, KSh before a price). Tonight or today is today's date; a weekday is the next one, or every week when they say every. To take one down, find it with whats_on.",
    ROLE_RANK[staff.role as keyof typeof ROLE_RANK] < ROLE_RANK.manager ? "They can ask questions but can't make changes: changes need a manager or the owner." : "",
    "If something can't be done here (photos, rooms, staff, payments), say where in the dashboard it is. Reply briefly, in their language (English or Swahili).",
  ].filter(Boolean).join("\n");
}

async function runAssistant(ctx: WhatsappContext, business: Business, staff: Staff): Promise<string> {
  const history = await inBusiness(async (_db, client) => (await client.query<{ role: string; content: string }>(
    "select role, content from (select id, role, content from owner_messages where business_id = $1 and user_id = $2 order by id desc limit 12) t order by id", [business.id, staff.userId])).rows, business.id);
  const contents: any[] = history.map((row) => ({ role: row.role === "owner" ? "user" : "model", parts: [{ text: row.content }] }));
  const made = { summary: null as string | null };
  let text = "";
  try {
    const config = { systemInstruction: await systemPrompt(business, staff), tools: [{ functionDeclarations: declarations }] };
    for (let round = 0; round < 4; round += 1) {
      const thinking = thinkingConfigFor(ctx.engine.model, ctx.engine.thinking);
      const request = { model: ctx.engine.model, contents, config: { ...(round < 3 ? config : { systemInstruction: config.systemInstruction }), ...thinking } };
      const response: any = await ctx.engine.ai.models.generateContent(request).catch((error: unknown) => {
        if (!refusedThinking(ctx.engine.model, error, Boolean(thinking))) throw error;
        return ctx.engine.ai.models.generateContent({ ...request, config: round < 3 ? config : { systemInstruction: config.systemInstruction } });
      });
      const content = response.candidates?.[0]?.content;
      const calls = (content?.parts ?? []).filter((part: any) => part.functionCall);
      if (!calls.length) {
        text = (response.text ?? "").trim();
        break;
      }
      contents.push(content);
      const parts: any[] = [];
      for (const part of calls) {
        const result = await runTool(business, staff, part.functionCall.name, part.functionCall.args ?? {}, made).catch((error) => {
          console.error(`[owner] ${business.id}: ${part.functionCall.name} failed:`, error);
          return { ok: false, error: "failed" };
        });
        parts.push({ functionResponse: { name: part.functionCall.name, response: { result } } });
      }
      contents.push({ role: "user", parts });
    }
  } catch (error) {
    console.error(`[owner] ${business.id}: the assistant failed:`, error);
    text = "Sorry, I couldn't do that just now. Please try again in a minute.";
  }
  // The change and its question come from the server, word for word, whatever the model said.
  if (made.summary) text = `${text ? `${text}\n\n` : ""}${made.summary}\n\nReply YES to apply it or NO to cancel (within ${CHANGE_MINUTES} minutes).`;
  return text || "Sorry, I didn't get that. You can ask about today's orders, or tell me a price, stock or delivery change.";
}

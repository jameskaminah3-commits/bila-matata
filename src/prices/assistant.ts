// src/prices/assistant.ts
//
// The menu assistant: the team says what to change in its own words ("raise
// the cocktails by 10%", "tilapia is finished tonight", "add Chicken Tikka,
// 950, to Mains", "write descriptions for the burgers") and gets back the
// exact changes, each before → after, to apply or leave. Nothing changes
// until they apply, and every apply comes with its undo.
//
// The model sees the menu with short refs (i1, i2…), never the item ids, and
// answers in a fixed shape; every change it proposes is checked against the
// menu as it is now, and again when it's applied. Items from the business's
// own system (a product feed) are left out: the feed would undo the change.

import { Type, type Schema } from "@google/genai";
import { formatMoney } from "../booking/money.ts";
import { inBusiness } from "../db/tenant.ts";
import type { PriceItem } from "../db/schema.ts";
import { createPriceItem, deletePriceItem, getPriceItem, listPriceItems, orderPriceItems, updatePriceItem, validatePriceItem } from "./price-list.ts";

export const ASSISTANT_MAX_CHARS = 1500;
const MAX_CHANGES = 120;

/**
 * One change, by the item's real id. "delete" only ever comes from an undo
 * (of an added dish). "was" is the value the team saw in the preview: if the
 * item has changed since (on WhatsApp, or by a colleague), the change is
 * skipped rather than written over theirs.
 */
export type MenuChange =
  | { op: "price"; item_id: string; price: number; was?: number }
  | { op: "stock"; item_id: string; available: boolean; was?: boolean }
  | { op: "rename"; item_id: string; name: string; was?: string }
  | { op: "describe"; item_id: string; description: string | null; was?: string | null }
  | { op: "move"; item_id: string; section: string | null; was?: string | null }
  | { op: "hide"; item_id: string }
  | { op: "show"; item_id: string }
  | { op: "add"; name: string; price: number; section: string | null; description: string | null }
  | { op: "delete"; item_id: string }
  | { op: "rename_section"; from: string; to: string }
  | { op: "order_sections"; sections: string[] };

/** A change as the team sees it before applying: what, before, after. */
export type MenuChangePreview = { change: MenuChange; kind: string; label: string; before: string | null; after: string };

export const MENU_ASSISTANT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "One short line: what will change, e.g. \"Raise 8 cocktails by 10%\"." },
    question: { type: Type.STRING, nullable: true, description: "Only when the request is unclear or needs a fact you don't have: one short question, and no changes." },
    changes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          op: { type: Type.STRING, enum: ["price", "stock", "rename", "describe", "move", "hide", "show", "add", "rename_section", "order_sections"] },
          item: { type: Type.STRING, nullable: true, description: "The item's ref, like i12 (not for add, rename_section or order_sections)." },
          price: { type: Type.NUMBER, nullable: true },
          available: { type: Type.BOOLEAN, nullable: true },
          name: { type: Type.STRING, nullable: true },
          description: { type: Type.STRING, nullable: true },
          section: { type: Type.STRING, nullable: true },
          from: { type: Type.STRING, nullable: true },
          to: { type: Type.STRING, nullable: true },
          sections: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
        },
        required: ["op"],
      },
    },
  },
  required: ["summary", "changes"],
};

/** The items the assistant may change: the team's own, not those from its system's feed. */
export const editableItems = (items: PriceItem[]) => items.filter((item) => item.source !== "feed");

const sectionsOf = (items: PriceItem[]) => {
  const out: string[] = [];
  for (const item of items) if (item.section && !out.includes(item.section)) out.push(item.section);
  return out;
};
const major = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

/** What the model is told: the rules, and the menu with short refs. */
export function assistantInstructions(businessName: string, items: PriceItem[]): string {
  const currency = items[0]?.currency ?? "KES";
  const lines = items.map((item, index) => [
    `i${index + 1}`,
    item.section ?? "(no section)",
    item.name,
    major(item.priceMinor),
    item.available ? "in stock" : "out of stock",
    item.status === "hidden" ? "hidden" : "shown",
    (item.description ?? "").replace(/\s+/g, " ").slice(0, 140),
  ].join(" | "));
  return `You manage the menu of ${businessName} for its team. The team writes what to change; you reply with the exact changes, in the JSON shape given.

Rules:
- Change only items on the menu below, by their ref (i1, i2…). Never invent a dish, a price or a fact.
- Prices are whole ${currency} amounts. A change by a percentage or an amount applies to each item it names; round to the nearest 10 unless the team says otherwise. "price" is the new price.
- "finished", "sold out", "out of stock", "not available tonight" → stock with available false; "back", "available again" → stock with available true.
- "remove", "take off the menu" → hide (it stays in the dashboard, off the page). "put back on the menu" → show.
- A new dish (add) needs a name and a price from the team; put it in the section the team names or the one it plainly belongs to. With no price given, ask.
- move puts a dish in another section (an existing one, or a new one the team names).
- rename_section renames a whole section: from (its name now) and to.
- order_sections lists sections in their new order, the ones named first (e.g. "put Burgers first" → ["Burgers"]).
- describe writes one appetising sentence of under 140 characters from what the dish's name and current description say. Never add an origin, award, "organic", health or spice claim the team didn't give. British English.
- If the request is unclear, or needs a fact you don't have, return no changes and one short question.
- summary is one short line of what will change.

Menu (ref | section | name | price | stock | shown on the page | description):
${lines.join("\n")}

Sections, in order: ${sectionsOf(items).join(", ") || "(none)"}`;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean && clean.length <= max ? clean : null;
};
const amount = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[,\s]/g, "")) : NaN;
  return Number.isFinite(number) && number > 0 && number <= 10_000_000 ? Math.round(number * 100) / 100 : null;
};

/** The model's answer, its refs turned into the items' ids; what doesn't fit the menu is dropped. */
export function resolveModelChanges(raw: unknown, items: PriceItem[]): { summary: string; question: string | null; changes: MenuChange[]; dropped: number } {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(body.changes) ? body.changes.slice(0, MAX_CHANGES) : [];
  const byRef = (ref: unknown) => {
    const match = typeof ref === "string" ? /^i(\d+)$/.exec(ref.trim()) : null;
    return match ? items[Number(match[1]) - 1] : undefined;
  };
  const changes: MenuChange[] = [];
  let dropped = 0;
  for (const entry of list) {
    const c = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const item = byRef(c.item);
    let change: MenuChange | null = null;
    switch (c.op) {
      case "price": { const price = amount(c.price); if (item && price !== null) change = { op: "price", item_id: item.id, price }; break; }
      case "stock": if (item && typeof c.available === "boolean") change = { op: "stock", item_id: item.id, available: c.available }; break;
      case "rename": { const name = text(c.name, 120); if (item && name) change = { op: "rename", item_id: item.id, name }; break; }
      case "describe": { const description = text(c.description, 300); if (item && description) change = { op: "describe", item_id: item.id, description }; break; }
      case "move": { const section = text(c.section, 80); if (item && section) change = { op: "move", item_id: item.id, section }; break; }
      case "hide": if (item) change = { op: "hide", item_id: item.id }; break;
      case "show": if (item) change = { op: "show", item_id: item.id }; break;
      case "add": {
        const name = text(c.name, 120);
        const price = amount(c.price);
        if (name && price !== null) change = { op: "add", name, price, section: text(c.section, 80), description: text(c.description, 300) };
        break;
      }
      case "rename_section": { const from = text(c.from, 80); const to = text(c.to, 80); if (from && to) change = { op: "rename_section", from, to }; break; }
      case "order_sections": {
        const sections = Array.isArray(c.sections) ? c.sections.map((s) => text(s, 80)).filter((s): s is string => Boolean(s)) : [];
        if (sections.length) change = { op: "order_sections", sections };
        break;
      }
    }
    if (change) changes.push(change);
    else dropped += 1;
  }
  return { summary: text(body.summary, 200) ?? "", question: text(body.question, 300), changes, dropped };
}

/**
 * Checks each change against the menu as it is now and says what it does,
 * before → after. A change that does nothing, or no longer fits, is left out
 * with its reason.
 */
export function previewChanges(changes: MenuChange[], items: PriceItem[]): { previews: MenuChangePreview[]; skipped: string[] } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const sections = sectionsOf(items);
  const currency = items[0]?.currency ?? "KES";
  const money = (major: number) => formatMoney(Math.round(major * 100), currency);
  const previews: MenuChangePreview[] = [];
  const skipped: string[] = [];
  for (const change of changes.slice(0, MAX_CHANGES)) {
    if (change.op === "add") {
      if (items.some((item) => item.name.toLowerCase() === change.name.toLowerCase() && (item.section ?? "").toLowerCase() === (change.section ?? "").toLowerCase())) { skipped.push(`${change.name} is already on the menu`); continue; }
      previews.push({ change, kind: "New dish", label: change.name, before: null, after: `${money(change.price)}${change.section ? ` · ${change.section}` : ""}${change.description ? ` · ${change.description}` : ""}` });
      continue;
    }
    if (change.op === "rename_section") {
      const from = sections.find((name) => name.toLowerCase() === change.from.toLowerCase());
      if (!from) { skipped.push(`There's no section called ${change.from}`); continue; }
      if (from === change.to) continue;
      previews.push({ change: { ...change, from }, kind: "Section", label: from, before: from, after: change.to });
      continue;
    }
    if (change.op === "order_sections") {
      const named = change.sections.map((name) => sections.find((s) => s.toLowerCase() === name.toLowerCase())).filter((s): s is string => Boolean(s));
      const order = [...new Set([...named, ...sections])];
      if (!named.length || order.join("|") === sections.join("|")) continue;
      previews.push({ change: { op: "order_sections", sections: order }, kind: "Order", label: "Sections", before: sections.join(" · "), after: order.join(" · ") });
      continue;
    }
    const item = byId.get(change.item_id);
    if (!item) { skipped.push("A dish that's no longer on the menu"); continue; }
    switch (change.op) {
      case "price":
        if (Math.round(change.price * 100) === item.priceMinor) break;
        previews.push({ change: { ...change, was: item.priceMinor / 100 }, kind: "Price", label: item.name, before: formatMoney(item.priceMinor, item.currency), after: formatMoney(Math.round(change.price * 100), item.currency) });
        break;
      case "stock":
        if (change.available === item.available) break;
        previews.push({ change: { ...change, was: item.available }, kind: "Stock", label: item.name, before: item.available ? "In stock" : "Out of stock", after: change.available ? "In stock" : "Out of stock" });
        break;
      case "rename":
        if (change.name === item.name) break;
        previews.push({ change: { ...change, was: item.name }, kind: "Name", label: item.name, before: item.name, after: change.name });
        break;
      case "describe":
        if ((change.description ?? "") === (item.description ?? "")) break;
        previews.push({ change: { ...change, was: item.description }, kind: "Description", label: item.name, before: item.description, after: change.description ?? "No description" });
        break;
      case "move":
        if ((change.section ?? "") === (item.section ?? "")) break;
        previews.push({ change: { ...change, was: item.section }, kind: "Section", label: item.name, before: item.section ?? "No section", after: change.section ?? "No section" });
        break;
      case "hide":
        if (item.status === "hidden") break;
        previews.push({ change, kind: "Hide", label: item.name, before: "On the menu", after: "Hidden from the menu" });
        break;
      case "show":
        if (item.status === "active") break;
        previews.push({ change, kind: "Show", label: item.name, before: "Hidden", after: "Back on the menu" });
        break;
      case "delete":
        previews.push({ change, kind: "Remove", label: item.name, before: "On the menu", after: "Removed" });
        break;
    }
  }
  return { previews, skipped };
}

/** A change sent back by the dashboard to apply: the same shapes, checked again. */
export function readChange(input: unknown): MenuChange | null {
  const c = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const id = typeof c.item_id === "string" && /^[0-9a-f-]{36}$/i.test(c.item_id) ? c.item_id : null;
  switch (c.op) {
    case "price": { const price = amount(c.price); return id && price !== null ? { op: "price", item_id: id, price, ...(typeof c.was === "number" ? { was: c.was } : {}) } : null; }
    case "stock": return id && typeof c.available === "boolean" ? { op: "stock", item_id: id, available: c.available, ...(typeof c.was === "boolean" ? { was: c.was } : {}) } : null;
    case "rename": { const name = text(c.name, 120); return id && name ? { op: "rename", item_id: id, name, ...(typeof c.was === "string" ? { was: c.was } : {}) } : null; }
    case "describe": return id ? { op: "describe", item_id: id, description: c.description === null ? null : text(c.description, 500), ...("was" in c && (c.was === null || typeof c.was === "string") ? { was: c.was as string | null } : {}) } : null;
    case "move": return id ? { op: "move", item_id: id, section: c.section === null ? null : text(c.section, 80), ...("was" in c && (c.was === null || typeof c.was === "string") ? { was: c.was as string | null } : {}) } : null;
    case "hide": return id ? { op: "hide", item_id: id } : null;
    case "show": return id ? { op: "show", item_id: id } : null;
    case "delete": return id ? { op: "delete", item_id: id } : null;
    case "add": {
      const name = text(c.name, 120);
      const price = amount(c.price);
      return name && price !== null ? { op: "add", name, price, section: c.section ? text(c.section, 80) : null, description: c.description ? text(c.description, 500) : null } : null;
    }
    case "rename_section": { const from = text(c.from, 80); const to = text(c.to, 80); return from && to ? { op: "rename_section", from, to } : null; }
    case "order_sections": {
      const sections = Array.isArray(c.sections) ? c.sections.map((s) => text(s, 80)).filter((s): s is string => Boolean(s)) : [];
      return sections.length ? { op: "order_sections", sections } : null;
    }
  }
  return null;
}

/**
 * Applies the changes in order and returns how to undo them (the changes that
 * put everything back, last first). A change that no longer fits is skipped
 * with its reason; the rest still apply.
 */
export async function applyChanges(businessId: string, changes: MenuChange[], userId: string): Promise<{ applied: number; skipped: string[]; undo: MenuChange[] }> {
  const undo: MenuChange[] = [];
  const skipped: string[] = [];
  let applied = 0;
  for (const change of changes.slice(0, MAX_CHANGES)) {
    if (change.op === "add") {
      const checked = validatePriceItem({ name: change.name, price: String(change.price), section: change.section ?? "", description: change.description ?? "" });
      if (!checked.ok) { skipped.push(`${change.name}: ${checked.error}`); continue; }
      const created = await createPriceItem(businessId, checked.value, userId);
      if (created === "name_taken") { skipped.push(`${change.name} is already on the menu`); continue; }
      if (created === "too_many") { skipped.push("The menu is full"); continue; }
      undo.unshift({ op: "delete", item_id: created.id });
      applied += 1;
      continue;
    }
    if (change.op === "rename_section") {
      const rows = await inBusiness(async (_db, client) => (await client.query<{ id: string }>(
        "update price_items set section = $3, updated_at = now() where business_id = $1 and source = 'manual' and lower(btrim(coalesce(section, ''))) = lower(btrim($2)) returning id",
        [businessId, change.from, change.to],
      )).rows, businessId).catch(() => null);
      if (!rows) { skipped.push(`${change.to} already has a dish with the same name`); continue; }
      if (!rows.length) { skipped.push(`There's no section called ${change.from}`); continue; }
      undo.unshift({ op: "rename_section", from: change.to, to: change.from });
      applied += 1;
      continue;
    }
    if (change.op === "order_sections") {
      const items = await listPriceItems(businessId);
      const before = sectionsOf(items);
      const order = [...new Set([...change.sections.map((name) => before.find((s) => s.toLowerCase() === name.toLowerCase())).filter((s): s is string => Boolean(s)), ...before])];
      const ids = [...items.filter((item) => !item.section), ...order.flatMap((name) => items.filter((item) => item.section === name))].map((item) => item.id);
      if (ids.length) await orderPriceItems(businessId, ids);
      undo.unshift({ op: "order_sections", sections: before });
      applied += 1;
      continue;
    }
    const item = await getPriceItem(businessId, change.item_id);
    if (!item) { skipped.push("A dish that's no longer on the menu"); continue; }
    if (change.op === "delete") {
      if (await deletePriceItem(businessId, item.id)) applied += 1;
      continue;
    }
    if (item.source === "feed") { skipped.push(`${item.name} comes from your own system: change it there`); continue; }
    // Changed since the team saw it (on WhatsApp, or by a colleague): theirs stands.
    const moved =
      change.op === "price" && change.was !== undefined && Math.round(change.was * 100) !== item.priceMinor ? `${item.name}'s price changed meanwhile: it's now ${formatMoney(item.priceMinor, item.currency)}`
      : change.op === "stock" && change.was !== undefined && change.was !== item.available ? `${item.name} was marked ${item.available ? "in stock" : "out of stock"} meanwhile`
      : change.op === "rename" && change.was !== undefined && change.was !== item.name ? `${change.was} was renamed ${item.name} meanwhile`
      : change.op === "describe" && change.was !== undefined && (change.was ?? null) !== (item.description ?? null) ? `${item.name}'s description changed meanwhile`
      : change.op === "move" && change.was !== undefined && (change.was ?? null) !== (item.section ?? null) ? `${item.name} moved to ${item.section ?? "no section"} meanwhile`
      : null;
    if (moved) { skipped.push(moved); continue; }
    const patch: Record<string, unknown> =
      change.op === "price" ? { price: String(change.price) }
      : change.op === "stock" ? { available: change.available }
      : change.op === "rename" ? { name: change.name }
      : change.op === "describe" ? { description: change.description ?? "" }
      : change.op === "move" ? { section: change.section ?? "" }
      : { status: change.op === "hide" ? "hidden" : "active" };
    const back: MenuChange =
      change.op === "price" ? { op: "price", item_id: item.id, price: item.priceMinor / 100, was: change.price }
      : change.op === "stock" ? { op: "stock", item_id: item.id, available: item.available, was: change.available }
      : change.op === "rename" ? { op: "rename", item_id: item.id, name: item.name, was: change.name }
      : change.op === "describe" ? { op: "describe", item_id: item.id, description: item.description, was: change.description }
      : change.op === "move" ? { op: "move", item_id: item.id, section: item.section, was: change.section }
      : { op: item.status === "hidden" ? "hide" : "show", item_id: item.id };
    const checked = validatePriceItem(patch, item);
    if (!checked.ok) { skipped.push(`${item.name}: ${checked.error}`); continue; }
    const updated = await updatePriceItem(businessId, item.id, checked.value, userId);
    if (updated === "name_taken") { skipped.push(`${change.op === "rename" ? change.name : item.name} is already in that section`); continue; }
    if (!updated) { skipped.push("A dish that's no longer on the menu"); continue; }
    undo.unshift(back);
    applied += 1;
  }
  return { applied, skipped, undo };
}

/** What the team might ask first, from its own menu: a dish to mark finished, a section to raise, descriptions to write. */
export function assistantIdeas(items: PriceItem[]): string[] {
  const own = editableItems(items).filter((item) => item.status === "active");
  const sections = sectionsOf(own);
  const ideas: string[] = [];
  const dish = own.find((item) => item.available && item.section);
  if (dish) ideas.push(`${dish.name} is finished tonight`);
  const priced = sections.find((name) => own.filter((item) => item.section === name).length >= 2);
  if (priced) ideas.push(`Raise ${priced} by 10%`);
  const bare = sections.find((name) => own.some((item) => item.section === name && !item.description));
  if (bare) ideas.push(`Write descriptions for ${bare}`);
  const last = sections.at(-1);
  if (last && sections.length > 2) ideas.push(`Put ${last} first`);
  if (sections[0]) ideas.push(`Add a new dish to ${sections[0]}`);
  return ideas.slice(0, 4);
}

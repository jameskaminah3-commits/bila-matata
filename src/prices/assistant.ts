// src/prices/assistant.ts
//
// The menu assistant: the team says what to change in its own words ("raise
// the cocktails by 10%", "tilapia is finished tonight", "add Chicken Tikka,
// 950, to Mains", "write descriptions for the burgers") and gets back the
// exact changes, each before → after, to apply or leave. Nothing changes
// until they apply, and every apply comes with its undo.
//
// The model only reads the request: it names dishes and sections in words and
// says how a price moves (a new price, a percentage or an amount). This file
// does the rest, so a long menu doesn't trip it up: it finds each dish by its
// name (loosely: "the tilapia", "mojitos", a typo), spreads a section-wide
// change over every dish in it, and works out and rounds the new prices. What
// it can't find is said plainly, never guessed. The model never sees an item's
// id. Items from the business's own system (a product feed) are left out: the
// feed would undo the change.

import { Type, type Schema } from "@google/genai";
import { formatMoney } from "../booking/money.ts";
import { inBusiness } from "../db/tenant.ts";
import type { PriceItem } from "../db/schema.ts";
import { createPriceItem, deletePriceItem, getPriceItem, listPriceItems, MAX_PRICE_ITEMS, orderPriceItems, updatePriceItem, validatePriceItem } from "./price-list.ts";

export const ASSISTANT_MAX_CHARS = 1500;
/** Enough for one change to every dish on the fullest menu. */
export const MAX_CHANGES = MAX_PRICE_ITEMS;
const MAX_MODEL_CHANGES = 150;

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

const nullable = (type: Type, description: string): Schema => ({ type, nullable: true, description });

export const MENU_ASSISTANT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "One short line: what will change, e.g. \"Raise Cocktails by 10% and mark Tilapia finished\"." },
    question: nullable(Type.STRING, "Only when a part can't be done at all without a fact you don't have (a new dish with no price): one short question about that part. Never to confirm."),
    changes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          op: { type: Type.STRING, enum: ["price", "stock", "rename", "describe", "move", "hide", "show", "add", "rename_section", "order_sections"] },
          dish: nullable(Type.STRING, "The dish, by its name on the menu. Empty for a change to a whole section."),
          section: nullable(Type.STRING, "The section: the one a whole-section change is for (\"all\" for the whole menu), the one a new dish goes in, or the one that tells two dishes of the same name apart."),
          price: nullable(Type.NUMBER, "A new price."),
          percent: nullable(Type.NUMBER, "A price change by a percentage: 10 for +10%, -15 for -15%."),
          amount: nullable(Type.NUMBER, "A price change by an amount: 50 for +50, -100 for -100."),
          round_to: nullable(Type.NUMBER, "Only when the team says how to round, e.g. 50."),
          available: nullable(Type.BOOLEAN, "stock: false when finished or sold out, true when back."),
          name: nullable(Type.STRING, "rename: the dish's new name. add: the new dish's name."),
          description: nullable(Type.STRING, "describe or add: the description."),
          to_section: nullable(Type.STRING, "move: the section the dish goes to."),
          from: nullable(Type.STRING, "rename_section: the section's name now."),
          to: nullable(Type.STRING, "rename_section: its new name."),
          sections: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true, description: "order_sections: the sections in their new order (the ones named first are enough)." },
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

/** What the model is told: the rules, and the menu by section, in words. */
export function assistantInstructions(businessName: string, items: PriceItem[]): string {
  const currency = items[0]?.currency ?? "KES";
  const groups = [...sectionsOf(items).map((name) => [name, items.filter((item) => item.section === name)] as const)];
  const loose = items.filter((item) => !item.section);
  if (loose.length) groups.unshift(["(no section)", loose]);
  const menu = groups.map(([name, list]) => `## ${name}\n${list.map((item) => {
    const notes = [!item.available && "finished", item.status === "hidden" && "hidden from the page"].filter(Boolean).join(", ");
    const description = (item.description ?? "").replace(/\s+/g, " ").slice(0, 120);
    return `- ${item.name}: ${major(item.priceMinor)}${notes ? ` (${notes})` : ""}${description ? ` | ${description}` : ""}`;
  }).join("\n")}`).join("\n\n");
  return `You manage the menu of ${businessName} for its team. The team tells you what to change; you turn every part of it into changes, in the JSON shape given. The team sees each change before anything is saved and applies the ones it wants, so carry the request out: never ask them to confirm, and never ask what they plainly said.

How to write the changes:
- Name dishes and sections as the menu below writes them. When the team's words plainly mean a dish on it ("the tilapia", "mojitos", a misspelling), use the menu's name. If nothing on the menu fits, give the change with the team's words anyway: the system says it wasn't found. Never invent a dish, a price or a fact.
- A change to a whole section ("the cocktails", "all the burgers", "everything in Mains") is ONE change with section set and no dish. The whole menu is section "all". Don't list the dishes one by one.
- Prices are in ${currency}. A new price goes in price. A change by a percentage goes in percent (10 for +10%, -15 for 15% off); by an amount in amount (50 for 50 more, -100 for 100 less). Don't work out the new prices yourself: the system does, and rounds them. Set round_to only when the team says how to round.
- "finished", "sold out", "out of stock", "not available", "86" → stock with available false. "back", "available again", "in stock" → stock with available true.
- "remove", "take off the menu", "delete" → hide: it leaves the page and stays in the dashboard. "put back on the menu" → show.
- add is a new dish: name, price, and section (the one the team names, or the one it plainly belongs to). A description only if the team gave one or asked you to write one.
- move puts a dish (or, with section and no dish, a whole section's dishes) in to_section: an existing section or a new one the team names.
- rename gives a dish a new name. rename_section: from (the section's name now) and to.
- order_sections: the sections in their new order; the ones named first are enough ("put Burgers first" → ["Burgers"]).
- describe: one change per dish, one appetising sentence of under 140 characters from the dish's name and current description. Never add an origin, award, "organic", health or spice claim the team didn't give. British English.
- question: only when a part can't be done at all without a fact you don't have, like a new dish with no price. Still do every other part, and ask one short question about the missing one. A section, "all" or "everything" is never a reason to ask.
- summary: one short line of what will change.
- When an earlier request and your question come before the team's words, those words answer it: carry out the earlier request in full with that answer.

The menu (dish: price${currency === "KES" ? " in KES" : ""} | description):
${menu || "(empty)"}`;
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
const signed = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[,\s%+]/g, "")) : NaN;
  return Number.isFinite(number) && number !== 0 ? number : null;
};

// ── Finding dishes and sections by name ──────────────────────────────────────

const STOP = new Set(["the", "a", "an", "our", "all", "of"]);
const singular = (word: string) =>
  word.length <= 3 || word.endsWith("ss") ? word
  : word.endsWith("ies") ? `${word.slice(0, -3)}y`
  : /(ch|sh|x|o)es$/.test(word) ? word.slice(0, -2)
  : word.endsWith("s") ? word.slice(0, -1)
  : word;
/** A name as it's matched: lower case, no accents or punctuation, "the" and plurals don't matter. */
export const nameKey = (value: string) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’`]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter((word) => word && !STOP.has(word)).map(singular).join(" ");
const pairs = (key: string) => {
  const flat = key.replace(/ /g, "");
  const out: string[] = [];
  for (let at = 0; at < flat.length - 1; at += 1) out.push(flat.slice(at, at + 2));
  return out;
};
/** How alike two names are, 0 to 1 (letter pairs in common): catches a typo, not a different dish. */
const likeness = (a: string, b: string) => {
  const left = pairs(a);
  const right = pairs(b);
  if (!left.length || !right.length) return a === b ? 1 : 0;
  const pool = [...right];
  let common = 0;
  for (const pair of left) {
    const at = pool.indexOf(pair);
    if (at >= 0) { common += 1; pool.splice(at, 1); }
  }
  return (2 * common) / (left.length + right.length);
};

/**
 * The one name among candidates that the words mean: the same name; else the
 * only one holding all their words ("tilapia" → "Whole Tilapia"); else the
 * longest one they hold ("dawa cocktail" → "Dawa"); else one clearly closest
 * (a typo). "ambiguous" lists the names it could be.
 */
function pickName(words: string, names: string[]): { name: string } | { ambiguous: string[] } | null {
  const want = nameKey(words);
  if (!want) return null;
  const keyed = [...new Set(names)].map((name) => ({ name, key: nameKey(name) })).filter((entry) => entry.key);
  const same = keyed.find((entry) => entry.key === want);
  if (same) return { name: same.name };
  const wanted = want.split(" ");
  const holding = keyed.filter((entry) => wanted.every((word) => entry.key.split(" ").includes(word)));
  if (holding.length === 1) return { name: holding[0].name };
  if (holding.length > 1) return { ambiguous: holding.map((entry) => entry.name) };
  const held = keyed.filter((entry) => entry.key.split(" ").every((word) => wanted.includes(word))).sort((a, b) => b.key.length - a.key.length);
  if (held.length && (held.length === 1 || held[0].key.length > held[1].key.length)) return { name: held[0].name };
  const scored = keyed.map((entry) => ({ ...entry, score: likeness(entry.key, want) })).sort((a, b) => b.score - a.score);
  if (scored[0] && scored[0].score >= 0.72 && (!scored[1] || scored[0].score - scored[1].score >= 0.1)) return { name: scored[0].name };
  return null;
}

const ALL_KEYS = new Set(["", "everything", "menu", "whole menu", "entire menu", "full menu", "everything on menu", "every dish", "every item", "dish", "item"]);
/** A section by the team's words: its name on the menu, "all" for the whole menu, or null. */
export function findSection(words: string, items: PriceItem[]): string | "all" | null {
  if (ALL_KEYS.has(nameKey(words))) return "all";
  const found = pickName(words, sectionsOf(items));
  return found && "name" in found ? found.name : null;
}
const isPlural = (words: string) => {
  const last = nameKey(words).split(" ").at(-1) ?? "";
  const raw = words.toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").at(-1) ?? "";
  return Boolean(last) && raw !== last && raw.endsWith("s");
};
/**
 * The dishes the words mean: every dish of that name (in the section given,
 * when there's one); for plural words ("the burgers"), every dish they fit.
 * "ambiguous" lists the dishes a singular word could be.
 */
export function findDishes(words: string, items: PriceItem[], section?: string | null): { items: PriceItem[] } | { ambiguous: string[] } | null {
  const inSection = section ? findSection(section, items) : null;
  const scopes = inSection && inSection !== "all" ? [items.filter((item) => item.section === inSection), items] : [items];
  for (const scope of scopes) {
    const found = pickName(words, scope.map((item) => item.name));
    if (!found) continue;
    if ("name" in found) return { items: scope.filter((item) => item.name === found.name) };
    if (isPlural(words)) return { items: scope.filter((item) => found.ambiguous.includes(item.name)) };
    return found;
  }
  return null;
}

/** The step a computed price rounds to: tens from 100 shillings up, whole shillings below; whole units or halves elsewhere. */
const stepFor = (currency: string, price: number) => (currency === "KES" ? (price >= 100 ? 10 : 1) : price >= 20 ? 1 : 0.5);
const CONFIRMING = /\b(confirm|proceed|go ahead|shall i|should i|would you like|do you want|are you sure|is that (right|correct|ok))\b/i;

const SPREADS = new Set(["price", "stock", "hide", "show", "move"]);

/**
 * The model's answer, as changes by item id: each dish found by its name, a
 * section-wide change spread over its dishes, new prices worked out. What
 * can't be found or doesn't fit is said in notes, never guessed.
 */
export function resolveModelChanges(raw: unknown, items: PriceItem[]): { summary: string; question: string | null; changes: MenuChange[]; notes: string[]; dropped: number } {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(body.changes) ? body.changes.slice(0, MAX_MODEL_CHANGES) : [];
  const changes: MenuChange[] = [];
  const notes: string[] = [];
  const asks: string[] = [];
  let dropped = 0;
  const note = (line: string) => { if (!notes.includes(line)) notes.push(line); };

  for (const entry of list) {
    const c = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const op = typeof c.op === "string" ? c.op : "";
    const dishWords = text(c.dish ?? c.item, 160);
    const sectionWords = text(c.section, 80);

    if (op === "add") {
      const name = text(c.name, 120) ?? dishWords;
      if (!name) { dropped += 1; continue; }
      const price = amount(c.price);
      if (price === null) { asks.push(`What price for ${name}?`); continue; }
      const section = sectionWords ? (findSection(sectionWords, items) ?? sectionWords) : null;
      changes.push({ op: "add", name, price, section: section === "all" ? null : section, description: text(c.description, 300) });
      continue;
    }
    if (op === "rename_section") {
      const from = text(c.from, 80) ?? sectionWords;
      const to = text(c.to, 80);
      if (!from || !to) { dropped += 1; continue; }
      const found = findSection(from, items);
      if (!found || found === "all") { note(`There's no section called "${from}"`); continue; }
      changes.push({ op: "rename_section", from: found, to });
      continue;
    }
    if (op === "order_sections") {
      const named = Array.isArray(c.sections) ? c.sections.map((s) => text(s, 80)).filter((s): s is string => Boolean(s)) : [];
      const sections: string[] = [];
      for (const words of named) {
        const found = findSection(words, items);
        if (found && found !== "all") { if (!sections.includes(found)) sections.push(found); } else note(`There's no section called "${words}"`);
      }
      if (sections.length) changes.push({ op: "order_sections", sections });
      else if (!named.length) dropped += 1;
      continue;
    }
    if (!["price", "stock", "rename", "describe", "move", "hide", "show"].includes(op)) { dropped += 1; continue; }

    // Which dishes: by name, or every dish in a section ("the cocktails", "all").
    let targets: PriceItem[] = [];
    // "the burgers", "cocktails": a section's own name, in the plural, means all of it.
    const wholeSection = dishWords && SPREADS.has(op) && isPlural(dishWords) ? sectionsOf(items).find((name) => nameKey(name) === nameKey(dishWords)) : undefined;
    if (wholeSection) targets = items.filter((item) => item.section === wholeSection);
    else if (dishWords) {
      const found = findDishes(dishWords, items, sectionWords);
      // A section named as if it were a dish ("raise Cocktails by 10%").
      const section = !found && SPREADS.has(op) ? findSection(dishWords, items) : null;
      if (found && "items" in found) targets = found.items;
      else if (section) targets = section === "all" ? items : items.filter((item) => item.section === section);
      else if (found) { note(`"${dishWords}" could be ${found.ambiguous.slice(0, 4).join(", ")}${found.ambiguous.length > 4 ? "…" : ""}: say which`); continue; }
      else { note(`Couldn't find "${dishWords}" on your menu`); continue; }
      if ((op === "rename" || op === "describe") && new Set(targets.map((item) => item.name)).size > 1) {
        note(`"${dishWords}" could be ${[...new Set(targets.map((item) => item.name))].slice(0, 4).join(", ")}: say which`);
        continue;
      }
    } else if (sectionWords && SPREADS.has(op)) {
      const section = findSection(sectionWords, items);
      if (!section) { note(`There's no section called "${sectionWords}"`); continue; }
      targets = section === "all" ? items : items.filter((item) => item.section === section);
    } else { dropped += 1; continue; }

    for (const item of targets) {
      switch (op) {
        case "price": {
          const exact = amount(c.price);
          let percent = signed(c.percent);
          if (percent !== null && Math.abs(percent) < 1) percent *= 100; // 0.1 meant 10%
          const by = signed(c.amount);
          const now = item.priceMinor / 100;
          const raw = exact ?? (percent !== null && percent > -90 && percent <= 500 ? now * (1 + percent / 100) : by !== null ? now + by : null);
          if (raw === null) { dropped += 1; break; }
          const step = amount(c.round_to) ?? (exact !== null || by !== null ? 0.01 : stepFor(item.currency, raw));
          const price = Math.round(Math.round(raw / step) * step * 100) / 100;
          if (price <= 0) { note(`${item.name} can't go below nothing`); break; }
          changes.push({ op: "price", item_id: item.id, price });
          break;
        }
        case "stock": {
          const available = typeof c.available === "boolean" ? c.available : null;
          if (available === null) dropped += 1;
          else changes.push({ op: "stock", item_id: item.id, available });
          break;
        }
        case "rename": { const name = text(c.name, 120); if (name) changes.push({ op: "rename", item_id: item.id, name }); else dropped += 1; break; }
        case "describe": { const description = text(c.description, 300); if (description) changes.push({ op: "describe", item_id: item.id, description }); else dropped += 1; break; }
        case "move": {
          const words = text(c.to_section, 80) ?? (dishWords ? sectionWords : null);
          if (!words) { dropped += 1; break; }
          const section = findSection(words, items);
          changes.push({ op: "move", item_id: item.id, section: section && section !== "all" ? section : words });
          break;
        }
        case "hide": changes.push({ op: "hide", item_id: item.id }); break;
        case "show": changes.push({ op: "show", item_id: item.id }); break;
      }
    }
  }
  // One change per dish and kind: the last word on it stands.
  const seen = new Map<string, number>();
  changes.forEach((change, index) => { if ("item_id" in change) seen.set(`${change.op}:${change.item_id}`, index); });
  const unique = changes.filter((change, index) => !("item_id" in change) || seen.get(`${change.op}:${change.item_id}`) === index);
  const asked = text(body.question, 300);
  const question = asks.length ? asks.join(" ") : asked && !CONFIRMING.test(asked) ? asked : null;
  return { summary: text(body.summary, 200) ?? "", question, changes: unique.slice(0, MAX_CHANGES), notes, dropped };
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
  return ideas.slice(0, 4);
}

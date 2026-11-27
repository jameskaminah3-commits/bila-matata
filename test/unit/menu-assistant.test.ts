// test/unit/menu-assistant.test.ts
//
// What the menu assistant tells the model, and how its answer becomes exact
// changes: dishes found by name (loosely), a section-wide change spread over
// its dishes, prices worked out here, and nothing guessed.

import assert from "node:assert/strict";
import test from "node:test";
import type { PriceItem } from "../../src/db/schema.ts";
import { assistantIdeas, assistantInstructions, editableItems, findDishes, findSection, previewChanges, readChange, resolveModelChanges } from "../../src/prices/assistant.ts";

const item = (id: string, section: string, name: string, priceMinor: number, extra: Partial<PriceItem> = {}) =>
  ({ id, businessId: "b", section, name, description: null, priceMinor, priceMaxMinor: null, currency: "KES", unit: null, status: "active", sortOrder: 0, available: true, source: "manual", ...extra }) as unknown as PriceItem;
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const items = [
  item(ID(1), "Cocktails", "Mojito", 65_000),
  item(ID(2), "Cocktails", "Dawa", 60_000, { available: false }),
  item(ID(3), "Cocktails", "Piña Colada", 75_000),
  item(ID(4), "Mains", "Whole Tilapia", 120_000, { description: "Whole, lemon butter" }),
  item(ID(5), "Mains", "Nyama Choma", 150_000),
  item(ID(6), "Burgers", "Tapas Burger", 119_000),
  item(ID(7), "Burgers", "Cheese Burger", 99_000),
  item(ID(8), "Bar Bites", "Chicken Wings", 80_000),
  item(ID(9), "Starters", "Chicken Wings", 85_000),
];
const resolve = (changes: unknown[], extra: Record<string, unknown> = {}) => resolveModelChanges({ summary: "s", changes, ...extra }, items);

test("the model sees the menu in words by section, never an id, with the rules that keep it working", () => {
  const prompt = assistantInstructions("Tapas Gold", [...items.slice(0, 4), item(ID(10), "Mains", "Ugali", 10_000, { status: "hidden" })]);
  assert.match(prompt, /^You manage the menu of Tapas Gold for its team\./);
  assert.match(prompt, /## Cocktails\n- Mojito: 650\n- Dawa: 600 \(finished\)\n- Piña Colada: 750\n\n## Mains\n- Whole Tilapia: 1200 \| Whole, lemon butter\n- Ugali: 100 \(hidden from the page\)/);
  assert.match(prompt, /never ask them to confirm/);
  assert.match(prompt, /ONE change with section set and no dish/);
  assert.match(prompt, /Don't work out the new prices yourself/);
  assert.match(prompt, /Never invent a dish, a price or a fact\./);
  assert.match(prompt, /Never add an origin, award, "organic", health or spice claim/);
  assert.doesNotMatch(prompt, /00000000-/, "never the real ids");
  assert.equal(editableItems([...items, item(ID(20), "Shop", "Feed thing", 100, { source: "feed" })]).length, items.length, "items from the business's own system stay out");
});

test("dishes and sections are found by name, loosely, and never guessed", () => {
  const names = (words: string, section?: string) => { const found = findDishes(words, items, section); return found && "items" in found ? found.items.map((i) => `${i.section}/${i.name}`) : found; };
  assert.deepEqual(names("the tilapia"), ["Mains/Whole Tilapia"]);
  assert.deepEqual(names("mojitos"), ["Cocktails/Mojito"]);
  assert.deepEqual(names("Mojitto"), ["Cocktails/Mojito"], "a typo");
  assert.deepEqual(names("pina colada"), ["Cocktails/Piña Colada"], "no accent");
  assert.deepEqual(names("Dawa cocktail"), ["Cocktails/Dawa"]);
  assert.deepEqual(names("chicken wings"), ["Bar Bites/Chicken Wings", "Starters/Chicken Wings"], "the same dish in two sections: both");
  assert.deepEqual(names("chicken wings", "starters"), ["Starters/Chicken Wings"]);
  assert.deepEqual(names("the burgers"), ["Burgers/Tapas Burger", "Burgers/Cheese Burger"], "plural: every one");
  assert.deepEqual(names("burger"), { ambiguous: ["Tapas Burger", "Cheese Burger"] }, "singular: which one?");
  const bar = [item(ID(30), "Whiskey", "Jack Daniel's (Shot)", 40_000), item(ID(31), "Whiskey", "Jack Daniel's Honey (Shot)", 45_000)];
  const jack = findDishes("jack daniels shot", bar);
  assert.deepEqual(jack && "items" in jack ? jack.items.map((i) => i.name) : jack, ["Jack Daniel's (Shot)"], "an apostrophe typed or not");
  assert.equal(names("Margarita"), null);
  assert.equal(names("Mango Juice"), null, "never the nearest thing that isn't it");
  assert.equal(findSection("the cocktails", items), "Cocktails");
  assert.equal(findSection("cocktail", items), "Cocktails");
  assert.equal(findSection("bar bites", items), "Bar Bites");
  assert.equal(findSection("everything", items), "all");
  assert.equal(findSection("Desserts", items), null);
});

test("a section-wide change spreads over its dishes, and prices are worked out and rounded here", () => {
  const { changes, notes, question } = resolve([
    { op: "price", section: "the cocktails", percent: 10 },
    { op: "stock", dish: "the tilapia", available: false },
    { op: "price", dish: "Nyama Choma", amount: -100 },
    { op: "price", section: "Burgers", percent: -15, round_to: 50 },
  ]);
  const price = (id: string) => changes.find((c) => c.op === "price" && c.item_id === id) as { price: number } | undefined;
  assert.equal(price(ID(1))?.price, 720, "650 + 10% = 715, to the nearest 10");
  assert.equal(price(ID(2))?.price, 660);
  assert.equal(price(ID(3))?.price, 830, "750 + 10% = 825 → 830");
  assert.equal(price(ID(5))?.price, 1400);
  assert.equal(price(ID(6))?.price, 1000, "1190 − 15% = 1011.5, to the nearest 50");
  assert.equal(price(ID(7))?.price, 850);
  assert.deepEqual(changes.find((c) => c.op === "stock"), { op: "stock", item_id: ID(4), available: false });
  assert.deepEqual([notes, question], [[], null]);
  assert.equal(resolve([{ op: "price", section: "all", percent: 5 }]).changes.length, items.length, "the whole menu");
  const burgers = [...items, item(ID(11), "Mains", "Burger Bowl", 90_000)];
  assert.deepEqual(resolveModelChanges({ changes: [{ op: "stock", dish: "burgers", available: false }] }, burgers).changes.map((c) => "item_id" in c && c.item_id), [ID(6), ID(7)], "a section's name in the plural means the section");
  const named = resolve([{ op: "price", dish: "Cocktails", percent: 0.1 }]).changes;
  assert.equal(named.length, 3, "a section named as a dish; 0.1 read as 10%");
  assert.equal((named[0] as { price: number }).price, 720);
});

test("what can't be found is said plainly; the question comes with the plan, never to confirm", () => {
  const read = resolve([
    { op: "stock", dish: "Margarita", available: false },
    { op: "price", dish: "burger", price: 1200 },
    { op: "price", section: "Desserts", percent: 10 },
    { op: "stock", dish: "Dawa", available: true },
    { op: "add", name: "Chicken Tikka", section: "mains" },
    { op: "add", name: "Masala Chips", price: "350", section: "bar bites" },
    { op: "drop_table", dish: "Mojito" },
  ], { question: "Shall I go ahead with these?" });
  assert.deepEqual(read.notes, [
    "Couldn't find \"Margarita\" on your menu",
    "\"burger\" could be Tapas Burger, Cheese Burger: say which",
    "There's no section called \"Desserts\"",
  ]);
  assert.equal(read.question, "What price for Chicken Tikka?", "only the fact that's missing; a request to confirm is dropped");
  assert.deepEqual(read.changes, [
    { op: "stock", item_id: ID(2), available: true },
    { op: "add", name: "Masala Chips", price: 350, section: "Bar Bites", description: null },
  ]);
  assert.equal(read.dropped, 1);
  assert.equal(resolve([], { question: "What should the new cocktail be called?" }).question, "What should the new cocktail be called?");
});

test("the last word on a dish stands, a change that changes nothing is left out, and applied changes are read strictly", () => {
  const read = resolve([{ op: "price", dish: "Mojito", price: 700 }, { op: "price", dish: "Mojito", price: 650 }, { op: "stock", dish: "Mojito", available: true }]);
  assert.deepEqual(read.changes, [{ op: "price", item_id: ID(1), price: 650 }, { op: "stock", item_id: ID(1), available: true }]);
  assert.deepEqual(previewChanges(read.changes, items).previews, [], "both already so");
  const { previews } = previewChanges(resolve([{ op: "price", dish: "Mojito", price: 715 }, { op: "stock", dish: "Dawa", available: true }]).changes, items);
  assert.deepEqual(previews.map((p) => `${p.label}: ${p.before ?? ""} → ${p.after}`), ["Mojito: KSh 650 → KSh 715", "Dawa: Out of stock → In stock"]);
  assert.equal(readChange({ op: "price", item_id: "x", price: 5 }), null);
  assert.equal(readChange({ op: "price", item_id: ID(1), price: 0 }), null);
  assert.deepEqual(readChange({ op: "hide", item_id: ID(1) }), { op: "hide", item_id: ID(1) });
});

test("ideas are things it can do at once, never one that needs a question", () => {
  const ideas = assistantIdeas(items);
  assert.ok(ideas.length > 0);
  assert.ok(ideas.every((idea) => !/add a new dish/i.test(idea)), ideas.join(" | "));
});

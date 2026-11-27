// test/unit/menu-assistant.test.ts
//
// What the menu assistant tells the model, and how strictly its answer is
// read: short refs only, never another item, a price or a change it made up.

import assert from "node:assert/strict";
import test from "node:test";
import type { PriceItem } from "../../src/db/schema.ts";
import { assistantInstructions, editableItems, previewChanges, readChange, resolveModelChanges } from "../../src/prices/assistant.ts";

const item = (id: string, section: string, name: string, priceMinor: number, extra: Partial<PriceItem> = {}) =>
  ({ id, businessId: "b", section, name, description: null, priceMinor, priceMaxMinor: null, currency: "KES", unit: null, status: "active", sortOrder: 0, available: true, source: "manual", ...extra }) as unknown as PriceItem;
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const items = [item(ID(1), "Cocktails", "Mojito", 65_000), item(ID(2), "Cocktails", "Dawa", 60_000, { available: false }), item(ID(3), "Mains", "Tilapia", 120_000, { description: "Whole, lemon butter" })];

test("the model sees the menu by short refs, with the rules that keep it honest", () => {
  const prompt = assistantInstructions("Tapas Gold", items);
  assert.match(prompt, /^You manage the menu of Tapas Gold for its team\./);
  assert.match(prompt, /\ni1 \| Cocktails \| Mojito \| 650 \| in stock \| shown \| \ni2 \| Cocktails \| Dawa \| 600 \| out of stock \| shown \| \ni3 \| Mains \| Tilapia \| 1200 \| in stock \| shown \| Whole, lemon butter/);
  assert.match(prompt, /Never invent a dish, a price or a fact\./);
  assert.match(prompt, /Never add an origin, award, "organic", health or spice claim/);
  assert.doesNotMatch(prompt, /00000000-/, "never the real ids");
  assert.deepEqual(editableItems([...items, item(ID(4), "Shop", "Feed thing", 100, { source: "feed" })]).length, 3, "items from the business's own system stay out");
});

test("its answer is read strictly: unknown refs, bad prices and made-up ops are dropped", () => {
  const read = resolveModelChanges({
    summary: "Raise cocktails",
    changes: [
      { op: "price", item: "i1", price: 715 },
      { op: "price", item: "i9", price: 100 },
      { op: "price", item: "i2", price: -5 },
      { op: "drop_table", item: "i1" },
      { op: "stock", item: "i2", available: true },
      { op: "add", name: "Chicken Tikka", price: "950" },
    ],
  }, items);
  assert.deepEqual(read.changes, [
    { op: "price", item_id: ID(1), price: 715 },
    { op: "stock", item_id: ID(2), available: true },
    { op: "add", name: "Chicken Tikka", price: 950, section: null, description: null },
  ]);
  assert.equal(read.dropped, 3);
  const { previews } = previewChanges(read.changes, items);
  assert.deepEqual(previews.map((p) => `${p.label}: ${p.before ?? ""} → ${p.after}`), ["Mojito: KSh 650 → KSh 715", "Dawa: Out of stock → In stock", "Chicken Tikka:  → KSh 950"]);
  assert.equal(readChange({ op: "price", item_id: "x", price: 5 }), null);
  assert.equal(readChange({ op: "price", item_id: ID(1), price: 0 }), null);
  assert.deepEqual(readChange({ op: "hide", item_id: ID(1) }), { op: "hide", item_id: ID(1) });
});

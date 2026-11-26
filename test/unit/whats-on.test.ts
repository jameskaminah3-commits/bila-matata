// test/unit/whats-on.test.ts
//
// What's on: what the team may post and when it happens; the menu as Zaina
// reads it; and the thinking setting each model family takes.

import assert from "node:assert/strict";
import test from "node:test";
import { checkVenuePayment } from "../../src/businesses/settings.ts";
import { renderPay } from "../../src/frontdoor/page.ts";
import { refusedThinking, thinkingConfigFor } from "../../src/engine/agent.ts";
import type { DoorItem } from "../../src/frontdoor/catalogue.ts";
import { menuAtAGlance, payingPrompt } from "../../src/whats-on/knowledge.ts";
import { checkWhatsOn, happensOn, whenOf } from "../../src/whats-on/whats-on.ts";

test("what the team may post: today by default, a day ahead, a run of days, or every week", () => {
  const today = "2026-11-24";
  assert.deepEqual(checkWhatsOn({ text: "  Karaoke   from 8pm " }, today), { ok: true, value: { text: "Karaoke from 8pm", date: today, until: null, weekday: null } });
  assert.deepEqual(checkWhatsOn({ text: "Live band", weekday: 5 }, today), { ok: true, value: { text: "Live band", date: null, until: null, weekday: 5 } });
  assert.deepEqual(checkWhatsOn({ text: "Festive menu", date: "2026-12-20", until: "2026-12-26" }, today).ok, true);
  assert.equal(checkWhatsOn({ text: "Yesterday's", date: "2026-11-23" }, today).ok, false);
  assert.equal(checkWhatsOn({ text: "x" }, today).ok, false);
  assert.equal(checkWhatsOn({ text: "Backwards", date: "2026-12-02", until: "2026-12-01" }, today).ok, false);
  assert.equal(checkWhatsOn({ text: "Every day", weekday: 7 }, today).ok, false);
});

test("when it happens, and how it's said", () => {
  const friday = { date: null, until: null, weekday: 5 };
  assert.equal(happensOn(friday, "2026-11-27"), true);
  assert.equal(happensOn(friday, "2026-11-28"), false);
  const run = { date: "2026-11-24", until: "2026-11-26", weekday: null };
  assert.deepEqual(["2026-11-23", "2026-11-24", "2026-11-26", "2026-11-27"].map((day) => happensOn(run, day)), [false, true, true, false]);
  assert.equal(whenOf({ date: "2026-11-24", until: null, weekday: null }, "2026-11-24"), "today");
  assert.equal(whenOf({ date: "2026-11-25", until: null, weekday: null }, "2026-11-24"), "tomorrow");
  assert.equal(whenOf(friday, "2026-11-24"), "every Friday");
  assert.equal(whenOf(run, "2026-11-24"), "today to Thursday 26 November");
});

test("the menu at a glance: by section, every size with its price, what's out of stock, short descriptions", () => {
  const item = (fields: Partial<DoorItem>): DoorItem => ({ id: "i", name: "", description: null, price: null, section: null, picture: null, inStock: true, variants: [], tell: "", order: null, ...fields });
  const menu = menuAtAGlance([
    item({ name: "Absolut Vodka", section: "Vodka", variants: [{ label: "750ml Bottle", price: "KSh 5,000", inStock: true }, { label: "Shot", price: "KSh 300", inStock: false }] }),
    item({ name: "Beef Samosa", section: "Snacks", price: "KSh 575", description: "x".repeat(120) }),
    item({ name: "Chips", section: "Snacks", price: "KSh 250", inStock: false }),
  ], ["Snacks", "Vodka"]);
  assert.equal(menu, `Snacks: Beef Samosa KSh 575 (${"x".repeat(88)}…); Chips KSh 250 (out of stock)\nVodka: Absolut Vodka 750ml Bottle KSh 5,000, Shot KSh 300 (out of stock)`);
});

test("she thinks briefly: each model family takes the setting its own way, and one that refuses it is called without", () => {
  assert.deepEqual(thinkingConfigFor("gemini-3.5-flash-lite", "low"), { thinkingConfig: { thinkingLevel: "low" } });
  assert.deepEqual(thinkingConfigFor("gemini-2.5-flash", "minimal"), { thinkingConfig: { thinkingBudget: 0 } });
  assert.equal(thinkingConfigFor("gemini-3.5-flash-lite", "off"), null);
  assert.equal(thinkingConfigFor("some-other-model", "low"), null);
  const refusal = Object.assign(new Error("Thinking level is not supported for this model."), { status: 400 });
  assert.equal(refusedThinking("gemini-3-test", refusal, false), false, "nothing was sent");
  assert.equal(refusedThinking("gemini-3-test", Object.assign(new Error("Bad request"), { status: 400 }), true), false, "another problem");
  assert.equal(refusedThinking("gemini-3-test", refusal, true), true);
  assert.equal(thinkingConfigFor("gemini-3-test", "low"), null, "from then on, without");
});

test("how guests pay at the place: checked, shown with a Copy button, and told to Zaina only for paying there", () => {
  assert.deepEqual(checkVenuePayment({ till: " 512 3456 ", name: "  BISTRO  LTD " }), { ok: true, value: { till: "5123456", paybill: null, account: null, name: "BISTRO LTD" } });
  assert.deepEqual(checkVenuePayment({ paybill: "247-247", account: "TABLE" }), { ok: true, value: { till: null, paybill: "247247", account: "TABLE", name: null } });
  assert.deepEqual(checkVenuePayment({ till: "", paybill: "" }), { ok: true, value: null }, "nothing at all clears it");
  assert.deepEqual(checkVenuePayment(null), { ok: true, value: null });
  for (const bad of [{ till: "1234" }, { till: "123456789" }, { till: "51a3456" }, { paybill: "12345678" }, { account: "TABLE" }, { till: 5123456 }, [], "5123456"]) {
    assert.equal(checkVenuePayment(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(renderPay(null), "");
  const html = renderPay({ till: "5123456", paybill: null, account: null, name: "BISTRO <LTD>" });
  assert.match(html, /data-copy="5123456"/);
  assert.match(html, /M-Pesa shows <b>BISTRO &lt;LTD&gt;<\/b>/, "escaped");
  assert.equal(payingPrompt(null), "");
  const prompt = payingPrompt({ till: null, paybill: "247247", account: "TABLE", name: "BISTRO LTD" });
  assert.match(prompt, /M-Pesa Paybill 247247, account TABLE/);
  assert.match(prompt, /For a booking or an order made in this chat, use its own payment link, never this\./);
});

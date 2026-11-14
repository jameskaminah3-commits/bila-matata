// Business cards: every design, both sides, with short, long and missing
// details, keeps its text inside the safe area and off other text; colours
// stay readable; the picture carries nothing that can run.

import assert from "node:assert/strict";
import test from "node:test";
import { CARD, contrast, paletteFor, readableAccent, renderCard, type CardInput } from "../../src/cards/render.ts";
import { fitLine, run, wrap } from "../../src/cards/type.ts";
import type { CardDetails } from "../../src/db/schema.ts";

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const full: Omit<CardDetails, "design"> = { personName: "Amani Wanjiku", personTitle: "Founder & lead stylist", phone: "+254 700 000 123", email: "hello@amanihair.co.ke", website: "amanihair.co.ke", address: "Links Road, Nyali, Mombasa" };
const longest: Omit<CardDetails, "design"> = {
  personName: "Wanjiru Nyambura Kamau-Otieno Achieng Wairimu Muthoni Kip".slice(0, 60),
  personTitle: "Head of guest relations and reservations, coast region".slice(0, 60),
  phone: "+254 700 000 123 / +254 711 222 333 / +254 7".slice(0, 40),
  email: "reservations.and.guest.relations@the-longest-lodge-name-in-kenya.example.co.ke".slice(0, 120),
  website: "www.the-longest-lodge-name-in-kenya.example.co.ke/stay-with-us/rooms-and-rates",
  address: "Plot 1234, Diani Beach Road, opposite the old baobab tree, Ukunda, Kwale County, Kenya",
};
const none: Omit<CardDetails, "design"> = { personName: null, personTitle: null, phone: null, email: null, website: null, address: null };

const input = (design: CardDetails["design"], over: Partial<CardInput> = {}, details = full): CardInput => ({
  name: "Amani Hair Studio", tagline: "Hair and beauty in Nyali, open every day", assistant: "Zaina", role: "front desk host", color: "#7c3aed", logo: null,
  qrTarget: "https://bilamatata.co.ke/k/amani-hair", qrLabel: "bilamatata.co.ke/k/amani-hair", details: { design, ...details }, ...over,
});

const CASES: Array<[string, Partial<CardInput>, Omit<CardDetails, "design">]> = [
  ["everything filled", {}, full],
  ["the longest of everything", { name: "The Baobab Ridge Lodge, Spa & Conference Retreat of the South Coast", tagline: "Boutique stays, weddings and retreats above Diani Beach, with a view of the reef", logo: LOGO, color: "#fde68a", qrTarget: "https://bilamatata.co.ke/k/the-baobab-ridge-lodge-and-spa-retreat", qrLabel: "bilamatata.co.ke/k/the-baobab-ridge-lodge-and-spa-retreat" }, longest],
  ["only the name", { tagline: null, color: "#111827" }, none],
  ["one-word name, light colour", { name: "Tamarind", color: "#38bdf8", logo: LOGO }, { ...none, phone: "+254 700 000 456" }],
];

test("every design keeps its text inside the safe area, off other text, whatever the details", () => {
  for (const design of ["signature", "minimal", "bold"] as const) {
    for (const [label, over, details] of CASES) {
      for (const side of ["front", "back"] as const) {
        const { svg, boxes } = renderCard(input(design, over, details), side);
        const where = `${design} ${side}, ${label}`;
        assert.ok(boxes.length > 0, where);
        for (const box of boxes) {
          assert.ok(box.x >= CARD.safe - 0.05 && box.x + box.width <= CARD.width - CARD.safe + 0.05, `${where}: "${box.text}" runs sideways out of the safe area (${box.x.toFixed(2)}–${(box.x + box.width).toFixed(2)})`);
          assert.ok(box.top >= CARD.safe - 1.6 && box.bottom <= CARD.height - CARD.safe + 1.6, `${where}: "${box.text}" leaves the safe area vertically (${box.top.toFixed(2)}–${box.bottom.toFixed(2)})`);
        }
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i];
            const b = boxes[j];
            const apart = a.x + a.width <= b.x + 0.2 || b.x + b.width <= a.x + 0.2 || a.bottom <= b.top + 0.2 || b.bottom <= a.top + 0.2;
            assert.ok(apart, `${where}: "${a.text}" and "${b.text}" overlap`);
          }
        }
        // A picture that runs nothing and loads nothing from outside.
        assert.doesNotMatch(svg, /<script|\son[a-z]+=|href="(?!#|data:image\/)/i, where);
        assert.match(svg, /width="85mm" height="55mm"/, where);
      }
    }
  }
});

test("long text shrinks, then wraps, then is shortened; nothing is ever cut mid-letter", () => {
  const line = run("Amani Hair Studio", "sans-800", 4.5);
  assert.ok(line.width > 30 && line.width < 50, `about 40 mm (${line.width})`);
  const fitted = fitLine("A very long business name that cannot fit on one small line", "sans-800", 4.5, 40, { min: 3.6 });
  assert.ok(fitted.width <= 40);
  assert.ok(fitted.text.endsWith("…"));
  const wrapped = wrap("A very long business name that cannot fit on one small line", "sans-800", 4.5, 40, 2, { min: 3.6 });
  assert.equal(wrapped.length, 2);
  for (const entry of wrapped) assert.ok(entry.width <= 40);
  // Kerning is applied: "AV" is narrower than "A" and "V" set apart.
  assert.ok(run("AV", "serif-600", 10).width < run("A", "serif-600", 10).width + run("V", "serif-600", 10).width);
  // Letters outside the basic Latin set come from the extended set, not a blank box.
  assert.ok(run("Ŋwena Café", "sans-500", 3).glyphs.every((glyph) => glyph.glyph.index !== 0));
});

test("text on a colour reads, and accents are adjusted until they do", () => {
  for (const color of ["#0f766e", "#7c3aed", "#fde68a", "#38bdf8", "#111827", "#ffffff", "#ef4444"]) {
    const palette = paletteFor(color);
    // White or ink, whichever reads better: at least 4.5 to 1 for any colour (the worst case, a mid-tone, sits around 4.6).
    assert.ok(contrast(palette.onBrand, palette.brand) >= 4.5, `${color}: text on the colour (${palette.onBrand} on ${palette.brand})`);
    assert.ok(contrast(palette.accentOnDark, palette.deep) >= 4.5, `${color}: accent on the deep front (${palette.accentOnDark} on ${palette.deep})`);
    assert.ok(contrast(palette.accentOnLight, "#ffffff") >= 4.5, `${color}: accent on white`);
  }
  assert.equal(readableAccent("#7c3aed", "#ffffff"), "#7c3aed", "a colour that already reads is kept");
  assert.equal(paletteFor("not a colour").brand, "#0f766e");
});

test("each glyph is drawn once and placed where it's used, and the card bleeds when asked", () => {
  const { svg } = renderCard(input("minimal"), "front");
  const defined = svg.match(/<path id="sans-/g)?.length ?? 0;
  const used = svg.match(/<use href="#sans-/g)?.length ?? 0;
  assert.ok(used > defined * 1.5, `${used} uses of ${defined} glyphs`);
  const bled = renderCard(input("bold"), "front", { bleed: true }).svg;
  assert.match(bled, /viewBox="-3 -3 91 61" width="91mm" height="61mm"/);
  // The back carries the card's code, and says where it goes.
  const back = renderCard(input("signature"), "back").svg;
  assert.match(back, /<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" viewBox="0 0 \d+ \d+">/);
  assert.ok(Buffer.byteLength(back) < 200_000, `a side is small enough to send as you type (${Math.round(Buffer.byteLength(back) / 1024)} KB)`);
});

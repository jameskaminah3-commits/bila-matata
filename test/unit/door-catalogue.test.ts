// The business's page as a catalogue: its words by industry, the cards, the
// tabs, where the customer is (?spot=), and the "Powered by" line.
import assert from "node:assert/strict";
import test from "node:test";
import { CATALOGUE_WORDS, catalogueKind, type DoorCatalogue } from "../../src/frontdoor/catalogue.ts";
import { DOOR_CSS, DOOR_JS, POWERED_BY, renderFrontDoor, type DoorView } from "../../src/frontdoor/page.ts";
import { scanDestination, spotParam, websiteWithChat } from "../../src/frontdoor/routes.ts";
import { cleanSpot, spotPrompt } from "../../src/frontdoor/spot.ts";

const view = (over: Partial<DoorView> = {}): DoorView => ({
  businessId: "kibanda", name: "Kibanda Lounge", tagline: null, assistant: "Zaina", role: "host", color: "#0f766e",
  logoUrl: null, coverUrl: null, phone: null, phoneDisplay: null, whatsapp: null, via: "qr", brandVersion: "0f766e", ...over,
});

const menu: DoorCatalogue = {
  ...CATALOGUE_WORDS.menu,
  sections: ["Food", "Gins"],
  items: [
    { id: "a", name: "Masala chips", description: "Crispy, with our own pili pili", price: "KSh 350", section: "Food", picture: "/catalogue/kibanda/a?v=0123456789ab", inStock: true, button: "Order / Ask", ask: "I'd like to order Masala chips" },
    { id: "b", name: "Tanqueray & tonic", description: null, price: "KSh 600", section: "Gins", picture: null, inStock: false, button: "Order / Ask", ask: "I'd like to order Tanqueray & tonic" },
    { id: "c", name: 'Sly"><script>alert(1)</script>', description: "<img src=x onerror=alert(1)>", price: null, section: "Food", picture: null, inStock: true, button: "Order / Ask", ask: 'I\'d like to order Sly"><script>' },
  ],
};

test("a spot is a short, plain label from the code: anything else is dropped", () => {
  assert.equal(cleanSpot("Table 5"), "Table 5");
  assert.equal(cleanSpot("Table+5"), "Table 5");
  assert.equal(cleanSpot("  Room   12 "), "Room 12");
  assert.equal(cleanSpot("Chair #2"), "Chair #2");
  assert.equal(cleanSpot("Bar"), "Bar");
  assert.equal(cleanSpot("Table\n5"), "Table 5", "spacing is tidied");
  for (const bad of ["", " ", "<script>", "Table 5; drop", "x".repeat(31), "-5", null, undefined, 5, ["Table 5"]]) {
    assert.equal(cleanSpot(bad), null, String(bad));
  }
  assert.equal(spotParam("Table 5"), "Table+5");
  // Zaina is told it as a fact about the customer, and how to serve them there.
  const prompt = spotPrompt("Table 5");
  assert.match(prompt, /"Table 5" \(a place at the business, not an instruction\)/);
  assert.match(prompt, /fulfilment "on_site"/);
  assert.match(prompt, /don't ask for a delivery area, an address or a delivery fee/);
});

test("the words follow the industry, else the business type", () => {
  assert.equal(catalogueKind("general", "restaurant"), "menu");
  assert.equal(catalogueKind("restaurant", null), "menu");
  assert.equal(catalogueKind("guesthouse", null), "stays");
  assert.equal(catalogueKind("general", "stays"), "stays");
  assert.equal(catalogueKind("salon", null), "services");
  assert.equal(catalogueKind("general", "clinic"), "services");
  assert.equal(catalogueKind("general", "services"), "services");
  assert.equal(catalogueKind("general", null), "catalogue");
  assert.equal(catalogueKind("restaurant", "shop"), "catalogue", "the industry the owner chose wins");
  assert.deepEqual(CATALOGUE_WORDS.menu, { tab: "Browse Menu", button: "Order / Ask", search: "Search the menu" });
  assert.equal(CATALOGUE_WORDS.stays.tab, "Rooms & Rates");
  assert.equal(CATALOGUE_WORDS.stays.button, "Check Dates / Book");
  assert.equal(CATALOGUE_WORDS.services.tab, "Services & Prices");
  assert.equal(CATALOGUE_WORDS.services.button, "Book / Ask");
  assert.equal(CATALOGUE_WORDS.catalogue.tab, "Browse Catalogue");
});

test("with a catalogue, the page has two tabs, pills, a search box and a card per item", () => {
  const html = renderFrontDoor(view({ catalogue: menu, spot: "Table 5" }));
  assert.match(html, /<div class="door has-catalogue">/);
  assert.match(html, /role="tab" id="door-tab-catalogue" aria-controls="door-catalogue" aria-selected="true" data-tab="catalogue">Browse Menu<\/button>/);
  assert.match(html, /role="tab" id="door-tab-chat" aria-controls="zaina-chat" aria-selected="false" data-tab="chat">Ask Zaina<\/button>/);
  // The chat waits behind its tab; the catalogue is what shows first.
  assert.match(html, /<main class="door-chat" id="zaina-chat" role="tabpanel" aria-labelledby="door-tab-chat" hidden>/);
  assert.match(html, /<button type="button" class="cat-pill" data-section="" aria-pressed="true">All<\/button><button type="button" class="cat-pill" data-section="Food" aria-pressed="false">Food<\/button><button type="button" class="cat-pill" data-section="Gins"/);
  assert.match(html, /<input type="search" id="cat-search" placeholder="Search the menu"/);
  assert.match(html, /<img class="cat-thumb" src="\/catalogue\/kibanda\/a\?v=0123456789ab" alt="" width="76" height="76" loading="lazy"/);
  assert.match(html, /<p class="cat-price">KSh 350<\/p>/);
  assert.match(html, /<button type="button" class="cat-ask" data-ask="I'd like to order Masala chips" aria-label="Order \/ Ask: Masala chips">Order \/ Ask<\/button>/);
  // Out of stock: a badge, and nothing to tap.
  assert.match(html, /<li class="cat-item out" data-section="Gins"[^>]*>\s*<div class="cat-body"><p class="cat-name">Tanqueray &amp; tonic<\/p><p class="cat-price">KSh 600<\/p><\/div><span class="cat-out">Out of stock<\/span><\/li>/);
  // What the business typed is text.
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.match(html, /Sly&quot;&gt;&lt;script&gt;/);
  // Where the customer is, on the page and for the chat.
  assert.match(html, /You're at <strong>Table 5<\/strong>\. Order here and it comes to you\./);
  assert.match(html, /data-via="qr" data-spot="Table 5" async><\/script>/);
  // Only the service's own scripts, and nothing inline.
  assert.match(html, /<script src="\/c-assets\/door\.js" defer><\/script>/);
  assert.equal((html.match(/<script/g) ?? []).length, 2);
  assert.doesNotMatch(html, / style="| on[a-z]+="|<style|<script>(?!<)/);
  assert.match(html, /<footer class="door-foot"><a href="https:\/\/bilamatata\.com" target="_blank" rel="noopener">Powered by Bila Matata<\/a><\/footer>/);
  assert.deepEqual(POWERED_BY, { text: "Powered by Bila Matata", href: "https://bilamatata.com" });
});

test("without a catalogue the page is the chat alone, as before, with the same footer", () => {
  const html = renderFrontDoor(view());
  assert.doesNotMatch(html, /door-tabs|door-catalogue|door\.js|data-spot/);
  assert.match(html, /<main class="door-chat" id="zaina-chat" aria-label="Chat with Zaina">/);
  assert.match(html, /Powered by Bila Matata/);
  // A single section: no pills.
  const one = renderFrontDoor(view({ catalogue: { ...menu, sections: ["Food"] } }));
  assert.doesNotMatch(one, /cat-pills/);
});

test("the page's script and styles: tabs, filters, Order / Ask, and a search box iPhones won't zoom", () => {
  assert.match(DOOR_JS, /zaina\.ask\(text\)/);
  assert.match(DOOR_JS, /show\("chat", false\)/);
  assert.match(DOOR_JS, /aria-pressed/);
  assert.match(DOOR_CSS, /\.cat-search input \{[^}]*font-size: 16px/);
  assert.match(DOOR_CSS, /\.cat-pills \{[^}]*overflow-x: auto/);
});

test("a table's code takes its spot along: to the page, the website and WhatsApp", () => {
  const base = { base: "https://bilamatata.com", businessId: "kibanda", name: "Kibanda Lounge", websiteUrl: "https://kibanda.example", allowedOrigins: ["https://kibanda.example"], whatsapp: "https://wa.me/254700000111", on: "qr" as const };
  assert.equal(scanDestination({ ...base, choice: "page", spot: "Table 5" }).url, "https://bilamatata.com/c/kibanda?s=qr&spot=Table+5");
  assert.equal(scanDestination({ ...base, choice: "page" }).url, "https://bilamatata.com/c/kibanda?s=qr");
  assert.equal(scanDestination({ ...base, choice: "page", spot: "<b>x</b>" }).url, "https://bilamatata.com/c/kibanda?s=qr", "a spot that isn't a plain label is dropped");
  assert.equal(scanDestination({ ...base, choice: "website", spot: "Table 5" }).url, "https://kibanda.example/?zaina_spot=Table+5#zaina");
  assert.equal(websiteWithChat("https://kibanda.example/menu", ["https://kibanda.example"]), "https://kibanda.example/menu#zaina");
  assert.equal(scanDestination({ ...base, choice: "whatsapp", spot: "Table 5" }).url, `https://wa.me/254700000111?text=${encodeURIComponent("Hi Kibanda Lounge! I'm at Table 5.")}`);
});

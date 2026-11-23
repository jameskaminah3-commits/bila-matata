// The business's page as a catalogue: its words by industry, the cards that
// open, sizes grouped, Zaina only when wanted, where the customer is
// (?spot=), and the "Powered by" line.
import assert from "node:assert/strict";
import test from "node:test";
import { CATALOGUE_WORDS, catalogueKind, groupVariants, type DoorCatalogue, type DoorItem } from "../../src/frontdoor/catalogue.ts";
import { DOOR_CSS, DOOR_JS, POWERED_BY, renderFrontDoor, type DoorView } from "../../src/frontdoor/page.ts";
import { scanDestination, spotParam, websiteWithChat } from "../../src/frontdoor/routes.ts";
import { cleanSpot, spotPrompt } from "../../src/frontdoor/spot.ts";

const view = (over: Partial<DoorView> = {}): DoorView => ({
  businessId: "kibanda", name: "Kibanda Lounge", tagline: null, assistant: "Zaina", role: "host", color: "#0f766e",
  logoUrl: null, coverUrl: null, phone: null, phoneDisplay: null, whatsapp: null, via: "qr", brandVersion: "0f766e", ...over,
});

const item = (over: Partial<DoorItem> & { name: string }): DoorItem => ({
  id: over.name, description: null, price: null, section: null, picture: null, inStock: true, variants: [],
  tell: `Tell me about ${over.name}`, order: { verb: "order", text: `I'd like to order ${over.name}` }, ...over,
});

const menu: DoorCatalogue = {
  ...CATALOGUE_WORDS.menu,
  sections: ["Food", "Gins"],
  items: [
    item({ id: "a", name: "Masala chips", description: "Crispy, with our own pili pili", price: "KSh 350", section: "Food", picture: "/catalogue/kibanda/a?v=0123456789ab" }),
    item({ id: "b", name: "Tanqueray & tonic", price: "KSh 600", section: "Gins", inStock: false }),
    item({ id: "c", name: 'Sly"><script>alert(1)</script>', description: "<img src=x onerror=alert(1)>", section: "Food" }),
    item({ id: "d", name: "Absolut Vodka", section: "Gins", variants: [{ label: "750ml Bottle", price: "KSh 5,000", inStock: true }, { label: "Shot", price: "KSh 300", inStock: false }] }),
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

test("the tab is named for the industry, else the business type", () => {
  assert.equal(catalogueKind("general", "restaurant"), "menu");
  assert.equal(catalogueKind("restaurant", null), "menu");
  assert.equal(catalogueKind("guesthouse", null), "stays");
  assert.equal(catalogueKind("general", "stays"), "stays");
  assert.equal(catalogueKind("salon", null), "services");
  assert.equal(catalogueKind("general", "clinic"), "services");
  assert.equal(catalogueKind("general", null), "catalogue");
  assert.equal(catalogueKind("restaurant", "shop"), "catalogue", "the industry the owner chose wins");
  assert.deepEqual(CATALOGUE_WORDS.menu, { tab: "Browse Menu", search: "Search the menu" });
  assert.equal(CATALOGUE_WORDS.stays.tab, "Rooms & Rates");
  assert.equal(CATALOGUE_WORDS.services.tab, "Services & Prices");
  assert.equal(CATALOGUE_WORDS.catalogue.tab, "Browse Catalogue");
});

test("sizes of one thing in a section are one card with a price each; a lone bracket stays as it is", () => {
  const vodka = (size: string, price: string, inStock = true) =>
    item({ id: size, name: `Absolut Vodka (${size})`, section: "Vodka", price, inStock, description: size === "Shot" ? null : "Swedish, smooth" });
  const grouped = groupVariants([
    vodka("750ml Bottle", "KSh 5,000"), item({ name: "Airport transfer (Moi Airport)", section: "Vodka" }),
    vodka("1L Bottle", "KSh 6,500", false), vodka("Shot", "KSh 300"), item({ name: "Absolut Vodka (Shot)", section: "Gins" }),
  ]);
  assert.deepEqual(grouped.map((entry) => entry.name), ["Absolut Vodka", "Airport transfer (Moi Airport)", "Absolut Vodka (Shot)"]);
  assert.deepEqual(grouped[0].variants, [
    { label: "750ml Bottle", price: "KSh 5,000", inStock: true }, { label: "1L Bottle", price: "KSh 6,500", inStock: false }, { label: "Shot", price: "KSh 300", inStock: true },
  ]);
  assert.equal(grouped[0].price, null);
  assert.equal(grouped[0].description, "Swedish, smooth");
  assert.equal(grouped[0].tell, "Tell me about Absolut Vodka");
  assert.equal(grouped[0].order?.text, "I'd like to order Absolut Vodka");
});

test("with a catalogue, the page opens on it: cards open in place, and Zaina is there only for those who want her", () => {
  const html = renderFrontDoor(view({ catalogue: menu, spot: "Table 5" }));
  assert.match(html, /<div class="door has-catalogue">/);
  // Each section under one heading, its items together, in the menu's order (Food's two items, then Gins' two).
  assert.deepEqual([...html.matchAll(/<li class="cat-heading cat-banner[^"]*" data-heading="([^"]+)">/g)].map((match) => match[1]), ["Food", "Gins"]);
  // Each section opens with a banner: drawn in the business's colour, with its name, until it adds a picture.
  assert.match(html, /<li class="cat-heading cat-banner" data-heading="Food"><div class="cat-banner-text"><span class="cat-banner-brand">Kibanda Lounge<\/span><h2>Food<\/h2><\/div><\/li>/);
  const pictured = renderFrontDoor(view({ catalogue: { ...menu, banners: { Gins: "/catalogue/kibanda/sections/gins?v=0123456789ab" } } }));
  assert.match(pictured, /<li class="cat-heading cat-banner has-picture" data-heading="Gins"><img class="cat-banner-img" src="\/catalogue\/kibanda\/sections\/gins\?v=0123456789ab" alt="" width="1200" height="480" loading="lazy" decoding="async">/);
  assert.ok(html.indexOf("Masala chips") < html.indexOf("Sly&quot;") && html.indexOf("Sly&quot;") < html.indexOf("Tanqueray"), "a section's items stay together");
  assert.match(html, /<html lang="en">/, "the guest's phone decides light or dark by default");
  assert.match(renderFrontDoor(view({ catalogue: menu, menuStyle: "dark" })), /<html lang="en" data-menu="dark">/);
  assert.match(DOOR_CSS, /:root\[data-menu="dark"\] \{ --bg: #0e1412/);
  assert.match(DOOR_CSS, /:root:not\(\[data-menu="light"\]\)/);
  assert.match(html, /role="tab" id="door-tab-catalogue" aria-controls="door-catalogue" aria-selected="true" data-tab="catalogue">Browse Menu<\/button>/);
  assert.match(html, /role="tab" id="door-tab-chat" aria-controls="zaina-chat" aria-selected="false" data-tab="chat">Ask Zaina<\/button>/);
  assert.match(html, /<main class="door-chat" id="zaina-chat" role="tabpanel" aria-labelledby="door-tab-chat" hidden>/);
  assert.match(html, /<button type="button" class="cat-pill" data-section="" aria-pressed="true">All<\/button><button type="button" class="cat-pill" data-section="Food" aria-pressed="false">Food<\/button><button type="button" class="cat-pill" data-section="Gins"/);
  assert.doesNotMatch(html, /cat-jump/, "two sections: the pills are enough");
  assert.match(html, /<input type="search" id="cat-search" placeholder="Search the menu"/);
  // A card is a closed <details>: name, short description and price. Opened: the photo and the optional buttons.
  assert.match(html, /<details class="cat-card">\n<summary><img class="cat-thumb" src="\/catalogue\/kibanda\/a\?v=0123456789ab" alt="" width="64" height="64" loading="lazy" decoding="async"><span class="cat-body"><span class="cat-name">Masala chips<\/span><span class="cat-desc">Crispy, with our own pili pili<\/span><span class="cat-price">KSh 350<\/span><\/span><\/summary>/);
  assert.match(html, /<img class="cat-photo" src="\/catalogue\/kibanda\/a\?v=0123456789ab" alt="Masala chips" loading="lazy" decoding="async"><div class="cat-actions"><button type="button" class="cat-zaina" data-ask="Tell me about Masala chips">Ask Zaina about this<\/button><button type="button" class="cat-zaina main" data-ask="I'd like to order Masala chips">Order via Zaina<\/button><\/div>/);
  // Out of stock, no photo: initials in the brand's tint, a badge, and nothing to order (asking is still there).
  assert.match(html, /<li class="cat-item out" data-section="Gins"[^>]*><details class="cat-card">\n<summary><span class="cat-mono" aria-hidden="true">TT<\/span><span class="cat-body"><span class="cat-name">Tanqueray &amp; tonic<\/span><span class="cat-price">KSh 600<\/span><\/span><span class="cat-out">Out of stock<\/span><\/summary>\n<div class="cat-more"><div class="cat-actions"><button type="button" class="cat-zaina" data-ask="Tell me about Tanqueray &amp; tonic">Ask Zaina about this<\/button><\/div><\/div>/);
  // Sizes: one card, a price badge each.
  assert.match(html, /<span class="cat-variants"><span class="cat-variant">750ml Bottle <b>KSh 5,000<\/b><\/span><span class="cat-variant out">Shot <b>KSh 300<\/b> <em>Out of stock<\/em><\/span><\/span>/);
  assert.match(html, /data-search="absolut vodka gins 750ml bottle shot"/);
  // What the business typed is text.
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.match(html, /Sly&quot;&gt;&lt;script&gt;/);
  // Where the customer is, on the page and for the chat; and the optional pill.
  assert.match(html, /You're at <strong>Table 5<\/strong>\. Anything you order here is brought to you\./);
  assert.match(html, /data-via="qr" data-spot="Table 5" async><\/script>/);
  assert.match(html, /<div class="cat-nudge" id="cat-nudge"><button type="button" class="cat-nudge-go" data-tab-to="chat">Need a recommendation\? Ask Zaina<\/button><button type="button" class="cat-nudge-x" id="cat-nudge-x" aria-label="Hide this">×<\/button><\/div>/);
  // Only the service's own scripts, and nothing inline.
  assert.match(html, /<script src="\/c-assets\/door\.js" defer><\/script>/);
  assert.equal((html.match(/<script/g) ?? []).length, 2);
  assert.doesNotMatch(html, / style="| on[a-z]+="|<style|<script>(?!<)/);
  assert.match(html, /<footer class="door-foot"><a href="https:\/\/bilamatata\.com" target="_blank" rel="noopener">Powered by Bila Matata<\/a><\/footer>/);
  assert.deepEqual(POWERED_BY, { text: "Powered by Bila Matata", href: "https://bilamatata.com" });

  // A business that doesn't take orders online: no order button, and the spot line says only where they are.
  const quiet = renderFrontDoor(view({ catalogue: { ...menu, items: menu.items.map((entry) => ({ ...entry, order: null })) }, spot: "Table 5" }));
  assert.doesNotMatch(quiet, /cat-zaina main|Order via/);
  assert.match(quiet, /You're at <strong>Table 5<\/strong>\.<\/span>/);
  // Many sections: a one-tap jump as well as the pills.
  const big = renderFrontDoor(view({ catalogue: { ...menu, sections: ["Food", "Gins", "Wines", "Beers", "Shots"] } }));
  assert.match(big, /<select id="cat-jump"><option value="">Jump to…<\/option><option value="Food">Food<\/option>/);
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

test("the page's script and styles: tabs, filters, the jump, the optional pill, and type that reads in low light", () => {
  assert.match(DOOR_JS, /zaina\.ask\(text\)/);
  assert.match(DOOR_JS, /show\("chat", false\)/);
  assert.match(DOOR_JS, /aria-pressed/);
  assert.match(DOOR_JS, /jump\.addEventListener\("change"/);
  assert.match(DOOR_JS, /sessionStorage\.setItem\("door-nudge", "hidden"\)/);
  assert.match(DOOR_CSS, /\.cat-search input \{[^}]*font-size: 16px/);
  assert.match(DOOR_CSS, /\.cat-jump select \{[^}]*font-size: 16px/);
  assert.match(DOOR_CSS, /\.cat-name \{[^}]*font-size: 1\.0625rem; font-weight: 700/);
  assert.match(DOOR_CSS, /\.cat-price \{[^}]*font-weight: 800; font-variant-numeric: tabular-nums/);
  assert.match(DOOR_CSS, /\.cat-pills \{[^}]*overflow-x: auto/);
});

test("a table's code takes its spot along: to the page, the website and WhatsApp", () => {
  const base = { base: "https://bilamatata.com", businessId: "kibanda", name: "Kibanda Lounge", websiteUrl: "https://kibanda.example", allowedOrigins: ["https://kibanda.example"], whatsapp: "https://wa.me/254700000111", on: "qr" as const };
  assert.equal(scanDestination({ ...base, choice: "page", spot: "Table 5" }).url, "https://kibanda.bilamatata.com/?s=qr&spot=Table+5");
  assert.equal(scanDestination({ ...base, choice: "page" }).url, "https://kibanda.bilamatata.com/?s=qr");
  assert.equal(scanDestination({ ...base, choice: "page", spot: "<b>x</b>" }).url, "https://kibanda.bilamatata.com/?s=qr", "a spot that isn't a plain label is dropped");
  assert.equal(scanDestination({ ...base, choice: "website", spot: "Table 5" }).url, "https://kibanda.example/?zaina_spot=Table+5#zaina");
  assert.equal(websiteWithChat("https://kibanda.example/menu", ["https://kibanda.example"]), "https://kibanda.example/menu#zaina");
  assert.equal(scanDestination({ ...base, choice: "whatsapp", spot: "Table 5" }).url, `https://wa.me/254700000111?text=${encodeURIComponent("Hi Kibanda Lounge! I'm at Table 5.")}`);
});

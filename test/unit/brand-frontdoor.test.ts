// A business's brand and its front door (the page behind its QR code), and
// the rule that Zaina is a receptionist, never a cashier.

import assert from "node:assert/strict";
import test from "node:test";
import { BRAND_MAX_BYTES, brandAssetUrl, checkBrandImage, readableOn, sniffImage } from "../../src/brand/assets.ts";
import { allowedOriginsFor, setFrontDoorOrigins } from "../../src/businesses/registry.ts";
import { validateSettingsPatch } from "../../src/businesses/settings.ts";
import { CONCIERGE_GUIDANCE } from "../../src/engine/concierge.ts";
import { brandCss, DOOR_CSS, DOOR_JS, initials, publicAbout, renderDoorClosed, renderFrontDoor, type DoorView } from "../../src/frontdoor/page.ts";
import type { DoorItem } from "../../src/frontdoor/catalogue.ts";
import { qrSvg } from "../../src/frontdoor/qr.ts";
import { doorSource, looksLikePerson } from "../../src/frontdoor/stats.ts";
import { isOriginAllowed } from "../../src/gateway/origin.ts";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 1), Buffer.from("WEBP"), Buffer.alloc(32, 1)]);

test("a picture is what its bytes say it is: PNG, JPEG or WebP, and nothing that can carry script", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(WEBP), "image/webp");
  for (const fake of ["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "<html><body>hi</body></html>", "GIF89a...", "%PDF-1.7", ""]) {
    assert.equal(sniffImage(Buffer.from(fake)), null, fake.slice(0, 12));
  }
  assert.deepEqual(checkBrandImage("logo", PNG), { ok: true, contentType: "image/png", bytes: PNG });
  assert.equal(checkBrandImage("logo", Buffer.from("<svg/>")).ok, false);
  assert.equal(checkBrandImage("logo", "not bytes").ok, false);
  assert.equal(checkBrandImage("logo", Buffer.alloc(0)).ok, false);
  // A logo is small, a cover is a photograph: each has its own size.
  const big = Buffer.concat([PNG, Buffer.alloc(BRAND_MAX_BYTES.logo)]);
  const tooBig = checkBrandImage("logo", big);
  assert.ok(!tooBig.ok && /up to 300 KB/.test(tooBig.message));
  assert.equal(checkBrandImage("cover", big).ok, true);
  assert.equal(checkBrandImage("cover", Buffer.concat([PNG, Buffer.alloc(BRAND_MAX_BYTES.cover)])).ok, false);
});

test("a picture's address changes with the picture, and text on a colour stays readable", () => {
  const asset = { kind: "logo" as const, contentType: "image/png" as const, sha256: "ab".repeat(32), updatedAt: new Date() };
  assert.equal(brandAssetUrl("https://bilamatata.co.ke", "palm-cove", asset), "https://bilamatata.co.ke/brand/palm-cove/logo?v=abababababab");
  assert.equal(brandAssetUrl("https://bilamatata.co.ke", "palm-cove", null), null);
  assert.equal(readableOn("#0f766e"), "#ffffff");
  assert.equal(readableOn("#fde68a"), "#111827");
  assert.equal(brandCss("#7C3AED"), ":root{--brand:#7c3aed;--on-brand:#ffffff}\n@media (prefers-color-scheme: light){:root{--accent:#7c3aed;--accent-text:#ffffff}}\n");
  assert.match(brandCss("red; } body { display:none"), /--brand:#0f766e/, "anything that isn't a colour falls back");
});

test("the QR code is a clean picture of squares with its quiet margin, the same every time", () => {
  const svg = qrSvg("https://bilamatata.co.ke/c/palm-cove?s=qr");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
  assert.doesNotMatch(svg, /<script|href=|<image|on[a-z]+=/i);
  assert.equal(svg, qrSvg("https://bilamatata.co.ke/c/palm-cove?s=qr"));
  assert.notEqual(svg, qrSvg("https://bilamatata.co.ke/c/another?s=qr"));
  // Four modules of white all round: no square starts in the margin.
  const size = Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
  for (const [, x, y] of svg.matchAll(/M(\d+) (\d+)h/g)) assert.ok(Number(x) >= 4 && Number(y) >= 4 && Number(x) < size - 4 && Number(y) < size - 4);
  assert.match(qrSvg("x", { style: "premium", color: "javascript:alert(1)" }), /fill="#111827"/, "only real colours are used");
});

const view = (over: Partial<DoorView> = {}): DoorView => ({
  businessId: "palm-cove", name: "Palm Cove Stays", tagline: "Sea-view rooms in Diani", assistant: "Zaina", role: "guest experience host", color: "#0f766e",
  logoUrl: null, coverUrl: null, phone: "+254700000321", phoneDisplay: "+254 700 000 321", whatsapp: "https://wa.me/254700000321", via: "qr", brandVersion: "0f766e", ...over,
});

test("a business's page shows its brand, opens its own Zaina, and carries nothing inline", () => {
  const html = renderFrontDoor(view());
  assert.match(html, /<title>Palm Cove Stays — Info &amp; Enquiries<\/title>/);
  assert.match(html, /<h1>Palm Cove Stays<\/h1>\s*<p>Sea-view rooms in Diani<\/p>/);
  assert.match(html, /<span class="door-logo letters">PC<\/span>/, "no logo: its initials");
  assert.match(html, /<script src="\/zaina\.js" data-business="palm-cove" data-mode="page" data-mount="#zaina-chat" data-via="qr" async><\/script>/);
  assert.match(html, /href="tel:\+254700000321"/);
  assert.match(html, /href="https:\/\/wa\.me\/254700000321"/);
  assert.doesNotMatch(html, /noindex/, "the page is for search engines too");
  assert.match(html, /\/c\/palm-cove\/brand\.css\?v=0f766e/);
  // Zaina is the receptionist: the page says who is paid, and that she never asks for card details.
  assert.match(html, /You pay Palm Cove Stays directly\. Zaina never asks for card numbers or PINs\./);
  // The page's policy allows only the service's own files.
  assert.doesNotMatch(html, / style="| on[a-z]+="|<style|<script>(?!<)/);
  assert.equal((html.match(/<script/g) ?? []).length, 2, "the page's own script and the chat's");

  const branded = renderFrontDoor(view({ logoUrl: "https://bilamatata.co.ke/brand/palm-cove/logo?v=abc", coverUrl: "https://bilamatata.co.ke/brand/palm-cove/cover?v=def", via: "link", phone: null, phoneDisplay: null, whatsapp: null, tagline: null }));
  assert.match(branded, /<div class="door has-cover">/);
  assert.match(branded, /<img class="door-cover" src="https:\/\/bilamatata\.co\.ke\/brand\/palm-cove\/cover\?v=def"/);
  assert.match(branded, /<span class="door-logo"><img src="https:\/\/bilamatata\.co\.ke\/brand\/palm-cove\/logo\?v=abc"/);
  assert.match(branded, /data-via="link"/);
  assert.doesNotMatch(branded, /door-actions|tel:/, "no contact buttons without contact details");

  // What a business typed comes back as text.
  const sly = renderFrontDoor(view({ name: 'Bad"><script>alert(1)</script>', tagline: "<img src=x onerror=alert(1)>" }));
  assert.doesNotMatch(sly, /<script>alert|<img src=x/);
  assert.match(sly, /Bad&quot;&gt;&lt;script&gt;/);

  assert.match(renderDoorClosed(), /This page isn't available/);
  assert.doesNotMatch(renderDoorClosed(), /<script/);
  assert.match(DOOR_CSS, /@media \(max-width: 860px\)/);
  assert.match(DOOR_CSS, /prefers-color-scheme: dark/);
});

test("a shared link shows a rich card, and search engines read the business and its menu, item by item", () => {
  const dishes: DoorItem[] = [
    { id: "1", name: "Tapas Burger", description: "Two beef patties, cheese and gherkins", price: "KSh 1,190", amount: { value: 1190, max: null, currency: "KES" }, section: "Burgers", picture: "/catalogue/tapas-gold/1?v=abc", inStock: true, variants: [], tell: "", order: null },
    { id: "2", name: "Beef Samosa", description: null, price: "KSh 575", amount: { value: 575, max: null, currency: "KES" }, section: "Snacks", picture: null, inStock: false, variants: [], tell: "", order: null },
    { id: "3", name: "Jameson", description: null, price: null, section: "Whiskey", picture: null, inStock: true, tell: "", order: null,
      variants: [{ label: "Shot", price: "KSh 400", inStock: true, amount: { value: 400, max: null, currency: "KES" } }, { label: "750ml Bottle", price: "KSh 6,500", inStock: true, amount: { value: 6500, max: null, currency: "KES" } }] },
    { id: "4", name: "Booth", description: null, price: null, section: "Tables", picture: null, inStock: true, variants: [], tell: "", order: null, booking: true },
  ];
  const tapas = view({
    businessId: "tapas-gold", name: "Tapas Gold", tagline: "Dining, Cocktails & Entertainment · Nyali Centre, Mombasa", phone: "+254700000000", phoneDisplay: "0700 000 000",
    logoUrl: "https://tapas-gold.bilamatata.com/brand/tapas-gold/logo?v=abc", coverUrl: "https://tapas-gold.bilamatata.com/brand/tapas-gold/cover?v=def",
    canonicalUrl: "https://tapas-gold.bilamatata.com/", kind: "menu", books: true, address: "Nyali Centre, Links Road, Mombasa", spot: "Table 7",
    about: "Tapas Gold is a lounge and restaurant in Nyali serving tapas, grills and cocktails late into the night. Call the manager on 0722 123 456 for events.",
    catalogue: { tab: "Browse Menu", search: "Search the menu", kind: "menu", items: dishes, sections: ["Burgers", "Snacks", "Whiskey", "Tables"] },
  });
  const html = renderFrontDoor(tapas);
  assert.match(html, /<title>Tapas Gold — Menu &amp; Reservations<\/title>/);
  const description = /<meta name="description" content="([^"]+)">/.exec(html)![1];
  assert.equal(description, "Tapas Gold is a lounge and restaurant in Nyali serving tapas, grills and cocktails late into the night. See the full menu with prices, and book a table.");
  assert.doesNotMatch(html, /0722|manager/, "the about text's contact details never reach the page");
  assert.match(html, /<link rel="canonical" href="https:\/\/tapas-gold\.bilamatata\.com\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/tapas-gold\.bilamatata\.com\/">/, "the table never goes into the shared address");
  assert.match(html, /<meta property="og:image" content="https:\/\/tapas-gold\.bilamatata\.com\/brand\/tapas-gold\/cover\?v=def">/, "the cover first");
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta property="og:title" content="Tapas Gold — Menu &amp; Reservations">/);
  // With only a logo: the logo, as the small square card.
  const logoOnly = renderFrontDoor({ ...tapas, coverUrl: null });
  assert.match(logoOnly, /<meta property="og:image" content="https:\/\/tapas-gold\.bilamatata\.com\/brand\/tapas-gold\/logo\?v=abc">/);
  assert.match(logoOnly, /<meta name="twitter:card" content="summary">/);

  const data = JSON.parse(/<script type="application\/ld\+json">(.+?)<\/script>/s.exec(html)![1]);
  assert.equal(data["@type"], "Restaurant");
  assert.deepEqual([data.name, data.url, data.telephone, data.address.streetAddress, data.acceptsReservations], ["Tapas Gold", "https://tapas-gold.bilamatata.com/", "+254700000000", "Nyali Centre, Links Road, Mombasa", true]);
  assert.deepEqual(data.hasMenu.hasMenuSection.map((section: any) => section.name), ["Burgers", "Snacks", "Whiskey"], "tables booked through the chat aren't on the menu");
  const burger = data.hasMenu.hasMenuSection[0].hasMenuItem[0];
  assert.deepEqual([burger["@type"], burger.name, burger.image, burger.offers.price, burger.offers.priceCurrency, burger.offers.availability], ["MenuItem", "Tapas Burger", "https://tapas-gold.bilamatata.com/catalogue/tapas-gold/1?v=abc", 1190, "KES", "https://schema.org/InStock"]);
  assert.equal(data.hasMenu.hasMenuSection[1].hasMenuItem[0].offers.availability, "https://schema.org/OutOfStock");
  assert.deepEqual(data.hasMenu.hasMenuSection[2].hasMenuItem[0].offers.map((offer: any) => [offer.name, offer.price]), [["Shot", 400], ["750ml Bottle", 6500]], "a price for each size");

  // Share: the page's own address and title, shown once the script runs.
  assert.match(html, /<button type="button" class="door-btn door-share" data-share="https:\/\/tapas-gold\.bilamatata\.com\/" data-share-title="Tapas Gold — Menu &amp; Reservations" hidden>/);
  assert.match(html, /<p class="door-toast" id="door-toast" role="status" aria-live="polite"><\/p>/);
  assert.match(DOOR_JS, /navigator\.share\(\{ title: title, url: url \}\)/);
  assert.match(DOOR_JS, /say\("Link copied"\)/);

  // The Menu plan: the menu alone, so no reservations promised.
  const menuPlan = renderFrontDoor({ ...tapas, chat: false });
  assert.match(menuPlan, /<title>Tapas Gold — Menu<\/title>/);
  assert.doesNotMatch(menuPlan, /acceptsReservations|book a table/);
  // Another kind of business: its price list as an offer catalogue.
  const salon = JSON.parse(/<script type="application\/ld\+json">(.+?)<\/script>/s.exec(renderFrontDoor(view({ canonicalUrl: "https://bilamatata.com/c/palm-cove", kind: "services", catalogue: { tab: "Services & Prices", search: "", kind: "services", items: [dishes[0]], sections: ["Burgers"] } })))![1]);
  assert.deepEqual([salon["@type"], salon.hasOfferCatalog.itemListElement[0].itemListElement[0].itemOffered.name, salon.hasOfferCatalog.itemListElement[0].itemListElement[0].price], ["LocalBusiness", "Tapas Burger", 1190]);

  // What a business typed can't break out of the data block.
  const sly = renderFrontDoor({ ...tapas, name: "</script><script>alert(1)</script>" });
  assert.doesNotMatch(sly, /<\/script><script>alert/);
  assert.equal((sly.match(/<script type="application\/ld\+json">/g) ?? []).length, 1);
  // No public address: no structured data (it needs a real link).
  assert.doesNotMatch(renderFrontDoor({ ...tapas, canonicalUrl: null }), /ld\+json/);
});

test("only the opening of what a business says about itself describes it, never its contact details", () => {
  assert.equal(publicAbout("We cut and style hair in Nyali. Book with Amina on 0722 000 111. Walk-ins welcome."), "We cut and style hair in Nyali.");
  assert.equal(publicAbout("Email us at hello@example.com for events."), null);
  assert.equal(publicAbout("## About\n**Family-run** guesthouse by the beach!"), "About Family-run guesthouse by the beach!");
  assert.equal(publicAbout(""), null);
  assert.ok(publicAbout("word ".repeat(80))!.length <= 160);
});

test("initials stand in for a missing logo", () => {
  assert.equal(initials("Palm Cove Stays"), "PC");
  assert.equal(initials("Amani"), "AM");
  assert.equal(initials("  d'Lish & Co. "), "DL");
  assert.equal(initials("!!!"), "?");
});

test("the brand settings are checked: welcome line, the chat's picture, and whether the page is open", () => {
  assert.deepEqual(validateSettingsPatch({ brandTagline: "  Hair and   beauty in Nyali ", chatAvatar: "logo", frontDoor: false }), {
    ok: true, patch: { brandTagline: "Hair and beauty in Nyali", chatAvatar: "logo", frontDoor: false },
  });
  assert.deepEqual(validateSettingsPatch({ brandTagline: "" }), { ok: true, patch: { brandTagline: null } });
  assert.equal(validateSettingsPatch({ brandTagline: "x".repeat(121) }).ok, false);
  assert.equal(validateSettingsPatch({ chatAvatar: "mascot" }).ok, false);
  assert.equal(validateSettingsPatch({ frontDoor: "yes" }).ok, false);
});

test("scans are told from links, and link previews and crawlers aren't counted as people", () => {
  assert.equal(doorSource("qr"), "qr");
  assert.equal(doorSource("anything"), "link");
  assert.equal(doorSource(undefined), "link");
  assert.equal(looksLikePerson("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"), true);
  for (const agent of ["WhatsApp/2.23", "facebookexternalhit/1.1", "Googlebot/2.1", "curl/8.5", "Mozilla/5.0 HeadlessChrome/120", "", undefined]) assert.equal(looksLikePerson(agent), false, String(agent));
});

test("every business's chat opens on the service's own address (its page), and still nowhere else it didn't allow", () => {
  const business = { id: "palm-cove", allowedOrigins: ["https://palmcove.example.com"] } as any;
  setFrontDoorOrigins([null]);
  assert.equal(isOriginAllowed("https://bilamatata.co.ke", allowedOriginsFor(business)), false);
  setFrontDoorOrigins(["https://bilamatata.co.ke"]);
  assert.equal(isOriginAllowed("https://bilamatata.co.ke", allowedOriginsFor(business)), true);
  assert.equal(isOriginAllowed("https://palmcove.example.com", allowedOriginsFor(business)), true);
  assert.equal(isOriginAllowed("https://evil.example", allowedOriginsFor(business)), false);
  setFrontDoorOrigins([null]);
});

test("Zaina is told she is the receptionist, never the cashier", () => {
  assert.match(CONCIERGE_GUIDANCE, /You are the receptionist, never the cashier\. You never collect, receive or hold money\./);
  assert.match(CONCIERGE_GUIDANCE, /the customer pays the business directly, through the business's own payment link/);
  assert.match(CONCIERGE_GUIDANCE, /Never ask for a card number, a PIN or a one-time code/);
  assert.match(CONCIERGE_GUIDANCE, /never say a payment has arrived unless a tool result says so/);
});

test("the premium code keeps the business's colour when it scans, and darkens it when it wouldn't", async () => {
  const { contrastOnWhite, scannableInk } = await import("../../src/frontdoor/qr.ts");
  assert.equal(scannableInk("#0f766e"), "#0f766e");
  assert.equal(scannableInk("#7C3AED"), "#7c3aed");
  for (const light of ["#fde68a", "#f59e0b", "#38bdf8", "#ffffff"]) {
    const ink = scannableInk(light);
    assert.notEqual(ink, light);
    assert.ok(contrastOnWhite(ink) >= 4.5, `${light} → ${ink}`);
  }
  assert.equal(scannableInk(null), "#111827");
  assert.equal(scannableInk("red"), "#111827");

  const withLogo = qrSvg("https://bilamatata.co.ke/q/palm-cove", { style: "premium", color: "#7c3aed", logo: "data:image/png;base64,iVBORw0KGgo=" });
  assert.match(withLogo, /<image href="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(withLogo, /fill="#7c3aed"/);
  assert.doesNotMatch(withLogo, /<script|on[a-z]+=|href="(?!data:image)/i);
  // Only a picture can go in the middle: anything else is left out, and the initials take its place.
  const sly = qrSvg("x", { style: "premium", logo: "javascript:alert(1)", initials: "P<C" });
  assert.doesNotMatch(sly, /<image|javascript/);
  assert.match(sly, />PC<\/text>/);
  // With something in the middle the code carries the most error correction, so it is larger than the plain one.
  const size = (svg: string) => Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
  assert.ok(size(qrSvg("https://bilamatata.co.ke/q/palm-cove", { style: "premium", initials: "PC" })) > size(qrSvg("https://bilamatata.co.ke/q/palm-cove", { style: "premium" })));
});

test("a scan goes where the business's Zaina really works, and to its page when that isn't ready", async () => {
  const { doorQrTarget, scanDestination, websiteWithChat } = await import("../../src/frontdoor/routes.ts");
  // On a real domain each business has its own address (src/frontdoor/subdomains.ts): the name shows first.
  assert.equal(doorQrTarget("https://bilamatata.co.ke", "palm-cove"), "https://palm-cove.bilamatata.co.ke/q");
  assert.equal(doorQrTarget("https://bilamatata.co.ke", "palm-cove", "card"), "https://palm-cove.bilamatata.co.ke/k");
  const base = { base: "https://bilamatata.co.ke", businessId: "palm-cove", name: "Palm Cove", websiteUrl: "https://www.palmcove.example/rooms", allowedOrigins: ["https://www.palmcove.example"], whatsapp: "https://wa.me/254700000321", on: "qr" as const };
  assert.deepEqual(scanDestination({ ...base, choice: "page" }), { kind: "page", url: "https://palm-cove.bilamatata.co.ke/?s=qr" });
  assert.deepEqual(scanDestination({ ...base, choice: "website" }), { kind: "website", url: "https://www.palmcove.example/rooms#zaina" });
  assert.deepEqual(scanDestination({ ...base, choice: "whatsapp" }), { kind: "whatsapp", url: "https://wa.me/254700000321?text=Hi%20Palm%20Cove!" });
  // Not ready: the chat isn't allowed on the website, or WhatsApp isn't connected to Zaina. The page always works.
  assert.equal(scanDestination({ ...base, choice: "website", allowedOrigins: [] }).kind, "page");
  assert.equal(scanDestination({ ...base, choice: "website", websiteUrl: null }).kind, "page");
  assert.equal(scanDestination({ ...base, choice: "whatsapp", whatsapp: null }).kind, "page");
  assert.equal(scanDestination({ ...base, choice: "whatsapp", whatsapp: "https://evil.example/254700000321" }).kind, "page");
  assert.equal(scanDestination({ ...base, choice: "page", on: "card" }).url, "https://palm-cove.bilamatata.co.ke/?s=card");
  assert.equal(websiteWithChat("http://www.palmcove.example", ["http://www.palmcove.example"]), null, "only https");
  assert.equal(websiteWithChat("not a url", ["https://x.example"]), null);
  assert.equal(websiteWithChat("https://www.palmcove.example/#book", ["https://www.palmcove.example"]), "https://www.palmcove.example/#zaina");
});

test("what a business card says is checked: short single lines, a real email, one of the designs", async () => {
  const { checkCardDetails } = await import("../../src/businesses/settings.ts");
  assert.deepEqual(checkCardDetails({ design: "bold", personName: "  Amani   Wanjiku ", personTitle: "Founder", phone: "+254 700 000 123", email: "hello@amani.example.com", website: "", address: null }), {
    ok: true, value: { design: "bold", personName: "Amani Wanjiku", personTitle: "Founder", phone: "+254 700 000 123", email: "hello@amani.example.com", website: null, address: null },
  });
  assert.deepEqual(checkCardDetails({}), { ok: true, value: { design: "signature", personName: null, personTitle: null, phone: null, email: null, website: null, address: null } });
  assert.deepEqual(checkCardDetails(null), { ok: true, value: null });
  assert.equal(checkCardDetails({ design: "neon" }).ok, false);
  assert.equal(checkCardDetails({ email: "not an email" }).ok, false);
  assert.equal(checkCardDetails({ personName: "x".repeat(61) }).ok, false);
  assert.equal(checkCardDetails({ phone: 700000123 }).ok, false);
  assert.equal(checkCardDetails([]).ok, false);
  assert.equal(checkCardDetails("card").ok, false);
  assert.deepEqual(validateSettingsPatch({ qrDestination: "whatsapp" }), { ok: true, patch: { qrDestination: "whatsapp" } });
  assert.equal(validateSettingsPatch({ qrDestination: "instagram" }).ok, false);
});

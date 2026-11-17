// Reading a business's website without a network: which addresses may be
// read, the lookup that refuses private networks when connecting, the links
// followed, robots.txt, titles and the kind of each page.

import assert from "node:assert/strict";
import test from "node:test";
import { allowedBy, disallowedPaths, kindOfPage, linksOn, pageKey, pageTitles } from "../../src/knowledge/website.ts";
import { privateAddress, PublicFetchError, publicLookup, publicUrl } from "../../src/net/public-fetch.ts";
import { pageDataText, shopifyProductsPage, sitemapEntries, sitemapsIn, structuredDataText, wooProductsPage, wordpressPages } from "../../src/knowledge/website-data.ts";

test("only public https addresses on the standard port", () => {
  assert.equal(publicUrl("coralcove.co.ke").toString(), "https://coralcove.co.ke/");
  assert.equal(publicUrl("http://www.coralcove.co.ke/rooms#top").toString(), "https://www.coralcove.co.ke/rooms");
  for (const bad of ["ftp://coralcove.co.ke", "https://user:secret@coralcove.co.ke", "https://coralcove.co.ke:8443/", "https://localhost/", "https://printer.local/",
    "https://db.railway.internal/", "https://intranet/", "https://10.0.0.5/", "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://[fd12::1]/", "not a url at all"]) {
    assert.throws(() => publicUrl(bad), PublicFetchError, bad);
  }
  for (const address of ["10.1.2.3", "172.16.0.1", "192.168.1.1", "100.64.0.1", "169.254.169.254", "::ffff:127.0.0.1", "fd12:3456::1", "64:ff9b::a00:1"]) {
    assert.equal(privateAddress(address), true, address);
  }
  assert.equal(privateAddress("41.90.64.10"), false);
});

test("the connection's own lookup refuses a name with any private address", async () => {
  const lookupWith = (addresses: Array<{ address: string; family: number }>) => publicLookup(async () => addresses);
  const run = (lookup: ReturnType<typeof publicLookup>, options: { all?: boolean; family?: number }) => new Promise<{ error: Error | null; result: unknown }>((resolve) => {
    (lookup as any)("coralcove.co.ke", options, (error: Error | null, address: unknown, family?: number) => resolve({ error, result: options.all ? address : [address, family] }));
  });
  const ok = await run(lookupWith([{ address: "41.90.64.10", family: 4 }, { address: "2c0f:fe38::1", family: 6 }]), { all: true });
  assert.equal(ok.error, null);
  assert.equal((ok.result as unknown[]).length, 2);
  assert.deepEqual((await run(lookupWith([{ address: "41.90.64.10", family: 4 }]), {})).result, ["41.90.64.10", 4]);
  assert.deepEqual((await run(lookupWith([{ address: "41.90.64.10", family: 4 }, { address: "2c0f:fe38::1", family: 6 }]), { family: 6 })).result, ["2c0f:fe38::1", 6]);
  // One private answer among public ones is enough to refuse: a rebinding name can't slip through.
  const mixed = await run(lookupWith([{ address: "41.90.64.10", family: 4 }, { address: "10.0.0.5", family: 4 }]), { all: true });
  assert.ok(mixed.error instanceof PublicFetchError);
  assert.ok((await run(lookupWith([]), { all: true })).error instanceof PublicFetchError);
  assert.ok((await run(publicLookup(async () => { throw new Error("ENOTFOUND"); }), { all: true })).error instanceof PublicFetchError);
});

test("links followed: the same site only, pages only, each once", () => {
  const page = new URL("https://www.coralcove.example/");
  const html = `
    <a href="/rooms">Rooms</a> <a href='menu'>Menu</a> <a href=faq>FAQ</a>
    <a href="https://coralcove.example/about">About</a>
    <a href="http://www.coralcove.example/contact">Contact</a>
    <a href="/brochure.pdf">Brochure</a> <a href="/photos/pool.JPG">Pool</a>
    <a href="mailto:stay@coralcove.example">Email</a> <a href="tel:+254700000000">Call</a> <a href="javascript:void(0)">x</a>
    <a href="https://www.booking.com/hotel/ke/coral-cove">Booking.com</a>
    <a href="/wp-admin/">Admin</a> <a href="/cart">Cart</a> <a href="#rooms">Rooms</a>
    <a href="/rooms?utm_source=newsletter&amp;utm_medium=email#top">Rooms again</a>`;
  const links = linksOn(html, page).map((url) => url.toString());
  assert.deepEqual(links, [
    "https://www.coralcove.example/rooms",
    "https://www.coralcove.example/menu",
    "https://www.coralcove.example/faq",
    "https://coralcove.example/about",
    "https://www.coralcove.example/contact",
    "https://www.coralcove.example/rooms?utm_source=newsletter&utm_medium=email",
  ]);
  assert.equal(pageKey(new URL(links[0])), pageKey(new URL(links[5])), "tracking parameters don't make a new page");
  assert.equal(pageKey(new URL("https://coralcove.example/about/")), pageKey(new URL("https://www.coralcove.example/about")));
});

test("robots.txt: the rules for every robot, or ours when it names us", () => {
  const rules = disallowedPaths("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nDisallow: /*.php$\nAllow: /public\n# comment\n");
  assert.deepEqual(rules, ["/private", "/*.php$"]);
  assert.equal(allowedBy(rules, new URL("https://coralcove.example/rooms")), true);
  assert.equal(allowedBy(rules, new URL("https://coralcove.example/private/staff")), false);
  assert.equal(allowedBy(rules, new URL("https://coralcove.example/index.php")), false);
  assert.equal(allowedBy(rules, new URL("https://coralcove.example/index.php?x=1")), true, "$ ends the path");
  assert.deepEqual(disallowedPaths("User-agent: *\nDisallow: /a\n\nUser-agent: ZainaBot\nDisallow: /b\n"), ["/b"]);
  assert.deepEqual(disallowedPaths("User-agent: *\nDisallow:\n"), [], "an empty Disallow allows everything");
});

test("titles stay apart, and each page gets its kind", () => {
  const page = (url: string, title: string) => ({ url, title, text: "…", description: null });
  assert.deepEqual(pageTitles([
    page("https://coralcove.example/", "Coral Cove"),
    page("https://coralcove.example/contact", "Coral Cove"),
    page("https://coralcove.example/rooms", "Rooms | Coral Cove"),
  ]), ["Coral Cove (home)", "Coral Cove (/contact)", "Rooms | Coral Cove"]);
  assert.equal(kindOfPage(page("https://coralcove.example/food-and-drinks", "Eat with us")), "menu");
  assert.equal(kindOfPage(page("https://coralcove.example/menu", "Our kitchen")), "menu");
  assert.equal(kindOfPage(page("https://coralcove.example/help", "Frequently asked questions")), "faq");
  assert.equal(kindOfPage(page("https://coralcove.example/house-rules", "Before you arrive")), "policy");
  assert.equal(kindOfPage(page("https://coralcove.example/cancellation-policy", "Cancellations")), "policy");
  assert.equal(kindOfPage(page("https://coralcove.example/rooms", "Rooms")), "page");
});

// ── Websites built by JavaScript (website-data.ts) ──

test("a page built by script is read from its structured data, description and <noscript> text, never prices", () => {
  const ld = { "@type": "Store", name: "Jiko", description: "Wholesale groceries in Nairobi.", priceRange: "KSh 100 - 9,000", offers: { price: "4500" }, address: { streetAddress: "Kirinyaga Road", addressLocality: "Nairobi" } };
  const faq = { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Do you deliver?", acceptedAnswer: { text: "Yes, within Nairobi." } }] };
  const html = `<html><head><title>Jiko</title><meta name="description" content="Wholesale groceries."><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [ld] })}</script><script type="application/ld+json">${JSON.stringify(faq)}</script></head><body><div id="root"></div></body></html>`;
  const text = pageDataText(html);
  assert.match(text, /^# Jiko/);
  assert.match(text, /## Jiko\n\nWholesale groceries in Nairobi\./);
  assert.match(text, /### Do you deliver\?\n\nYes, within Nairobi\./);
  assert.match(text, /Kirinyaga Road/);
  assert.doesNotMatch(text, /9,000|4500/);
  assert.equal(structuredDataText('<script type="application/ld+json">{ not json</script>'), "");

  const noscript = '<html><head><title>About</title></head><body><noscript>Please enable JavaScript to use this site.</noscript><noscript><p>Run by the Kamau family since 2004, supplying shops across Nairobi.</p></noscript></body></html>';
  assert.match(pageDataText(noscript), /Kamau family since 2004/);
  assert.doesNotMatch(pageDataText(noscript), /enable JavaScript/);
  assert.equal(pageDataText('<html><head><title>App</title><meta name="description" content="Shop."></head><body><div id="app"></div></body></html>'), "", "a title and one line aren't a page");
});

test("sitemaps: pages, an index's sitemaps, and the ones robots.txt names", () => {
  assert.deepEqual(sitemapEntries("<urlset><url><loc> https://a.example/rooms?x=1&amp;y=2 </loc></url></urlset>"), { pages: ["https://a.example/rooms?x=1&y=2"], sitemaps: [] });
  assert.deepEqual(sitemapEntries("<sitemapindex><sitemap><loc>https://a.example/pages.xml</loc></sitemap></sitemapindex>"), { pages: [], sitemaps: ["https://a.example/pages.xml"] });
  assert.deepEqual(sitemapsIn("User-agent: *\nDisallow: /cart\nSitemap: https://a.example/sitemap_index.xml\n"), ["https://a.example/sitemap_index.xml"]);
});

test("WordPress pages, WooCommerce and Shopify products, without prices", () => {
  const pages = wordpressPages([{ link: "https://a.example/returns", title: { rendered: "Returns &amp; refunds" }, content: { rendered: "<p>Damaged cartons are replaced within 48 hours.</p>" } }, { link: "https://a.example/x", title: { rendered: "Short" }, content: { rendered: "<p>Hi</p>" } }]);
  assert.deepEqual(pages.map((page) => [page.url, page.title]), [["https://a.example/returns", "Returns & refunds"]]);
  assert.deepEqual(wordpressPages({ code: "rest_no_route" }), []);

  const woo = wooProductsPage([{ name: "Cooking oil 20L", categories: [{ name: "Oils" }], short_description: "<p>In a jerrican.</p>", prices: { price: "450000" } }], "a.example");
  assert.equal(woo?.url, "https://a.example/shop");
  assert.match(woo!.text, /## Cooking oil 20L \(Oils\)\n\nIn a jerrican\./);
  assert.doesNotMatch(woo!.text, /450000/);
  assert.equal(wooProductsPage([], "a.example"), null);

  const shopify = shopifyProductsPage({ products: [{ title: "Kikoi", product_type: "Textiles", body_html: "<p>Handwoven in Lamu.</p>", variants: [{ price: "2500.00" }] }] }, "a.example");
  assert.equal(shopify?.url, "https://a.example/collections/all");
  assert.match(shopify!.text, /## Kikoi \(Textiles\)\n\nHandwoven in Lamu\./);
  assert.doesNotMatch(shopify!.text, /2500/);
});

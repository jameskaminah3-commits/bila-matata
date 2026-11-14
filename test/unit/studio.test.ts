// The studio's site and invoices without a database: invoice references,
// what the studio may type for a new invoice, what a Paystack result means
// for a payable, the reusable checkout's own checks, and the public pages
// (the offer as agreed, and nothing on them that isn't what the studio sells).

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCheckout, outcomeOf } from "../../src/checkout/index.ts";
import { formatMoney, STUDIO, whatsappLink } from "../../src/studio/brand.ts";
import { newInvoiceReference, normalizeInvoiceReference, STUDIO_INVOICE_REFERENCE, validateNewInvoice, type StudioInvoice } from "../../src/studio/invoices.ts";
import { configureStudioPay, invoiceEmail, receiptEmail } from "../../src/studio/pay.ts";
import { renderInvoicePage, renderPayHome } from "../../src/studio/pay-pages.ts";
import { renderHome, renderTerms } from "../../src/studio/pages.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = { baseUrl: "https://bilamatata.co.ke" };
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

const invoice = (fields: Partial<StudioInvoice> = {}): StudioInvoice => ({
  id: "00000000-0000-4000-8000-000000000001",
  reference: "BM-7K2Q9XHD",
  clientName: "Acme Traders",
  clientEmail: "accounts@example.com",
  description: "50% deposit: company website, 6 pages",
  category: "software",
  amountMinor: 4_500_000,
  currency: "KES",
  status: "open",
  dueAt: null,
  paidAt: null,
  method: null,
  receipt: null,
  notes: null,
  createdAt: new Date("2026-11-13T08:00:00Z"),
  voidedAt: null,
  ...fields,
});

test("an invoice reference can't be guessed, is easy to read out, and is found however it's typed", () => {
  const made = new Set(Array.from({ length: 200 }, newInvoiceReference));
  assert.equal(made.size, 200);
  for (const reference of made) {
    assert.match(reference, STUDIO_INVOICE_REFERENCE);
    assert.doesNotMatch(reference.slice(3), /[IO01]/, "no letters or digits that are mistaken for each other");
  }
  assert.equal(normalizeInvoiceReference("bm-7k2q9xhd"), "BM-7K2Q9XHD");
  assert.equal(normalizeInvoiceReference(" BM 7K2Q 9XHD "), "BM-7K2Q9XHD");
  assert.equal(normalizeInvoiceReference("7k2q9xhd"), "BM-7K2Q9XHD");
  assert.equal(normalizeInvoiceReference("BM-7K2Q9XH"), null, "too short");
  assert.equal(normalizeInvoiceReference("BM-7K2Q9XH0"), null, "0 is never in a reference");
  assert.equal(normalizeInvoiceReference("'; drop table"), null);
  assert.equal(normalizeInvoiceReference(undefined), null);
});

test("a new invoice needs a client, a plain description, a category the studio sells and an amount", () => {
  const good = validateNewInvoice({ client_name: "  Acme   Traders ", client_email: "Accounts@Example.com", description: "50% deposit: company website", category: "software", amount: 45000.5, due_on: "2026-12-01" });
  assert.ok(good.ok);
  assert.deepEqual(
    { ...good.value, dueAt: good.value.dueAt?.toISOString() },
    { clientName: "Acme Traders", clientEmail: "accounts@example.com", description: "50% deposit: company website", category: "software", amountMinor: 4_500_050, currency: "KES", dueAt: "2026-12-01T20:59:59.000Z", notes: null },
  );
  const bad = (body: object) => {
    const checked = validateNewInvoice({ client_name: "Acme", description: "Website deposit", category: "software", amount: 100, ...body });
    assert.equal(checked.ok, false, JSON.stringify(body));
  };
  bad({ client_name: "" });
  bad({ client_email: "not-an-email" });
  bad({ description: "x" });
  bad({ category: "accommodation" });
  bad({ category: undefined });
  bad({ amount: 0 });
  bad({ amount: -5 });
  bad({ amount: "lots" });
  bad({ currency: "EUR" });
  bad({ due_on: "next week" });
  assert.ok(validateNewInvoice({ client_name: "Acme", description: "Set-up", category: "zaina_setup", amount: "10000", currency: "USD" }).ok);
});

test("a payable is paid only by a success for exactly the amount and currency asked", () => {
  const asked = { amountMinor: 1_000_000, currency: "KES" };
  assert.deepEqual(outcomeOf({ status: "success", amountMinor: 1_000_000, currency: "KES" }, asked), { outcome: "paid", mismatch: false });
  assert.deepEqual(outcomeOf({ status: "success", amountMinor: 100, currency: "KES" }, asked), { outcome: "failed", mismatch: true });
  assert.deepEqual(outcomeOf({ status: "success", amountMinor: 1_000_000, currency: "USD" }, asked), { outcome: "failed", mismatch: true });
  assert.deepEqual(outcomeOf({ status: "failed", amountMinor: 0, currency: "" }, asked), { outcome: "failed", mismatch: false });
  assert.deepEqual(outcomeOf({ status: "reversed", amountMinor: 1_000_000, currency: "KES" }, asked), { outcome: "failed", mismatch: false });
  for (const status of ["abandoned", "pending", "ongoing", "queued"]) {
    assert.equal(outcomeOf({ status, amountMinor: 0, currency: "KES" }, asked).outcome, "pending", status);
  }
});

test("the checkout takes its own Paystack key, and reads only webhooks that key signed", async () => {
  assert.throws(() => createCheckout({ secretKey: "pk_test_abcdefghij", returnUrl: "https://example.com/pay/verify" }), /secret key/);
  assert.throws(() => createCheckout({ secretKey: "sk_test_abcdefghij", returnUrl: "/pay/verify" }), /return address/);
  const test1 = createCheckout({ secretKey: "sk_test_abcdefghij0001", returnUrl: "https://example.com/pay/verify" });
  const live = createCheckout({ secretKey: "sk_live_abcdefghij0002", returnUrl: "https://example.com/pay/verify" });
  assert.equal(test1.testMode, true);
  assert.equal(live.testMode, false);

  const { createHmac } = await import("node:crypto");
  const body = Buffer.from(JSON.stringify({ event: "charge.success", data: { id: 9001, status: "success", reference: "bm_0123456789abcdef01234567", amount: 1_000_000, currency: "KES", channel: "mobile_money" } }));
  const sign = (key: string) => createHmac("sha512", key).update(body).digest("hex");
  const read = test1.readWebhook(body, sign("sk_test_abcdefghij0001"));
  assert.equal(read.valid, true);
  assert.deepEqual(
    { reference: read.charge?.reference, amountMinor: read.charge?.amountMinor, currency: read.charge?.currency, status: read.charge?.status, transactionId: read.charge?.transactionId },
    { reference: "bm_0123456789abcdef01234567", amountMinor: 1_000_000, currency: "KES", status: "success", transactionId: "9001" },
  );
  // Another account's signature (another project's key) is not this checkout's.
  assert.deepEqual(test1.readWebhook(body, sign("sk_live_abcdefghij0002")), { valid: false, charge: null });
  assert.deepEqual(test1.readWebhook(body, undefined), { valid: false, charge: null });
  const other = Buffer.from(JSON.stringify({ event: "transfer.success", data: {} }));
  assert.deepEqual(test1.readWebhook(other, createHmac("sha512", "sk_test_abcdefghij0001").update(other).digest("hex")), { valid: true, charge: null });
});

test("money and links read the way the studio writes them", () => {
  assert.equal(formatMoney(670_000, "KES"), "KES 6,700");
  assert.equal(formatMoney(1_100_000, "KES"), "KES 11,000");
  assert.equal(formatMoney(1_250, "USD"), "USD 12.50");
  assert.equal(whatsappLink("Hello there"), "https://wa.me/254707255598?text=Hello%20there");
});

test("the home page carries the agreed offer: headline, navigation, both plans, the comparison and four services", () => {
  const html = renderHome(PAGE);
  const words = text(html);
  assert.match(html, /<h1>Run Your Business <em>Without the Hassle\.<\/em><\/h1>/);
  assert.match(words, /24\/7 AI sales & booking concierges, custom web & mobile apps, AI automation, and data-backed research that help businesses capture more leads and scale effortlessly\./);
  const nav = /<nav class="nav"[\s\S]*?<\/nav>/.exec(html)![0];
  assert.deepEqual([...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((match) => match[1]), ["Zaina AI", "Services", "Pricing", "Client Login", "Pay Invoice", "Contact"]);
  assert.match(nav, /href="\/app\/"/);
  assert.match(nav, /href="\/pay"/);
  assert.match(words, /Try Zaina AI Live/);
  assert.match(html, /href="https:\/\/wa\.me\/254707255598\?text=[^"]+"[^>]*>[\s\S]*?Start a Project on WhatsApp/);

  assert.match(words, /Starter Sales Concierge KES 6,700 \/ month \+ KES 10,000 one-off set-up/);
  assert.match(words, /Full Booking & Quote Engine KES 11,000 \/ month \+ KES 20,000 one-off set-up/);
  assert.match(words, /Not just another chatbot: Zaina actually closes bookings/);
  for (const service of ["Website & Mobile App Development", "AI Automation & Workflow Systems", "Data Analysis & Business Intelligence", "Strategic Research & Professional Writing"]) {
    assert.ok(words.includes(service), service);
  }
  const services = html.match(/<article class="card service">[\s\S]*?<\/article>/g) ?? [];
  assert.equal(services.length, 4, "four service cards");
  // Each says what it starts from and has a way to book it.
  assert.deepEqual(services.map((card) => /<p class="from"><span>From<\/span> ([^<]+)<\/p>/.exec(card)?.[1]), ["KES 25,000", "KES 15,000", "KES 10,000", "KES 5,000"]);
  assert.deepEqual(services.map((card) => /href="(\/start\?service=[a-z]+)">Book a free consultation/.exec(card)?.[1]), ["/start?service=software", "/start?service=automation", "/start?service=data", "/start?service=research"]);
  assert.match(html, /href="\/start\?service=zaina_starter">Get Starter for my business/);
  assert.match(html, /href="\/start\?service=zaina_full">Get Full for my business/);
  assert.match(words, /Serving businesses across Kenya and globally · WhatsApp\/Call: \+254 707 255 598 · Email: hello@bilamatata\.co\.ke/);
  assert.match(html, /<a href="\/terms">/);

  // The studio's own Zaina, embedded the way a client embeds theirs, and nothing inline that a strict policy would block.
  assert.match(html, new RegExp(`<script src="/zaina\\.js" data-business="${STUDIO.businessId}" async></script>`));
  assert.doesNotMatch(html, / style="/);
  assert.doesNotMatch(html, / on[a-z]+="/);
  assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].filter((match) => !match[1].includes("application/ld+json")).length, 0, "no inline scripts");
  assert.match(html, /<link rel="canonical" href="https:\/\/bilamatata\.co\.ke\/">/);
  const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
  assert.deepEqual(data.makesOffer.map((offer: { price: number }) => offer.price), [6700, 11000]);
});

test("the home page says how Zaina works: only the business's own information, no invented prices, the up-to-date calendar, finding and booking", () => {
  const words = text(renderHome(PAGE));
  assert.match(words, /using only what your business gives her: your catalogue, your price list and your up-to-date calendar/);
  assert.match(words, /Zaina doesn't guess\. Everything she says comes directly from your business/);
  assert.match(words, /She never makes up a price, and if an answer isn't in your information she says so and brings in your team\./);
  assert.match(words, /She helps each customer find what suits them, checks your up-to-date calendar, quotes the exact price, creates the booking and sends your own M-Pesa or card payment link, so the deposit is paid straight to you/);
  assert.match(words, /Never invents a price: every quote comes straight from your price list/);
  assert.match(words, /Checks your up-to-date calendar before she offers a time/);
  assert.match(words, /Answers you can trust Guess, or answer from general knowledge that isn't about your business Answers only from your own information\. If something isn't there, she says so and brings in your team/);
  // Zaina is a receptionist, not a cashier: she sends the business's own payment link and never holds its money.
  assert.match(words, /Customers pay you directly/);
  assert.match(words, /Zaina never (collects or )?holds/);
  assert.doesNotMatch(words, /takes (the|a|your) (deposit|payment)|collects (the|a|your) (deposit|payment)/i);
});

test("the home page shows a smart assistant, and compares her with auto-replies and basic bots on what she really does", () => {
  const html = renderHome(PAGE);
  const words = text(html);
  assert.match(words, /Smart enough to sell, not just reply/);
  assert.match(words, /works out what each customer is really after, asks the one question that matters, recommends the option that suits them from what you actually sell, and always offers the next step/);
  assert.match(words, /Understands what each customer needs and recommends what suits them/);
  const outcomes = /<section class="band alt" id="zaina"[\s\S]*?<\/section>/.exec(html)![0];
  assert.equal((outcomes.match(/<article class="card"><div class="icon">/g) ?? []).length, 6, "six outcomes");

  // The comparison: what customers need, then the basic bots, then Zaina last.
  const table = /<table class="compare">[\s\S]*?<\/table>/.exec(html)![0];
  assert.deepEqual([...table.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((match) => match[1]), ["What your customers need", "Basic auto-responders &amp; generic bots", "Zaina AI, built for revenue"]);
  assert.deepEqual([...table.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map((match) => match[1]), ["Live availability", "Accurate price quotes", "Answers you can trust", "Recommendations and extras", "Booking and checkout", "Hand-off to your team"]);
  assert.equal((table.match(/<td class="them">[^<]*<\/td><td class="us">/g) ?? []).length, 6);
  assert.match(words, /Auto-responders and generic chatbots leave customers waiting for someone to check availability and work out the price\./);
  assert.match(words, /Live availability, exact booking totals, booking and checkout come with the Full Booking & Quote Engine\./);

  // No other company is named on the page (that answer is kept for one-to-one questions).
  assert.doesNotMatch(words, /Meta AI|ChatGPT|Gemini|Copilot|OpenAI/);
  // Only what Zaina really does: no stock tracking, bundles, currency conversion, timed promises, or hand-off "to WhatsApp".
  assert.doesNotMatch(words, /inventory|\bstock levels?\b|bundles?|KSh (&|and) USD|\b\d+ seconds\b|to your WhatsApp/i);
  assert.doesNotMatch(words, /smarter than|beats|outperforms|#1|number one|the best AI|increase every/i);
});

test("nothing a client or their customer reads names the payment provider", () => {
  const provider = /paystack/i;
  const pages = {
    home: renderHome(PAGE),
    terms: renderTerms(PAGE),
    pay: renderPayHome(PAGE, { message: "provider", reference: "", testMode: true, available: false }),
    open: renderInvoicePage(PAGE, { invoice: invoice(), message: "pending", email: "", testMode: true, available: true, waiting: true }),
    failed: renderInvoicePage(PAGE, { invoice: invoice(), message: "failed", email: "", testMode: false, available: true, waiting: false }),
    paid: renderInvoicePage(PAGE, { invoice: invoice({ status: "paid", paidAt: new Date(), method: "paystack", receipt: "5000001" }), message: "paid", email: "", testMode: false, available: true, waiting: false }),
  };
  for (const [name, html] of Object.entries(pages)) assert.doesNotMatch(text(html), provider, name);
  assert.match(text(pages.open), /You pay on a secure payment page by M-Pesa or card\./);
  configureStudioPay({ paystackKey: "sk_test_abcdefghij0001", publicBaseUrl: "https://bilamatata.co.ke", notifyEmail: null });
  const sent = invoiceEmail(invoice())!;
  const receipt = receiptEmail(invoice({ status: "paid", paidAt: new Date(), method: "paystack", receipt: "5000001" }));
  for (const email of [sent, receipt]) assert.doesNotMatch(`${email.subject}\n${email.text}`, provider);
  configureStudioPay({ paystackKey: null, publicBaseUrl: null, notifyEmail: null });
  const knowledge = path.join(REPO, "knowledge", STUDIO.businessId);
  for (const file of readdirSync(knowledge)) assert.doesNotMatch(readFileSync(path.join(knowledge, file), "utf8"), provider, file);
});

test("the home page promises nothing it can't show: no invented numbers, reviews or guarantees", () => {
  const words = text(renderHome(PAGE)).toLowerCase();
  for (const claim of ["guarantee", "testimonial", "trusted by", "rated", "% more", "x more", "15+ hours", "award"]) {
    // Whole words: "frustrated" isn't "rated".
    assert.doesNotMatch(words, new RegExp(`(^|[^a-z])${claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`), claim);
  }
  assert.match(words, /a demonstration with example businesses: the names, prices and times are examples\./);
  // The one place that talks about payback is a calculator on the visitor's own numbers, and it says so.
  assert.match(words, /this is arithmetic on the numbers you chose, not a promise of results/);
});

test("the terms cover projects (50% to start, balance on delivery), Zaina's monthly plans, refunds and Kenya's data law", () => {
  const words = text(renderTerms(PAGE));
  assert.match(words, /We start work once a deposit of 50% of the quoted price is paid\./);
  assert.match(words, /The remaining 50% is due on delivery/);
  assert.match(words, /The monthly fee is billed in advance for each month\./);
  assert.match(words, /You can cancel at any time/);
  assert.match(words, /Kenya's Data Protection Act, 2019/);
  assert.match(words, /Office of the Data Protection Commissioner/);
  assert.match(words, /You pay on a licensed payment provider's secure page; we never see or store your card number or M-Pesa PIN\./);
  assert.match(words, /the money is paid into your own payment account/);
  assert.match(words, /Refunds/);
});

test("public pages, the price list and the studio's knowledge describe a software studio, and nothing else", () => {
  // Hotels, lodges and stays are customers Zaina serves, so the home page and the studio's knowledge may say so.
  // The studio's own invoices, terms and price list stay software-only; tours, safaris, car hire and travel agencies are never named.
  const banned = /\b(tours?|safaris?|hotels?|villas?|car hire|holidays?|travel\w*|touris\w+|trips?|vacations?|airbnb|guesthouses?|resorts?)\b/i;
  const neverNamed = /\b(tours?|safaris?|car hire|holidays?|travel\w*|touris\w+|trips?|vacations?|airbnb)\b/i;
  const pages = {
    terms: renderTerms(PAGE),
    pay: renderPayHome(PAGE, { message: "not_found", reference: "", testMode: false, available: true }),
    invoice: renderInvoicePage(PAGE, { invoice: invoice(), message: null, email: "", testMode: false, available: true, waiting: false }),
  };
  for (const [name, html] of Object.entries(pages)) assert.doesNotMatch(html, banned, name);
  assert.doesNotMatch(renderHome(PAGE), neverNamed, "home");
  assert.match(text(renderHome(PAGE)), /for hotels, lodges, villas and stays/i, "the home page speaks to hospitality");
  const knowledge = path.join(REPO, "knowledge", STUDIO.businessId);
  const files = readdirSync(knowledge);
  assert.ok(files.includes("about-bila-matata.md"), "the release step looks for this file");
  const zaina = readFileSync(path.join(knowledge, "zaina-ai.md"), "utf8");
  assert.doesNotMatch(zaina, /Meta AI|ChatGPT|bundles?|inventory/i, "the long-form page about Zaina names no other company and claims nothing she doesn't do");
  for (const file of files) assert.doesNotMatch(readFileSync(path.join(knowledge, file), "utf8"), neverNamed, file);
  const seeded = readFileSync(path.join(REPO, "migrations", "0016_studio_invoices.sql"), "utf8");
  assert.doesNotMatch(seeded.slice(seeded.indexOf("insert into price_items")), banned);
  assert.match(seeded, /'Starter Sales Concierge', [^\n]+, 670000, 'KES', 'a month'/);
  assert.match(seeded, /'Starter Sales Concierge set-up', [^\n]+, 1000000, 'KES', 'once'/);
  assert.match(seeded, /'Full Booking & Quote Engine', [^\n]+, 1100000, 'KES', 'a month'/);
  assert.match(seeded, /'Full Booking & Quote Engine set-up', [^\n]+, 2000000, 'KES', 'once'/);
});

test("an invoice's page says what is owed and for what; a paid or cancelled one offers nothing to pay", () => {
  const open = renderInvoicePage(PAGE, { invoice: invoice({ dueAt: new Date("2026-12-01T20:59:59Z") }), message: null, email: "", testMode: true, available: true, waiting: false });
  const words = text(open);
  assert.match(words, /Invoice BM-7K2Q9XHD/);
  assert.match(words, /KES 45,000/);
  assert.match(words, /Website and app development/);
  assert.match(words, /50% deposit: company website, 6 pages/);
  assert.match(words, /Due 1 December 2026/);
  assert.match(words, /Test mode/);
  assert.match(open, /<form method="post" action="\/pay\/BM-7K2Q9XHD\/start">/);
  assert.match(open, /<meta name="robots" content="noindex">/);
  // The client's email address is never put on the page.
  assert.ok(!open.includes("accounts@example.com"));

  const paid = renderInvoicePage(PAGE, { invoice: invoice({ status: "paid", paidAt: new Date("2026-11-14T09:00:00Z"), method: "paystack", receipt: "5000001" }), message: "paid", email: "", testMode: false, available: true, waiting: false });
  assert.match(text(paid), /Payment received/);
  assert.match(text(paid), /Paid on 14 November 2026/);
  assert.doesNotMatch(paid, /<form method="post"/);
  const cancelled = renderInvoicePage(PAGE, { invoice: invoice({ status: "void", voidedAt: new Date() }), message: null, email: "", testMode: false, available: true, waiting: false });
  assert.match(text(cancelled), /nothing to pay/);
  assert.doesNotMatch(cancelled, /<form method="post"/);
  // No Paystack key: the invoice still shows, with a way to get help instead of a button.
  const off = renderInvoicePage(PAGE, { invoice: invoice(), message: null, email: "", testMode: false, available: false, waiting: false });
  assert.match(text(off), /Online payment isn't available right now/);
  assert.doesNotMatch(off, /<form method="post"/);
  // What a visitor typed comes back escaped.
  const echoed = renderPayHome(PAGE, { message: "not_found", reference: '"><script>alert(1)</script>', testMode: false, available: true });
  assert.ok(!echoed.includes("<script>alert(1)"));
});

test("the invoice and receipt emails say what was bought, in the studio's own name", () => {
  configureStudioPay({ paystackKey: "sk_test_abcdefghij0001", publicBaseUrl: "https://bilamatata.co.ke", notifyEmail: null });
  const sent = invoiceEmail(invoice({ dueAt: new Date("2026-12-01T20:59:59Z") }))!;
  assert.equal(sent.subject, "Invoice BM-7K2Q9XHD from Bila Matata (KES 45,000)");
  assert.match(sent.text, /Service: Website and app development/);
  assert.match(sent.text, /Details: 50% deposit: company website, 6 pages/);
  assert.match(sent.text, /Pay securely by M-Pesa or card: https:\/\/bilamatata\.co\.ke\/pay\/BM-7K2Q9XHD/);
  const receipt = receiptEmail(invoice({ status: "paid", paidAt: new Date("2026-11-14T09:00:00Z"), method: "paystack", receipt: "5000001" }));
  assert.equal(receipt.subject, "Receipt: invoice BM-7K2Q9XHD paid (KES 45,000)");
  assert.match(receipt.text, /Paid on: 14 November 2026/);
  assert.match(receipt.text, /Payment reference: 5000001/);
  configureStudioPay({ paystackKey: null, publicBaseUrl: null, notifyEmail: null });
  assert.equal(invoiceEmail(invoice()), null, "no address, no link to send");
});

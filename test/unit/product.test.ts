// The product's promises, without a database: what each tier is, what the
// Starter tier can't change, what a plan carries, the website's requests and
// starting prices, support's inputs, and the home page's demonstration.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FULL_TIER_SECTIONS } from "../../src/billing/tier-gate.ts";
import { validatePlan } from "../../src/billing/periods.ts";
import { appointmentsConnector } from "../../src/connectors/appointments/index.ts";
import { basicConnector } from "../../src/connectors/basic/index.ts";
import { hospitalityConnector } from "../../src/connectors/hospitality/index.ts";
import { connectorFor } from "../../src/connectors/registry.ts";
import { workingType } from "../../src/db/schema.ts";
import { DEMO_JS, DEMO_SCENES, renderDemo } from "../../src/studio/demo.ts";
import { readRequest } from "../../src/studio/requests.ts";
import { REQUEST_TOPICS, STUDIO_SERVICES } from "../../src/studio/services.ts";
import { renderStart, renderStartThanks } from "../../src/studio/start-pages.ts";
import { validateMessage, validateNewThread } from "../../src/support/store.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PAGE = { baseUrl: "https://bilamatata.co.ke" };
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

test("on Starter a business works as a general one, whatever it sells; on Full as what it is", async () => {
  assert.equal(workingType({ businessType: "salon", tier: "starter" }), "general");
  assert.equal(workingType({ businessType: "restaurant", tier: "starter" }), "general");
  assert.equal(workingType({ businessType: "guesthouse", tier: "starter" }), "general");
  assert.equal(workingType({ businessType: "salon", tier: "full" }), "salon");
  assert.equal(workingType({ businessType: "general", tier: "starter" }), "general");
  assert.equal(workingType({ businessType: "custom", tier: "starter" }), "custom");
  assert.equal(workingType({ businessType: "salon" }), "salon", "a business from before tiers keeps what it had");

  // So Zaina has no booking tools on Starter: she answers, quotes the price list and takes leads.
  assert.equal(await connectorFor({ id: "s1", businessType: "salon", tier: "starter" }), basicConnector);
  assert.equal(await connectorFor({ id: "s2", businessType: "guesthouse", tier: "starter" }), basicConnector);
  assert.equal(await connectorFor({ id: "s3", businessType: "salon", tier: "full" }), appointmentsConnector);
  assert.equal(await connectorFor({ id: "s4", businessType: "guesthouse", tier: "full" }), hospitalityConnector);
  const starterTools = basicConnector.toolDeclarations().map((tool) => tool.name);
  for (const tool of ["check_times", "create_appointment", "create_booking", "check_availability"]) assert.ok(!starterTools.includes(tool), tool);
  assert.ok(starterTools.includes("create_lead"));
});

test("the Starter tier can't change rooms, services, bookings, payments or calendars", () => {
  for (const section of ["bookings", "offerings", "resources", "slots", "schedule", "calendars", "booking-settings", "payments", "quote"]) assert.ok(FULL_TIER_SECTIONS.has(section), section);
  // What every tier has stays open.
  for (const section of ["sessions", "leads", "prices", "knowledge", "settings", "members", "support", "billing", "reports", "operations"]) assert.ok(!FULL_TIER_SECTIONS.has(section), section);
});

test("a plan carries its tier and its one-off set-up fee", () => {
  const plan = validatePlan({ id: "starter", name: "Starter Sales Concierge", price_minor: 670_000, currency: "KES", tier: "starter", setup_fee_minor: 1_000_000 }, true);
  assert.ok(plan.ok);
  assert.equal(plan.value.tier, "starter");
  assert.equal(plan.value.setupFeeMinor, 1_000_000);
  assert.equal(validatePlan({ tier: "premium" }, false).ok, false);
  assert.equal(validatePlan({ setup_fee_minor: -1 }, false).ok, false);
  assert.equal(validatePlan({ setup_fee_minor: 10.5 }, false).ok, false);
  assert.ok(validatePlan({ tier: "full", setup_fee_minor: 0 }, false).ok);
});

test("the website's starting prices are the ones on the studio's price list", () => {
  assert.deepEqual(STUDIO_SERVICES.map((service) => [service.id, service.fromMinor]), [["software", 2_500_000], ["automation", 1_500_000], ["data", 1_000_000], ["research", 500_000]]);
  const seeded = readFileSync(path.join(REPO, "migrations", "0017_tiers_support_services.sql"), "utf8");
  for (const [name, amount] of [["Website and mobile app development", 2500000], ["AI automation and workflow systems", 1500000], ["Data analysis and business intelligence", 1000000], ["Strategic research and professional writing", 500000]] as const) {
    assert.match(seeded, new RegExp(`'Studio services', '${name}', '[^']+', ${amount}, 'KES', 'and up'`), name);
  }
  assert.deepEqual(REQUEST_TOPICS.map((topic) => topic.id), ["zaina_starter", "zaina_full", "software", "automation", "data", "research", "other"]);
});

test("a request needs a name, a way to reach the person, what they want and a few words about it", () => {
  const good = readRequest({ name: "  Amina   Yusuf ", business: "Pwani Traders", phone: "+254 700 000 111", email: "", service: "software", details: "A five-page company website with M-Pesa payments." });
  assert.deepEqual(good.problems, {});
  assert.deepEqual(good.value, { name: "Amina Yusuf", business: "Pwani Traders", phone: "+254 700 000 111", email: "", topic: "software", details: "A five-page company website with M-Pesa payments." });
  assert.deepEqual(readRequest({ name: "Amina", email: "Amina@Example.com", service: "zaina_full", details: "Zaina for my salon please." }).problems, {}, "an email alone is enough");
  const bad = readRequest({ name: "", phone: "", email: "", service: "something", details: "hi" });
  assert.deepEqual(Object.keys(bad.problems).sort(), ["details", "name", "phone", "topic"]);
  assert.ok(readRequest({ name: "A B", phone: "12", service: "data", details: "Sales analysis for 2026." }).problems.phone);
  assert.ok(readRequest({ name: "A B", email: "not-an-email", service: "data", details: "Sales analysis for 2026." }).problems.email);
  // Long input is cut, never refused or passed on whole.
  assert.equal(readRequest({ name: "x".repeat(500), phone: "+254700000111", service: "other", details: "y".repeat(5000) }).value.details.length, 2000);
});

test("the booking page says what the service starts from, keeps what was typed, and marks what's wrong", () => {
  const empty = { name: "", business: "", phone: "", email: "", topic: "software", details: "" };
  const page = renderStart(PAGE, { request: empty, problems: {} });
  const words = text(page);
  assert.match(words, /Book a free consultation/);
  assert.match(words, /Website & Mobile App Development starts from KES 25,000\. Your exact price comes in a free written quote, before you pay anything\./);
  assert.match(page, /<option value="software" selected>/);
  assert.match(page, /<form class="panel" method="post" action="\/start" novalidate>/);
  assert.match(words, /We reply within one working day/);
  assert.match(text(renderStart(PAGE, { request: { ...empty, topic: "zaina_full" }, problems: {} })), /Get Zaina for your business/);

  const typed = { name: "<b>Amina</b>", business: "", phone: "", email: "", topic: "data", details: "x" };
  const wrong = renderStart(PAGE, { request: typed, problems: readRequest({ ...typed, service: "data" }).problems });
  assert.ok(wrong.includes("&lt;b&gt;Amina&lt;/b&gt;") && !wrong.includes("<b>Amina</b>"), "what was typed comes back escaped");
  assert.match(text(wrong), /Give a WhatsApp or phone number, or an email, so we can reach you\./);
  assert.match(wrong, /<meta name="robots" content="noindex">/);
  assert.match(text(renderStartThanks(PAGE, "research")), /You asked about Strategic Research & Professional Writing\./);
  assert.doesNotMatch(renderStartThanks(PAGE, "<script>"), /<script>alert|You asked about/);
});

test("support takes a subject and a message, and nothing oversized", () => {
  const good = validateNewThread({ subject: "  Wrong   price for delivery ", topic: "problem", message: "Zaina said KSh 500.\r\nIt is KSh 1,500." });
  assert.ok(good.ok);
  assert.deepEqual(good.value, { subject: "Wrong price for delivery", topic: "problem", message: "Zaina said KSh 500.\nIt is KSh 1,500." });
  assert.ok(validateNewThread({ subject: "Hello there", message: "A question" }).ok, "the topic is a question unless said");
  assert.equal(validateNewThread({ subject: "Hi", message: "x" }).ok, false);
  assert.equal(validateNewThread({ subject: "Subject", topic: "gossip", message: "x" }).ok, false);
  assert.equal(validateNewThread({ subject: "Subject", message: "" }).ok, false);
  assert.equal(validateNewThread({ subject: "Subject", message: "x".repeat(5001) }).ok, false);
  assert.equal(validateMessage({ message: "  Thanks!  " }), "Thanks!");
  assert.equal(validateMessage({ message: "   " }), null);
  assert.equal(validateMessage({}), null);
});

test("the demonstration shows both sides of four conversations, is all in the page, and says it's a demonstration", () => {
  const html = renderDemo();
  const words = text(html);
  assert.deepEqual(DEMO_SCENES.map((scene) => [scene.id, scene.plan]), [["salon", "Full"], ["restaurant", "Full"], ["shop", "Starter"], ["takeover", "Every"]]);
  for (const scene of DEMO_SCENES) {
    const block = new RegExp(`<div class="demo-scene" id="demo-${scene.id}"[\\s\\S]*?(?=<div class="demo-scene"|<p class="fine demo-fine">)`).exec(html)![0];
    // Every step is in the HTML, in order, so the page is complete without script; both sides are there.
    const marks = [...block.matchAll(/data-at="(\d+)"/g)].map((match) => Number(match[1]));
    assert.deepEqual([...new Set(marks)].sort((a, b) => a - b), Array.from({ length: scene.steps }, (_, index) => index), scene.id);
    assert.match(block, /What your customer sees/);
    assert.match(block, /What you see/);
    assert.match(block, /What Zaina is doing/);
    assert.ok(block.includes('class="bubble them"') && block.includes('class="bubble zaina"'), scene.id);
    assert.ok(block.includes('class="demo-alert"') && block.includes('class="demo-record"'), scene.id);
    // Only the conversation's last status shows without script.
    assert.equal((block.match(/<span class="demo-chip (ok|warn|info)" data-at="\d+" data-wait="\d+">/g) ?? []).length, 1, scene.id);
  }
  // The Starter conversation ends in a lead, never a booking; a person takes over in the fourth.
  const shop = /id="demo-shop"[\s\S]*?id="demo-takeover"/.exec(html)![0];
  assert.match(shop, /<span class="demo-kind">Lead<\/span>/);
  assert.doesNotMatch(shop, /<span class="demo-kind">Booking<\/span>/);
  assert.match(html, /class="bubble staff"[^>]*><small class="demo-who">Mary · Baraka Dental<\/small>/);
  // Zaina in the demonstration does what the real one does: she says when she doesn't know.
  assert.match(words, /I don't have the instalment terms, so I won't guess\./);
  assert.match(words, /A demonstration with example businesses: the names, prices and times are examples\./);
  assert.doesNotMatch(words, /paystack|testimonial|guarantee|\b(tours?|safaris?|hotels?|villas?|holidays?|travel\w*)\b/i);
  // Nothing inline: the page's policy allows only its own script and styles.
  assert.doesNotMatch(html, / style="| on[a-z]+="|<script/);
  assert.doesNotMatch(DEMO_JS, /innerHTML|eval\(|setAttribute\("style"/);
});

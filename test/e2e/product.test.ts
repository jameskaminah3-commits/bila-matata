// End-to-end: what makes Zaina a product a business pays for by tier.
//
//   tiers     a Starter business gets answers, prices and leads, and no
//             booking tools or booking changes; moved to Full, it gets them
//   plans     the studio adds a business on a plan: its tier comes with the
//             plan, its set-up fee is invoiced, its monthly billing starts
//   support   a business asks, the studio answers, each hears about it;
//             another business can't read it
//   requests  the website's Book buttons: a request lands with the studio's
//             leads and in what needs its attention
//
// The model, Paystack and email are the stand-ins of scripted-model.mjs.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, sleep, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5098;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = "https://amani-hair.example";

let platform: Platform;
let api: Api;
let admin = "";

const emails = () => platform.log("emails") as Array<{ to: string[]; subject: string; text: string }>;
const page = (route: string, init?: RequestInit) => fetch(`${BASE}${route}`, { redirect: "manual", ...init });
const formPost = (route: string, fields: Record<string, string>, ip = "203.0.113.9") => page(route, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
  body: new URLSearchParams(fields),
});

async function addBusiness(body: Record<string, unknown>) {
  const created = await api("POST", "/v1/platform/businesses", body, admin);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body;
}
async function login(email: string): Promise<string> {
  const result = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.token;
}
/** The tools Zaina is given for a business, from one chat turn. */
async function toolsFor(businessId: string): Promise<string[]> {
  const opened = await fetch(`${BASE}/api/zaina/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: SITE }, body: JSON.stringify({ business: businessId }) });
  assert.equal(opened.status, 201, await opened.clone().text());
  const { token } = (await opened.json()) as { token: string };
  const before = platform.log("model").length;
  const reply = await fetch(`${BASE}/api/zaina/chat`, { method: "POST", headers: { "content-type": "application/json", origin: SITE, authorization: `Bearer ${token}` }, body: JSON.stringify({ message: "Hi" }) });
  assert.equal(reply.status, 200, await reply.clone().text());
  const call = platform.log("model").slice(before).at(-1) as { toolNames: string[] };
  return call.toolNames;
}

before(async () => {
  platform = await startPlatform({
    port: PORT,
    env: { PUBLIC_BASE_URL: BASE, PLATFORM_PAYSTACK_SECRET_KEY: "sk_test_productplans0001", RESEND_API_KEY: "re_test_key", ALERT_FROM_EMAIL: "Bila Matata <hello@example.com>", STUDIO_NOTIFY_EMAIL: "studio@example.com" },
  });
  api = apiFor(BASE);
  platform.cli("create-staff.ts", ["--email", "admin@example.com", "--name", "Studio Admin", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  admin = await login("admin@example.com");
});

after(async () => {
  await platform?.stop();
});

test("a Starter business gets answers and leads, not bookings; on Full it gets them", async () => {
  const created = await addBusiness({ id: "amani-hair", name: "Amani Hair Studio", business_type: "salon", tier: "starter", allowed_origins: [SITE], owner: { email: "amani@example.com", name: "Amani", password: PASSWORD } });
  assert.equal(created.business.tier, "starter");
  const owner = await login("amani@example.com");
  const staff = (method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/amani-hair${route}`, body, owner);
  await sleep(300);

  // The dashboard is told what it works as (a general business) and what it is.
  const operations = (await staff("GET", "/operations")).body;
  assert.deepEqual({ type: operations.business_type, kind: operations.kind, tier: operations.tier }, { type: "general", kind: "salon", tier: "starter" });
  const me = await api("GET", "/v1/staff/me", undefined, owner);
  const membership = (me.body.businesses ?? []).find((row: any) => row.businessId === "amani-hair");
  if (membership) assert.deepEqual({ type: membership.businessType, kind: membership.kind, tier: membership.tier }, { type: "general", kind: "salon", tier: "starter" });

  // Zaina has no booking tools; she can still quote the price list and take a lead.
  const starter = await toolsFor("amani-hair");
  assert.ok(starter.includes("create_lead") && starter.includes("get_prices") && starter.includes("search_knowledge"), starter.join(", "));
  for (const tool of ["check_times", "create_appointment", "list_services"]) assert.ok(!starter.includes(tool), `${tool} on Starter`);

  // And the team can't add a service or change booking settings: that's the Full plan.
  const blocked = await staff("POST", "/offerings", { name: "Knotless braids", kind: "service" });
  assert.equal(blocked.status, 402, JSON.stringify(blocked.body));
  assert.equal(blocked.body.error, "plan_required");
  assert.match(blocked.body.message, /Full Booking & Quote Engine/);
  assert.equal((await staff("PUT", "/booking-settings", {})).status, 402);
  // Reading what's there, and everything every plan has, stays open.
  assert.notEqual((await staff("GET", "/bookings")).status, 402);
  assert.equal((await staff("GET", "/leads")).status, 200);
  assert.equal((await staff("GET", "/billing")).body.tier, "starter");

  // The studio moves it to Full.
  const moved = await api("PATCH", "/v1/platform/businesses/amani-hair", { tier: "full" }, admin);
  assert.deepEqual({ status: moved.status, tier: moved.body.tier }, { status: 200, tier: "full" });
  await sleep(300);
  assert.equal((await staff("GET", "/operations")).body.business_type, "salon");
  const full = await toolsFor("amani-hair");
  for (const tool of ["check_times", "create_appointment", "list_services"]) assert.ok(full.includes(tool), `${tool} on Full`);
  assert.notEqual((await staff("POST", "/offerings", { name: "Knotless braids", kind: "service" })).status, 402);
  assert.equal((await api("PATCH", "/v1/platform/businesses/amani-hair", { tier: "gold" }, admin)).status, 400);
  assert.equal((await api("PATCH", "/v1/platform/businesses/amani-hair", { tier: "starter" }, owner)).status, 403, "only the studio sets a tier");
});

test("the studio adds a business on a plan: the tier, the set-up invoice and its billing come with it", async () => {
  for (const plan of [
    { id: "starter", name: "Starter Sales Concierge", price_minor: 670_000, currency: "KES", tier: "starter", setup_fee_minor: 1_000_000, sort_order: 10 },
    { id: "full", name: "Full Booking & Quote Engine", price_minor: 1_100_000, currency: "KES", tier: "full", setup_fee_minor: 2_000_000, sort_order: 20 },
  ]) {
    const made = await api("POST", "/v1/platform/plans", plan, admin);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual({ tier: made.body.plan?.tier ?? made.body.tier, fee: made.body.plan?.setup_fee_minor ?? made.body.setup_fee_minor }, { tier: plan.tier, fee: plan.setup_fee_minor });
  }
  const created = await addBusiness({ id: "tamarind", name: "Tamarind Grill", business_type: "restaurant", plan_id: "starter", setup_invoice: true, owner: { email: "tamarind@example.com", name: "Kevin", password: PASSWORD } });
  assert.deepEqual({ tier: created.business.tier, plan: created.business.plan_id }, { tier: "starter", plan: "starter" });
  assert.match(created.setup_invoice.reference, /^BM-[A-Z2-9]{8}$/);
  assert.equal(created.setup_invoice.pay_url, `${BASE}/pay/${created.setup_invoice.reference}`);

  // The set-up fee is a studio invoice the owner pays on /pay, and they were sent its link.
  const invoices = (await api("GET", "/v1/platform/studio-invoices", undefined, admin)).body.invoices;
  const setup = invoices.find((invoice: any) => invoice.reference === created.setup_invoice.reference);
  assert.deepEqual(
    { client: setup.client_name, email: setup.client_email, amount: setup.amount_minor, category: setup.category, description: setup.description, status: setup.status },
    { client: "Tamarind Grill", email: "tamarind@example.com", amount: 1_000_000, category: "zaina_setup", description: "Zaina AI set-up: Starter Sales Concierge", status: "open" },
  );
  await eventually(() => emails().find((email) => email.to[0] === "tamarind@example.com" && email.subject.startsWith(`Invoice ${setup.reference}`)), "the set-up invoice email");

  // Its monthly billing has started, on that plan.
  const billing = (await api("GET", "/v1/platform/billing", undefined, admin)).body;
  assert.equal(billing.subscriptions.find((row: any) => row.business_id === "tamarind")?.plan_id, "starter");
  const owner = await login("tamarind@example.com");
  const mine = (await api("GET", "/v1/staff/businesses/tamarind/billing", undefined, owner)).body;
  assert.deepEqual({ tier: mine.tier, plan: mine.subscription?.plan?.id, byTeam: mine.billed_by_team }, { tier: "starter", plan: "starter", byTeam: false });

  // Moved to the Full plan: the tier follows.
  const moved = await api("PATCH", "/v1/platform/businesses/tamarind", { plan_id: "full" }, admin);
  assert.deepEqual({ status: moved.status, tier: moved.body.tier }, { status: 200, tier: "full" });
  await sleep(300);
  assert.equal((await api("GET", "/v1/staff/businesses/tamarind/billing", undefined, owner)).body.subscription.plan.id, "full");
  assert.equal((await api("GET", "/v1/platform/businesses", undefined, admin)).body.businesses.find((row: any) => row.id === "tamarind").tier, "full");
  assert.equal((await api("PATCH", "/v1/platform/businesses/tamarind", { plan_id: "platinum" }, admin)).status, 404);
  assert.equal((await api("POST", "/v1/platform/businesses", { id: "nope", name: "Nope", plan_id: "platinum", owner: { email: "nope@example.com", name: "N", password: PASSWORD } }, admin)).status, 404);
});

test("support: a business asks, the studio answers, each hears about it, and nobody else can read it", async () => {
  const owner = await login("amani@example.com");
  const other = await login("tamarind@example.com");
  const base = "/v1/staff/businesses/amani-hair/support";
  assert.deepEqual((await api("GET", base, undefined, owner)).body.threads, []);

  const asked = await api("POST", base, { subject: "Zaina gave the wrong delivery price", topic: "problem", message: "She said KSh 500. It is KSh 1,500." }, owner);
  assert.equal(asked.status, 201, JSON.stringify(asked.body));
  const id = asked.body.thread.id;
  assert.deepEqual({ status: asked.body.thread.status, topic: asked.body.thread.topic_label, unread: asked.body.thread.unread }, { status: "open", topic: "Something isn't working", unread: false });
  assert.equal((await api("POST", base, { subject: "x", message: "" }, owner)).status, 400);

  // The studio hears about it, and sees it waiting.
  const told = await eventually(() => emails().find((email) => email.to[0] === "studio@example.com" && email.subject === "Support · Amani Hair Studio: Zaina gave the wrong delivery price"), "the studio's email");
  assert.ok(told.text.includes("She said KSh 500.") && told.text.includes(`${BASE}/app/#/platform/support/${id}`));
  assert.equal((await api("GET", "/v1/platform/attention", undefined, admin)).body.support_open, 1);
  const waiting = (await api("GET", "/v1/platform/support?status=open", undefined, admin)).body;
  assert.deepEqual(waiting.threads.map((thread: any) => [thread.id, thread.business_name, thread.unread]), [[id, "Amani Hair Studio", true]]);

  // It answers; the thread is answered, and the business has something unread.
  const answered = await api("POST", `/v1/platform/support/${id}/messages`, { message: "Fixed: the delivery price on your list is now KSh 1,500." }, admin);
  assert.equal(answered.status, 201, JSON.stringify(answered.body));
  assert.equal(answered.body.thread.status, "answered");
  assert.equal((await api("GET", "/v1/platform/attention", undefined, admin)).body.support_open, 0);
  assert.equal((await api("GET", "/v1/staff/businesses/amani-hair/pending-count", undefined, owner)).body.support, 1);
  const reply = await eventually(() => emails().find((email) => email.to[0] === "amani@example.com" && email.subject === "Bila Matata replied: Zaina gave the wrong delivery price"), "the business's email");
  assert.ok(reply.text.includes(`${BASE}/app/#/b/amani-hair/support/${id}`));

  // The business reads it (no longer unread), with who said what.
  const read = (await api("GET", `${base}/${id}`, undefined, owner)).body;
  assert.deepEqual(read.messages.map((message: any) => [message.from_studio, message.author]), [[false, "Amani"], [true, "Studio Admin · Bila Matata"]]);
  assert.equal((await api("GET", "/v1/staff/businesses/amani-hair/pending-count", undefined, owner)).body.support, 0);

  // Closed, then a new message reopens it for the studio.
  assert.equal((await api("POST", `${base}/${id}/close`, {}, owner)).body.thread.status, "closed");
  assert.equal((await api("POST", `${base}/${id}/messages`, { message: "One more thing: the same for pick-up?" }, owner)).body.thread.status, "open");
  assert.equal((await api("POST", `/v1/platform/support/${id}/messages`, { message: "Pick-up is free.", close: true }, admin)).body.thread.status, "closed");
  assert.equal((await api("POST", `/v1/platform/support/${id}/reopen`, {}, admin)).body.thread.status, "open");

  // Another business, and someone not signed in, find nothing.
  assert.equal((await api("GET", `/v1/staff/businesses/tamarind/support/${id}`, undefined, other)).status, 404);
  assert.equal((await api("POST", `/v1/staff/businesses/tamarind/support/${id}/messages`, { message: "hello" }, other)).status, 404);
  assert.ok([403, 404].includes((await api("GET", `${base}/${id}`, undefined, other)).status), "not a member of that business");
  assert.equal((await api("GET", "/v1/platform/support", undefined, owner)).status, 403);
  assert.equal((await api("GET", base)).status, 401);
});

test("the website's Book buttons: a request lands with the studio's leads and in what needs attention", async () => {
  const home = await (await page("/")).text();
  assert.match(home, /<p class="from"><span>From<\/span> KES 25,000<\/p><a class="btn btn-primary" href="\/start\?service=software">Book a free consultation<\/a>/);
  assert.match(home, /id="demo"/);
  const start = await page("/start?service=data");
  assert.equal(start.status, 200);
  assert.match(await start.text(), /Data Analysis &amp; Business Intelligence starts from KES 10,000\./);

  // Something missing: the form comes back with what was typed and what's wrong.
  const wrong = await formPost("/start", { name: "Brian", service: "data", details: "Sales analysis for 2026, please." });
  assert.equal(wrong.status, 400);
  const html = await wrong.text();
  assert.ok(html.includes('value="Brian"') && html.includes("Give a WhatsApp or phone number, or an email, so we can reach you."));

  const before = (await api("GET", "/v1/platform/attention", undefined, admin)).body.project_requests_new;
  const sent = await formPost("/start", { name: "Brian Otieno", business: "Pwani Furniture", phone: "+254 700 000 789", email: "", service: "data", details: "Sales analysis for 2026, and a dashboard the team can read." });
  assert.equal(sent.status, 303);
  assert.equal(sent.headers.get("location"), "/start/thanks?service=data");
  assert.match(await (await page("/start/thanks?service=data")).text(), /We've got your request\./);

  // It's with the studio's leads, where its team follows it up.
  const leads = (await api("GET", "/v1/staff/businesses/bilamatata/leads", undefined, admin)).body.leads;
  const lead = leads.find((row: any) => row.name === "Brian Otieno");
  assert.ok(lead, JSON.stringify(leads));
  assert.equal(lead.interest, "Data Analysis & Business Intelligence");
  assert.equal(lead.phone, "+254 700 000 789");
  assert.ok(String(lead.notes).includes("Business: Pwani Furniture") && String(lead.notes).includes("Sent from the website's request form."));
  assert.equal((await api("GET", "/v1/platform/attention", undefined, admin)).body.project_requests_new, before + 1);
  await eventually(() => emails().find((email) => email.to[0] === "studio@example.com" && email.subject === "New request: Brian Otieno (Pwani Furniture) wants: Data Analysis & Business Intelligence"), "the studio's email");

  // A script that fills the hidden field is thanked, and nothing is saved.
  const bot = await formPost("/start", { name: "Bot", phone: "+254700000000", service: "other", details: "Buy cheap followers now", website: "http://spam.example" });
  assert.equal(bot.headers.get("location"), "/start/thanks");
  assert.ok(!(await api("GET", "/v1/staff/businesses/bilamatata/leads", undefined, admin)).body.leads.some((row: any) => row.name === "Bot"));

  // And one visitor can't flood it.
  let last = 0;
  for (let attempt = 0; attempt < 7; attempt += 1) last = (await formPost("/start", { name: "Flood", phone: "+254700000001", service: "other", details: "The same thing again and again." }, "203.0.113.77")).status;
  assert.equal(last, 429);
});

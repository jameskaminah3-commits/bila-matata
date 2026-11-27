// End-to-end: bilamatata.com's own site and the studio's invoices.
//
//   site      the home page, terms, robots and sitemap; the studio's own
//             Zaina works on the service's own address (and nowhere it
//             isn't allowed)
//   /pay      a client finds an invoice by its reference and pays it on
//             Paystack; the payment settles when they come back, on the
//             signed webhook (/api/paystack/webhook), or when the sweep asks
//             Paystack, whichever is first, and only once
//   refused   a webhook nobody signed, a charge for another amount, a second
//             payment of a paid invoice, a visitor who isn't the studio's team
//   bookings  a business's booking payment pages (/pay/<token>) are untouched
//
// Paystack and email are the stand-ins of scripted-model.mjs.

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5096;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "sk_test_studioinvoices01";

let platform: Platform;
let api: Api;
let admin = "";
let agent = "";

const emails = () => platform.log("emails") as Array<{ to: string[]; subject: string; text: string }>;
const initializations = () => platform.log("paystack").filter((entry: any) => entry.kind === "initialize");
const invoices = async () => (await api("GET", "/v1/platform/studio-invoices", undefined, admin)).body.invoices as any[];
const invoiceById = async (id: string) => (await invoices()).find((row) => row.id === id);
const page = (route: string, init?: RequestInit) => fetch(`${BASE}${route}`, { redirect: "manual", ...init });

async function newInvoice(fields: Record<string, unknown> = {}) {
  const created = await api("POST", "/v1/platform/studio-invoices", { client_name: "Acme Traders", description: "50% deposit: company website, 6 pages", category: "software", amount: 45000, ...fields }, admin);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.invoice as { id: string; reference: string; pay_url: string; status: string };
}

/** The client gives an email and is sent to Paystack: the payment's own reference. */
async function startPaying(reference: string, email = "payer@example.com"): Promise<string> {
  const started = await page(`/pay/${reference}/start`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email }) });
  assert.equal(started.status, 303);
  const location = started.headers.get("location") ?? "";
  const payment = /^https:\/\/checkout\.paystack\.com\/fake_(bm_[0-9a-f]{24})$/.exec(location)?.[1];
  assert.ok(payment, location);
  return payment;
}

async function webhook(payload: unknown, options: { key?: string; route?: string } = {}) {
  const raw = JSON.stringify(payload);
  const response = await fetch(`${BASE}${options.route ?? "/api/paystack/webhook"}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", options.key ?? KEY).update(raw).digest("hex") },
    body: raw,
  });
  return response.status;
}
const charge = (reference: string, amount: number, id = 880001) => ({ event: "charge.success", data: { id, status: "success", reference, amount, currency: "KES", channel: "mobile_money", gateway_response: "Approved" } });

before(async () => {
  platform = await startPlatform({
    port: PORT,
    env: {
      PUBLIC_BASE_URL: BASE,
      PLATFORM_PAYSTACK_SECRET_KEY: KEY,
      RESEND_API_KEY: "re_test_key",
      ALERT_FROM_EMAIL: "Bila Matata <hello@example.com>",
      STUDIO_NOTIFY_EMAIL: "studio@example.com",
      BOOKING_SWEEP_INTERVAL_MS: "300",
      PAYMENT_CHECK_AFTER_MS: "1500",
    },
  });
  api = apiFor(BASE);
  platform.cli("create-staff.ts", ["--email", "admin@example.com", "--name", "Studio Admin", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  platform.cli("create-staff.ts", ["--email", "agent@example.com", "--name", "Agent", "--business", "bilamatata", "--role", "agent"], { STAFF_PASSWORD: PASSWORD });
  admin = (await api("POST", "/v1/staff/login", { email: "admin@example.com", password: PASSWORD })).body.token;
  agent = (await api("POST", "/v1/staff/login", { email: "agent@example.com", password: PASSWORD })).body.token;
  assert.ok(admin && agent);
});

after(async () => {
  await platform?.stop();
});

test("the home page and terms are served as plain documents under a strict policy", async () => {
  const home = await page("/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") ?? "", /^text\/html/);
  const policy = home.headers.get("content-security-policy") ?? "";
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self'(;|$)/);
  assert.match(policy, /style-src 'self'(;|$)/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.equal(home.headers.get("x-robots-tag"), null, "the home page may be indexed");
  const html = await home.text();
  assert.match(html, /Run Your Business <em>Without the Hassle\.<\/em>/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${BASE}/">`));
  assert.match(html, /<script src="\/zaina\.js" data-business="bilamatata" async><\/script>/);

  const terms = await page("/terms");
  assert.equal(terms.status, 200);
  assert.match(await terms.text(), /Data Protection Act, 2019/);
  for (const [route, type] of [["/site/site.css", "text/css"], ["/site/site.js", "application/javascript"], ["/site/favicon.svg", "image/svg+xml"]]) {
    const asset = await page(route);
    assert.equal(asset.status, 200, route);
    assert.ok((asset.headers.get("content-type") ?? "").startsWith(type), route);
  }
  const robots = await (await page("/robots.txt")).text();
  assert.match(robots, /Disallow: \/app\//);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, new RegExp(`Sitemap: ${BASE}/sitemap.xml`));
  const sitemap = await (await page("/sitemap.xml")).text();
  for (const route of ["/", "/terms", "/pay"]) assert.ok(sitemap.includes(`<loc>${BASE}${route}</loc>`), route);
});

test("the studio's own Zaina answers on the service's own address, and only where it's allowed", async () => {
  const open = (origin: string, business = "bilamatata") => fetch(`${BASE}/api/zaina/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ business, display_currency: "KES" }),
  });
  const own = await open(BASE);
  assert.equal(own.status, 201, await own.clone().text());
  const session = (await own.json()) as { token: string };
  const reply = await fetch(`${BASE}/api/zaina/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ message: "What does Zaina cost?" }),
  });
  assert.equal(reply.status, 200, await reply.clone().text());
  assert.ok(((await reply.json()) as { reply?: string }).reply);
  assert.equal((await open("https://bilamatata.co.ke")).status, 201, "the live address, from the migration");
  assert.equal((await open("https://bilamatata.com")).status, 201, "the new address");
  assert.equal((await open("https://www.bilamatata.com")).status, 201);
  assert.equal((await open("https://someone-else.example")).status, 403);
});

test("a client finds their invoice by its reference; a wrong one finds nothing", async () => {
  const invoice = await newInvoice({ client_email: "accounts@example.com", email_client: true });
  assert.match(invoice.reference, /^BM-[A-Z2-9]{8}$/);
  assert.equal(invoice.pay_url, `${BASE}/pay/${invoice.reference}`);
  const sent = await eventually(() => emails().find((email) => email.subject.startsWith(`Invoice ${invoice.reference} from Bila Matata`)), "the invoice email");
  assert.deepEqual(sent.to, ["accounts@example.com"]);
  assert.ok(sent.text.includes(invoice.pay_url));

  const payHome = await page("/pay");
  assert.equal(payHome.status, 200);
  assert.match(await payHome.text(), /Find your invoice/);
  const found = await page(`/pay/find?ref=${encodeURIComponent(invoice.reference.toLowerCase().replace("-", " "))}`);
  assert.equal(found.status, 303);
  assert.equal(found.headers.get("location"), `/pay/${invoice.reference}`);
  const missing = await page("/pay/find?ref=BM-ZZZZ2222");
  assert.equal(missing.headers.get("location"), "/pay?m=not_found&ref=BM-ZZZZ2222");
  assert.equal((await page("/pay/BM-ZZZZ2222")).headers.get("location"), "/pay?m=not_found");

  const shown = await page(`/pay/${invoice.reference}`);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(shown.headers.get("cache-control"), "no-store");
  const html = await shown.text();
  assert.match(html, /KES 45,000/);
  assert.match(html, /50% deposit: company website, 6 pages/);
  assert.match(html, /Test mode/);
  assert.doesNotMatch(html, /Paystack/i, "the page doesn't name the payment provider");
  assert.ok(!html.includes("accounts@example.com"), "the client's email isn't shown to whoever has the link");
});

test("paying on Paystack: nothing is paid until Paystack says so, then the invoice is paid once and the receipt goes out once", async () => {
  const invoice = await newInvoice({ client_email: "accounts@example.com" });
  const bad = await page(`/pay/${invoice.reference}/start`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: "not-an-email" }) });
  assert.equal(bad.headers.get("location"), `/pay/${invoice.reference}?m=email`);

  const payment = await startPaying(invoice.reference);
  const asked = initializations().find((entry: any) => entry.reference === payment) as any;
  assert.deepEqual(
    { amount: asked.amount, currency: asked.currency, email: asked.email, callback: asked.callback, subaccount: asked.subaccount },
    { amount: 4_500_000, currency: "KES", email: "payer@example.com", callback: `${BASE}/pay/verify`, subaccount: null },
  );
  // A second click reuses the same Paystack page: one payment, however many tabs.
  assert.equal(await startPaying(invoice.reference), payment);

  // Back from Paystack without paying.
  const early = await page(`/pay/verify?reference=${payment}&trxref=${payment}`);
  assert.equal(early.headers.get("location"), `/pay/${invoice.reference}?m=pending`);
  assert.equal((await invoiceById(invoice.id)).status, "open");
  const waiting = await (await page(`/pay/${invoice.reference}?m=pending`)).text();
  assert.match(waiting, /waiting for your payment to be confirmed/);
  assert.match(waiting, /<meta http-equiv="refresh" content="8">/);

  // Paid on Paystack; the payer comes back.
  platform.payOnPaystack(payment);
  const back = await page(`/pay/verify?reference=${payment}&trxref=${payment}`);
  assert.equal(back.headers.get("location"), `/pay/${invoice.reference}?m=paid`);
  const paid = await invoiceById(invoice.id);
  assert.deepEqual({ status: paid.status, method: paid.method, attention: paid.attention }, { status: "paid", method: "paystack", attention: null });
  assert.ok(paid.receipt && paid.paid_at);
  const html = await (await page(`/pay/${invoice.reference}?m=paid`)).text();
  assert.match(html, /Payment received/);
  assert.doesNotMatch(html, /<form method="post"/);

  // The same news again (the return, then the webhook): nothing changes, no second receipt.
  await page(`/pay/verify?reference=${payment}`);
  assert.equal(await webhook(charge(payment, 4_500_000)), 200);
  const receipts = await eventually(() => {
    const list = emails().filter((email) => email.subject === `Receipt: invoice ${invoice.reference} paid (KES 45,000)`);
    return list.length >= 2 ? list : null;
  }, "the receipts");
  assert.deepEqual(receipts.map((email) => email.to[0]).sort(), ["accounts@example.com", "payer@example.com"]);
  assert.equal(emails().filter((email) => email.subject.startsWith(`Paid: ${invoice.reference}`) && email.to[0] === "studio@example.com").length, 1);
  // A paid invoice can't be paid again.
  const again = await page(`/pay/${invoice.reference}/start`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: "payer@example.com" }) });
  assert.equal(again.headers.get("location"), `/pay/${invoice.reference}`);
});

test("Paystack's webhook pays an invoice only when Paystack signed it and the amount is the amount asked", async () => {
  const invoice = await newInvoice({ client_name: "Pwani Clinic", description: "Zaina AI set-up: Starter Sales Concierge", category: "zaina_setup", amount: 10000 });
  const payment = await startPaying(invoice.reference, "clinic@example.com");

  // Signed by someone else's key, or not at all: refused, and nothing changes.
  assert.equal(await webhook(charge(payment, 1_000_000), { key: "sk_test_someoneelse0001" }), 401);
  const unsigned = await fetch(`${BASE}/api/paystack/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(charge(payment, 1_000_000)) });
  assert.equal(unsigned.status, 401);
  assert.equal((await invoiceById(invoice.id)).status, "open");

  // Signed, but for KES 1 instead of KES 10,000: the invoice stays unpaid, and the studio is told to look.
  assert.equal(await webhook(charge(payment, 100, 880010)), 200);
  assert.equal((await invoiceById(invoice.id)).status, "open");
  const { rows: [mismatch] } = await platform.db.query("select status, note from studio_invoice_payments where reference = $1", [payment]);
  assert.equal(mismatch.status, "failed");
  assert.match(mismatch.note, /not the amount asked/);

  // A fresh payment, signed and for the right amount, by either name of the webhook.
  const second = await startPaying(invoice.reference, "clinic@example.com");
  assert.notEqual(second, payment);
  assert.equal(await webhook(charge(second, 1_000_000, 880011), { route: "/v1/payments/paystack" }), 200);
  const paid = await invoiceById(invoice.id);
  assert.deepEqual({ status: paid.status, method: paid.method, receipt: paid.receipt }, { status: "paid", method: "paystack", receipt: "880011" });
});

test("a payment finished on Paystack without coming back is found by the sweep", async () => {
  const invoice = await newInvoice({ client_name: "Quiet Payer", description: "Sales dashboard", category: "data", amount: 30000 });
  const payment = await startPaying(invoice.reference, "quiet@example.com");
  platform.payOnPaystack(payment);
  const paid = await eventually(async () => {
    const row = await invoiceById(invoice.id);
    return row.status === "paid" ? row : null;
  }, "the sweep to settle the payment", 12_000);
  assert.equal(paid.method, "paystack");
  await eventually(() => emails().find((email) => email.subject.startsWith(`Receipt: invoice ${invoice.reference}`) && email.to[0] === "quiet@example.com"), "the receipt");
});

test("a second payment of an invoice that's already paid is kept and flagged for a refund", async () => {
  const invoice = await newInvoice({ client_name: "Twice Ltd", description: "Market research report", category: "research", amount: 80000 });
  const first = await startPaying(invoice.reference, "one@example.com");
  const second = await startPaying(invoice.reference, "two@example.com");
  assert.notEqual(first, second, "another payer, another Paystack page");
  assert.equal(await webhook(charge(first, 8_000_000, 880021)), 200);
  assert.equal(await webhook(charge(second, 8_000_000, 880022)), 200);
  const row = await invoiceById(invoice.id);
  assert.equal(row.status, "paid");
  assert.equal(row.receipt, "880021");
  assert.match(row.attention, /refund this payment in Paystack/);
});

test("the studio's team marks an invoice paid by hand or voids it; nobody else can see or change invoices", async () => {
  const byHand = await newInvoice({ client_name: "By Hand Ltd", description: "Workflow automation: invoicing", category: "automation", amount: 60000 });
  const noReceipt = await api("POST", `/v1/platform/studio-invoices/${byHand.id}/paid`, { receipt: " " }, admin);
  assert.equal(noReceipt.status, 400);
  const marked = await api("POST", `/v1/platform/studio-invoices/${byHand.id}/paid`, { receipt: "SJK4XYZ123" }, admin);
  assert.deepEqual({ status: marked.body.invoice.status, method: marked.body.invoice.method, receipt: marked.body.invoice.receipt }, { status: "paid", method: "manual", receipt: "SJK4XYZ123" });
  assert.equal((await api("POST", `/v1/platform/studio-invoices/${byHand.id}/void`, {}, admin)).status, 409);

  const cancelled = await newInvoice({ client_name: "Changed Mind", description: "Mobile app design", category: "software", amount: 120000 });
  const voided = await api("POST", `/v1/platform/studio-invoices/${cancelled.id}/void`, {}, admin);
  assert.equal(voided.body.invoice.status, "void");
  assert.match(await (await page(`/pay/${cancelled.reference}`)).text(), /nothing to pay/);
  assert.equal((await api("POST", `/v1/platform/studio-invoices/${cancelled.id}/paid`, { receipt: "LATE12345" }, admin)).status, 409);

  // Only what the studio itself sells can be invoiced here.
  const other = await api("POST", "/v1/platform/studio-invoices", { client_name: "X", description: "Something else", category: "accommodation", amount: 100 }, admin);
  assert.equal(other.status, 400);

  assert.equal((await api("GET", "/v1/platform/studio-invoices")).status, 401);
  assert.equal((await api("GET", "/v1/platform/studio-invoices", undefined, agent)).status, 403, "a business's own staff aren't the studio's team");
  assert.equal((await api("POST", "/v1/platform/studio-invoices", { client_name: "X", description: "Website", category: "software", amount: 100 }, agent)).status, 403);
  assert.equal((await api("POST", `/v1/platform/studio-invoices/${byHand.id}/void`, {}, agent)).status, 403);
  assert.equal((await api("POST", "/v1/platform/studio-invoices/not-an-id/void", {}, admin)).status, 404);
});

test("a business's booking payment pages still answer at /pay/<token>", async () => {
  const unknown = await page("/pay/AbCdEfGhIjKlMnOpQrStUvWx");
  assert.equal(unknown.status, 404);
  assert.match(await unknown.text(), /Booking not found/);
  assert.equal((await page("/pay-assets/pay.css")).status, 200);
});

test("Businesses powered by Zaina: only businesses the studio turns on in /admin, live and on a plan with Zaina", async () => {
  const add = async (id: string, tier: string) => assert.equal((await api("POST", "/v1/platform/businesses", { id, name: id === "amani" ? "Amani Hair Studio" : "Corner Menu", tier, business_type: "salon", allowed_origins: [BASE], owner: { email: `${id}@example.com`, name: "Owner", password: PASSWORD } }, admin)).status, 201);
  await add("amani", "starter");
  await add("cornermenu", "menu");
  const listed = (await api("GET", "/v1/platform/businesses", undefined, admin)).body.businesses.find((business: any) => business.id === "amani");
  assert.equal(listed.featured_on_studio, false, "off until the studio turns it on");
  assert.doesNotMatch(await (await page("/")).text(), /Businesses powered by Zaina/);
  assert.equal((await api("PATCH", "/v1/platform/businesses/amani", { featured_on_studio: true }, agent)).status, 403, "a business's staff can't feature it");
  assert.equal((await api("PATCH", "/v1/platform/businesses/amani", { featured_on_studio: "yes" }, admin)).status, 400);
  for (const id of ["amani", "cornermenu"]) assert.equal((await api("PATCH", `/v1/platform/businesses/${id}`, { featured_on_studio: true }, admin)).status, 200);
  const home = await (await page("/")).text();
  assert.match(home, /<p class="powered-label">Businesses powered by Zaina<\/p>/);
  assert.match(home, /<strong>Amani Hair Studio<\/strong>/);
  assert.doesNotMatch(home, /Corner Menu/, "a Menu plan business has no Zaina to be powered by");
  assert.equal((await api("PATCH", "/v1/platform/businesses/amani", { featured_on_studio: false }, admin)).status, 200);
  assert.doesNotMatch(await (await page("/")).text(), /Businesses powered by Zaina/, "turned off: gone at once");
});

test("the blog is served for search engines: articles, a feed, the sitemap, and a 404 for what isn't there", async () => {
  const index = await page("/blog");
  assert.equal(index.status, 200);
  assert.equal(index.headers.get("x-robots-tag"), null, "indexable");
  assert.match(index.headers.get("content-security-policy") ?? "", /script-src 'self'/);
  const html = await index.text();
  assert.match(html, /<h1>Guides for growing your business<\/h1>/);
  const article = await page("/blog/business-website-cost-kenya");
  assert.equal(article.status, 200);
  assert.match(await article.text(), /"@type":"BlogPosting"/);
  assert.equal((await page("/blog/no-such-article")).status, 404);
  const feed = await page("/blog/feed.xml");
  assert.match(feed.headers.get("content-type") ?? "", /application\/rss\+xml/);
  assert.match(await feed.text(), /<link>[^<]+\/blog\/business-website-cost-kenya<\/link>/);
  const sitemap = await (await page("/sitemap.xml")).text();
  assert.match(sitemap, /<loc>[^<]+\/blog<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.match(sitemap, /<loc>[^<]+\/blog\/qr-code-menu-restaurants-kenya<\/loc><lastmod>2026-11-27<\/lastmod>/);
});

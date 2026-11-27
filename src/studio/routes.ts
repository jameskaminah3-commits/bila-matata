// src/studio/routes.ts
//
// bilamatata.com's own pages and the studio's invoices:
//
//   GET  /                         the home page (with the studio's own Zaina)
//   GET  /terms                    terms of service and privacy
//   GET  /privacy, /data-deletion  the privacy section of /terms (the addresses Meta's app settings ask for)
//   GET  /site/site.css, /site/site.js, /site/favicon.svg, /site/og.png, /site/og-zaina.png
//   GET  /robots.txt, /sitemap.xml
//   GET  /blog, /blog/<slug>, /blog/feed.xml   the articles
//
//   GET  /pay                      find an invoice by its reference
//   GET  /pay/find?ref=…           → the invoice's page
//   GET  /pay/BM-XXXXXXXX          the invoice: what it's for, how much, pay
//   POST /pay/BM-XXXXXXXX/start    { email } → Paystack's page (M-Pesa or card)
//   GET  /pay/verify?reference=…   back from Paystack: ask how it went
//
//   Platform admins (the studio's own team), from the dashboard:
//   GET  /v1/platform/studio-invoices             every invoice
//   POST /v1/platform/studio-invoices             { client_name, client_email?, description, category, amount, currency?, due_on?, notes?, email_client? }
//   POST /v1/platform/studio-invoices/:id/paid    { receipt }: paid by hand (bank or M-Pesa)
//   POST /v1/platform/studio-invoices/:id/void    cancel an open invoice
//
// These are registered before the booking payment pages (/pay/:token): an
// invoice reference (BM- and 8 characters) never looks like a booking's
// 24-character token, so the two share /pay without meeting.
//
// Paystack's webhook for the studio's account is the platform's
// (/api/paystack/webhook, the same as /v1/payments/paystack): payments whose
// reference starts "bm_" are the studio's invoices (payments/checkout.ts).

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { consumeLimits, type LimitRule } from "../gateway/rate-limit.ts";
import { visitorKey } from "../gateway/visitor.ts";
import { mailerConfigured, sendEmail } from "../platform/mailer.ts";
import { requirePlatformAdmin, requireStaff, staffOf } from "../staff/auth.ts";
import { formatMoney } from "./brand.ts";
import {
  categoryLabels,
  createStudioInvoice,
  listStudioInvoices,
  markStudioInvoicePaid,
  normalizeInvoiceReference,
  STUDIO_PAYMENT_REFERENCE,
  startStudioPayment,
  studioCategories,
  StudioInvoiceError,
  studioInvoiceByReference,
  studioInvoiceOfPayment,
  studioPaymentsOf,
  validateNewInvoice,
  voidStudioInvoice,
  type StudioInvoice,
} from "./invoices.ts";
import { invoiceEmail, invoiceLink, settleAndNotify, studioCheckout, studioPayAvailable, studioPayTestMode } from "./pay.ts";
import { PAY_MESSAGES, renderInvoicePage, renderPayHome } from "./pay-pages.ts";
import { FAVICON_SVG, renderHome, renderTerms, type SitePage } from "./pages.ts";
import { readRequest, saveRequest } from "./requests.ts";
import { requestTopic } from "./services.ts";
import { renderStart, renderStartThanks } from "./start-pages.ts";
import { ZAINA_FACE_SVG } from "../brand/zaina-face.ts";
import { SITE_SCRIPT, SITE_STYLES } from "./site-css.ts";
import { featuredBusinesses } from "./featured.ts";
import { articleBySlug } from "./blog/articles.ts";
import { articlesByDate, renderArticle, renderBlogIndex, renderFeed } from "./blog/pages.ts";

/** The site's pages run only the site's own scripts and styles; forms go to the site, then on to Paystack. */
const SITE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self' https://checkout.paystack.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

function pageHeaders(res: Response, options: { cache: boolean; index: boolean }) {
  res.setHeader("Content-Security-Policy", SITE_CSP);
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", options.index ? "strict-origin-when-cross-origin" : "no-referrer");
  res.setHeader("Cache-Control", options.cache ? "public, max-age=300" : "no-store");
  if (!options.index) res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

/** The share image (assets/og.png, next to dist/ when bundled, or two levels up from src/studio/). */
function shareImage(name = "og.png"): Buffer | null {
  for (const relative of [`../assets/${name}`, `../../assets/${name}`]) {
    const file = fileURLToPath(new URL(relative, import.meta.url));
    if (existsSync(file)) return readFileSync(file);
  }
  return null;
}

const invoiceJson = (invoice: StudioInvoice & { attention?: string | null }, baseUrl: string | null) => ({
  id: invoice.id,
  reference: invoice.reference,
  client_name: invoice.clientName,
  client_email: invoice.clientEmail,
  description: invoice.description,
  category: invoice.category,
  category_label: categoryLabels[invoice.category],
  amount_minor: invoice.amountMinor,
  currency: invoice.currency,
  status: invoice.status,
  due_at: invoice.dueAt,
  paid_at: invoice.paidAt,
  method: invoice.method,
  receipt: invoice.receipt,
  notes: invoice.notes,
  created_at: invoice.createdAt,
  /** Something a person should look at (a payment to refund). */
  attention: invoice.attention ?? null,
  pay_url: invoiceLink(invoice, baseUrl),
});

export function registerStudioRoutes(app: Express, config: PlatformConfig): void {
  const secret = config.sessionTokenSecret;
  const form = express.urlencoded({ extended: false, limit: "4kb" });
  /** The site's own address: PUBLIC_BASE_URL, or (local development) the address the request came to. */
  const baseUrlOf = (req: Request) => config.publicBaseUrl ?? `${req.protocol}://${req.get("host") ?? "localhost"}`;
  const pageOf = (_req: Request): SitePage => ({ baseUrl: config.publicBaseUrl });
  const og = shareImage();
  const ogZaina = shareImage("og-zaina.png");

  const text = (type: string, body: string, maxAge = 3600) => (_req: Request, res: Response) => {
    res.setHeader("Content-Type", `${type}; charset=utf-8`);
    res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(body);
  };

  // ── The site ─────────────────────────────────────────────────────────
  app.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      pageHeaders(res, { cache: true, index: true });
      const base = config.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
      res.type("html").send(renderHome({ ...pageOf(req), featured: await featuredBusinesses(base) }));
    } catch (error) {
      next(error);
    }
  });
  app.get(["/privacy", "/data-deletion"], (_req: Request, res: Response) => res.redirect(301, "/terms#privacy"));
  app.get("/terms", (req: Request, res: Response) => {
    pageHeaders(res, { cache: true, index: true });
    res.type("html").send(renderTerms(pageOf(req)));
  });
  app.get("/site/site.css", text("text/css", SITE_STYLES));
  app.get("/site/site.js", text("application/javascript", SITE_SCRIPT));
  app.get("/site/favicon.svg", text("image/svg+xml", FAVICON_SVG, 86400));
  app.get("/site/zaina.svg", text("image/svg+xml", ZAINA_FACE_SVG, 86400));
  app.get("/favicon.ico", (_req: Request, res: Response) => res.redirect(302, "/site/favicon.svg"));
  app.get("/site/og.png", (_req: Request, res: Response) => {
    if (!og) return res.status(404).end();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(og);
  });
  app.get("/site/og-zaina.png", (_req: Request, res: Response) => {
    if (!ogZaina) return res.status(404).end();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(ogZaina);
  });
  app.get("/robots.txt", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("text/plain").send([
      "User-agent: *",
      "Allow: /",
      // The dashboard and the APIs are not pages; invoice pages say noindex themselves.
      "Disallow: /app/",
      "Disallow: /admin/",
      "Disallow: /api/",
      "Disallow: /v1/",
      ...(config.publicBaseUrl ? ["", `Sitemap: ${config.publicBaseUrl}/sitemap.xml`] : []),
      "",
    ].join("\n"));
  });
  app.get("/sitemap.xml", (req: Request, res: Response) => {
    const base = baseUrlOf(req);
    const newest = articlesByDate()[0];
    const pages: Array<[string, string | null]> = [
      ["/", null], ["/blog", newest ? newest.updated ?? newest.published : null], ["/start", null], ["/terms", null], ["/pay", null],
      ...articlesByDate().map((article): [string, string] => [`/blog/${article.slug}`, article.updated ?? article.published]),
    ];
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(([path, modified]) => `  <url><loc>${base}${path}</loc>${modified ? `<lastmod>${modified}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`);
  });

  // ── The blog: guides that bring owners to the studio from search ──────
  app.get("/blog", (req: Request, res: Response) => {
    pageHeaders(res, { cache: true, index: true });
    res.type("html").send(renderBlogIndex(pageOf(req)));
  });
  app.get("/blog/feed.xml", (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("application/rss+xml").send(renderFeed(baseUrlOf(req)));
  });
  app.get("/blog/:slug", (req: Request, res: Response, next: NextFunction) => {
    const article = articleBySlug(String(req.params.slug));
    if (!article) return next();
    pageHeaders(res, { cache: true, index: true });
    res.type("html").send(renderArticle(pageOf(req), article));
  });

  // ── Starting something: a Zaina plan or a project ────────────────────
  const emptyRequest = (topic: string) => ({ name: "", business: "", phone: "", email: "", topic, details: "" });
  app.get("/start", (req: Request, res: Response) => {
    pageHeaders(res, { cache: false, index: true });
    res.type("html").send(renderStart(pageOf(req), { request: emptyRequest(requestTopic(req.query.service)?.id ?? ""), problems: {} }));
  });
  app.post("/start", form, async (req: Request, res: Response, next: NextFunction) => {
    try {
      pageHeaders(res, { cache: false, index: false });
      const { value, problems } = readRequest(req.body);
      // A field people can't see: only a script fills it in. Thanked, and nothing is saved.
      if (typeof req.body?.website === "string" && req.body.website.trim()) return res.redirect(303, "/start/thanks");
      if (Object.keys(problems).length) return res.status(400).type("html").send(renderStart(pageOf(req), { request: value, problems }));
      const verdict = await consumeLimits([{ key: `studio:request:${visitorKey(secret, req.ip)}`, limit: 5, windowSeconds: 3600 }]);
      if (!verdict.allowed) return res.status(429).type("html").send(renderStart(pageOf(req), { request: value, problems: {}, tooMany: true }));
      await saveRequest(value, config.studioNotifyEmail);
      res.redirect(303, `/start/thanks?service=${encodeURIComponent(value.topic)}`);
    } catch (error) {
      next(error);
    }
  });
  app.get("/start/thanks", (req: Request, res: Response) => {
    pageHeaders(res, { cache: false, index: false });
    res.type("html").send(renderStartThanks(pageOf(req), String(req.query.service ?? "")));
  });

  // ── Paying an invoice ────────────────────────────────────────────────
  const visitor = (req: Request) => visitorKey(secret, req.ip);
  /** Counts a visit against the limits; over them, the visitor is sent to /pay with a message. */
  async function within(res: Response, rules: LimitRule[]): Promise<boolean> {
    const verdict = await consumeLimits(rules);
    if (!verdict.allowed) res.redirect(303, "/pay?m=too_many");
    return verdict.allowed;
  }
  const messageOf = (req: Request) => (typeof req.query.m === "string" && req.query.m in PAY_MESSAGES ? req.query.m : null);
  const page = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      pageHeaders(res, { cache: false, index: false });
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };

  app.get("/pay", (req: Request, res: Response) => {
    // The page itself may be found in search; with a message in its address it is one visitor's.
    pageHeaders(res, { cache: false, index: Object.keys(req.query).length === 0 });
    res.type("html").send(renderPayHome(pageOf(req), {
      message: messageOf(req),
      reference: typeof req.query.ref === "string" ? req.query.ref.slice(0, 20) : "",
      testMode: studioPayTestMode(),
      available: studioPayAvailable(),
    }));
  });

  app.get("/pay/find", page(async (req, res) => {
    // Guessing references gets nowhere (a trillion of them), and is limited all the same.
    if (!(await within(res, [{ key: `studio:find:${visitor(req)}`, limit: 20, windowSeconds: 600 }]))) return;
    const typed = typeof req.query.ref === "string" ? req.query.ref : "";
    const reference = normalizeInvoiceReference(typed);
    const invoice = reference ? await studioInvoiceByReference(reference) : null;
    if (!invoice) return res.redirect(303, `/pay?m=not_found&ref=${encodeURIComponent(typed.slice(0, 20))}`);
    res.redirect(303, `/pay/${invoice.reference}`);
  }));

  app.get("/pay/verify", page(async (req, res) => {
    const reference = typeof req.query.reference === "string" ? req.query.reference : typeof req.query.trxref === "string" ? req.query.trxref : "";
    if (!STUDIO_PAYMENT_REFERENCE.test(reference)) return res.redirect(303, "/pay?m=not_found");
    if (!(await within(res, [{ key: `studio:verify:${visitor(req)}`, limit: 60, windowSeconds: 600 }]))) return;
    const invoice = await studioInvoiceOfPayment(reference);
    if (!invoice) return res.redirect(303, "/pay?m=not_found");
    const checkout = studioCheckout(baseUrlOf(req));
    const result = checkout ? await checkout.check(reference) : null;
    const settled = result ? await settleAndNotify(result) : null;
    res.redirect(303, `/pay/${invoice.reference}?m=${settled?.outcome ?? "pending"}`);
  }));

  app.get("/pay/:ref(BM-[A-Za-z2-9]{8})", page(async (req, res) => {
    const reference = normalizeInvoiceReference(String(req.params.ref));
    if (!(await within(res, [{ key: `studio:view:${visitor(req)}`, limit: 200, windowSeconds: 600 }]))) return;
    let invoice = reference ? await studioInvoiceByReference(reference) : null;
    if (!invoice) return res.redirect(303, "/pay?m=not_found");
    const message = messageOf(req);
    // Waiting on Paystack: ask again each time the page reloads itself.
    let waiting = false;
    if (invoice.status === "open" && message === "pending") {
      const checkout = studioCheckout(baseUrlOf(req));
      const latest = (await studioPaymentsOf(invoice.id)).find((payment) => payment.status === "pending" && Date.now() - payment.createdAt.getTime() < 30 * 60_000);
      if (checkout && latest) {
        const result = await checkout.check(latest.reference);
        const settled = result ? await settleAndNotify(result) : null;
        if (settled && settled.outcome !== "pending") return res.redirect(303, `/pay/${invoice.reference}?m=${settled.outcome}`);
        waiting = true;
      }
    }
    res.type("html").send(renderInvoicePage(pageOf(req), {
      invoice,
      message: message === "pending" && !waiting && invoice.status === "open" ? null : message,
      email: "",
      testMode: studioPayTestMode(),
      available: studioPayAvailable(),
      waiting,
    }));
  }));

  app.post("/pay/:ref(BM-[A-Za-z2-9]{8})/start", form, page(async (req, res) => {
    const reference = normalizeInvoiceReference(String(req.params.ref));
    const invoice = reference ? await studioInvoiceByReference(reference) : null;
    if (!invoice) return res.redirect(303, "/pay?m=not_found");
    const back = (code?: string) => res.redirect(303, `/pay/${invoice.reference}${code ? `?m=${code}` : ""}`);
    if (invoice.status !== "open") return back();
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return back("email");
    const checkout = studioCheckout(baseUrlOf(req));
    if (!checkout) return back("off");
    if (!(await within(res, [
      { key: `studio:start:${invoice.id}`, limit: 12, windowSeconds: 600 },
      { key: `studio:start:${visitor(req)}`, limit: 30, windowSeconds: 3600 },
    ]))) return;
    try {
      res.redirect(303, await startStudioPayment(checkout, invoice, email));
    } catch (error) {
      if (!(error instanceof StudioInvoiceError)) throw error;
      back(error.code === "provider_failed" ? "provider" : undefined);
    }
  }));

  // ── The studio's team ────────────────────────────────────────────────
  const staff = requireStaff(secret);
  const admin = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof StudioInvoiceError) return void res.status(error.status).json({ error: error.code, message: error.message });
      next(error);
    }
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  app.get("/v1/platform/studio-invoices", staff, requirePlatformAdmin, admin(async (req, res) => {
    const invoices = await listStudioInvoices();
    res.json({
      invoices: invoices.map((invoice) => invoiceJson(invoice, baseUrlOf(req))),
      categories: studioCategories.map((id) => ({ id, label: categoryLabels[id] })),
      online_payments: studioPayAvailable() ? (studioPayTestMode() ? "test" : "live") : "off",
      can_email: mailerConfigured(),
    });
  }));

  app.post("/v1/platform/studio-invoices", staff, requirePlatformAdmin, admin(async (req, res) => {
    const checked = validateNewInvoice(req.body);
    if (!checked.ok) return res.status(400).json({ error: "invalid_invoice", message: checked.message });
    const invoice = await createStudioInvoice(checked.value, staffOf(req).user.id);
    let emailed = false;
    if (req.body?.email_client === true && invoice.clientEmail) {
      const email = invoiceEmail({ ...invoice }) ?? null;
      const link = invoiceLink(invoice, baseUrlOf(req));
      // Without PUBLIC_BASE_URL the link is built from this request's own address.
      const message = email ?? (link ? { subject: `Invoice ${invoice.reference} (${formatMoney(invoice.amountMinor, invoice.currency)})`, text: `Pay securely by M-Pesa or card: ${link}` } : null);
      if (message) emailed = await sendEmail({ to: invoice.clientEmail, ...message });
    }
    res.status(201).json({ invoice: invoiceJson(invoice, baseUrlOf(req)), emailed });
  }));

  app.post("/v1/platform/studio-invoices/:id/paid", staff, requirePlatformAdmin, admin(async (req, res) => {
    if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: "not_found" });
    const invoice = await markStudioInvoicePaid(String(req.params.id), typeof req.body?.receipt === "string" ? req.body.receipt : "", staffOf(req).user.id);
    res.json({ invoice: invoiceJson(invoice, baseUrlOf(req)) });
  }));

  app.post("/v1/platform/studio-invoices/:id/void", staff, requirePlatformAdmin, admin(async (req, res) => {
    if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: "not_found" });
    const invoice = await voidStudioInvoice(String(req.params.id));
    res.json({ invoice: invoiceJson(invoice, baseUrlOf(req)) });
  }));
}

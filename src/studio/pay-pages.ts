// src/studio/pay-pages.ts
//
// bilamatata.co.ke/pay as HTML: finding an invoice by its reference, and the
// invoice's own page (what it's for, how much, and the button to Paystack).
// Plain pages and plain forms: they work without any script.

import { formatMoney, STUDIO, whatsappLink } from "./brand.ts";
import { categoryLabels, type StudioInvoice } from "./invoices.ts";
import { esc, siteParts, type SitePage } from "./pages.ts";

/** Messages a page can show, by the code in its address (?m=…). */
export const PAY_MESSAGES: Record<string, { tone: "ok" | "error" | "info"; text: string }> = {
  not_found: { tone: "error", text: "We couldn't find an invoice with that reference. Check it against your invoice (it looks like BM-7K2Q9XHD) and try again." },
  too_many: { tone: "error", text: "Too many tries from this connection. Please wait a few minutes and try again." },
  email: { tone: "error", text: "Please enter the email address your receipt should go to." },
  off: { tone: "error", text: "Online payment isn't available right now. Please contact us and we'll help you pay." },
  provider: { tone: "error", text: "Paystack couldn't start the payment just now. Please try again in a minute." },
  paid: { tone: "ok", text: "Payment received. Thank you! Your receipt is on its way to your email." },
  failed: { tone: "error", text: "That payment didn't go through and you haven't been charged for it. You can try again below." },
  pending: { tone: "info", text: "We're waiting for Paystack to confirm your payment. This page updates as soon as it does; you don't need to pay again." },
};

const helpLine = (reference?: string) => `<p class="help">Need help with a payment? WhatsApp or call <a href="${esc(whatsappLink(`Hello Bila Matata, I need help paying${reference ? ` invoice ${reference}` : " an invoice"}.`))}" rel="noopener">${esc(STUDIO.phoneDisplay)}</a> or email <a href="mailto:${esc(STUDIO.email)}">${esc(STUDIO.email)}</a>.</p>`;

const notice = (code: string | null) => {
  const message = code ? PAY_MESSAGES[code] : null;
  return message ? `<p class="notice ${message.tone}" role="${message.tone === "error" ? "alert" : "status"}">${esc(message.text)}</p>` : "";
};

const secureLine = `<p class="secure">${siteParts.ICONS.lock}<span>You pay on Paystack's secure page by M-Pesa or card. ${esc(STUDIO.name)} never sees your card number or M-Pesa PIN.</span></p>`;

function shell(page: SitePage, options: { title: string; path: string; index: boolean; body: string; refresh?: number }): string {
  return `${siteParts.head({
    title: options.title,
    description: "Pay a Bila Matata invoice securely by M-Pesa or card.",
    path: options.path,
    baseUrl: page.baseUrl,
    index: options.index,
    extra: options.refresh ? `<meta http-equiv="refresh" content="${options.refresh}">` : "",
  })}
<body>
${siteParts.header("pay")}
<main id="main" class="pay">
  <div class="wrap">
${options.body}
  </div>
</main>
${siteParts.footer()}
<script src="/site/site.js" defer></script>
</body>
</html>`;
}

/** /pay: find an invoice by its reference. */
export function renderPayHome(page: SitePage, options: { message: string | null; reference: string; testMode: boolean; available: boolean }): string {
  return shell(page, {
    title: "Pay an Invoice | Bila Matata",
    path: "/pay",
    index: true,
    body: `    <h1>Pay an invoice</h1>
    <p class="lede">Pay for your ${esc(STUDIO.name)} project or Zaina AI set-up securely by M-Pesa or card.</p>
    ${options.testMode ? '<p class="notice test">Test mode: payments here use Paystack\'s test cards and no money moves.</p>' : ""}
    ${options.available ? "" : notice("off")}
    ${notice(options.message)}
    <form class="panel" method="get" action="/pay/find">
      <h2>Find your invoice</h2>
      <div class="field">
        <label for="ref">Invoice reference</label>
        <input id="ref" name="ref" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" required maxlength="20" placeholder="BM-7K2Q9XHD" value="${esc(options.reference)}">
        <span class="hint">It's on the invoice we sent you, and starts with BM-.</span>
      </div>
      <button class="btn btn-primary" type="submit">Find invoice</button>
      ${secureLine}
    </form>
    <section class="panel" aria-labelledby="sub-title">
      <h2 id="sub-title">Paying your Zaina AI monthly plan?</h2>
      <p class="help">Monthly plan invoices are in your dashboard: <a href="/app/">sign in</a>, then open Settings → Plan &amp; billing to see and pay them.</p>
    </section>
    <section class="panel" aria-labelledby="what-title">
      <h2 id="what-title">What you can pay here</h2>
      <p class="help">Invoices from ${esc(STUDIO.name)} for website and app development, AI automation, data analysis, research and writing, and Zaina AI set-up. Deposits, balances and refunds are explained in our <a href="/terms#payments">terms</a>.</p>
    </section>
    ${helpLine()}`,
  });
}

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" });

/** /pay/BM-…: one invoice. */
export function renderInvoicePage(page: SitePage, options: { invoice: StudioInvoice; message: string | null; email: string; testMode: boolean; available: boolean; waiting: boolean }): string {
  const { invoice } = options;
  const amount = formatMoney(invoice.amountMinor, invoice.currency);
  const badge = invoice.status === "paid" ? '<span class="badge paid">Paid</span>' : invoice.status === "void" ? '<span class="badge void">Cancelled</span>' : '<span class="badge open">Awaiting payment</span>';
  const facts = [
    ["Invoice", invoice.reference],
    ["For", invoice.clientName],
    ["Service", categoryLabels[invoice.category]],
    ["Details", invoice.description],
    ...(invoice.status === "open" && invoice.dueAt ? [["Due", DATE.format(invoice.dueAt)]] : []),
    ...(invoice.status === "paid" && invoice.paidAt ? [["Paid on", DATE.format(invoice.paidAt)]] : []),
    ...(invoice.status === "paid" && invoice.receipt ? [["Receipt", invoice.receipt]] : []),
  ];
  let action: string;
  if (invoice.status === "paid") {
    action = '<p class="notice ok">This invoice is paid in full. Thank you.</p>';
  } else if (invoice.status === "void") {
    action = '<p class="notice info">This invoice was cancelled: there is nothing to pay. If you think that\'s a mistake, please contact us.</p>';
  } else if (!options.available) {
    action = "";
  } else {
    action = `<form method="post" action="/pay/${esc(invoice.reference)}/start">
        <div class="field">
          <label for="email">Email for your receipt</label>
          <input id="email" name="email" type="email" autocomplete="email" required maxlength="200" placeholder="you@example.com" value="${esc(options.email)}">
        </div>
        <button class="btn btn-primary" type="submit">${options.waiting ? "Continue to Paystack" : `Pay ${esc(amount)}`}</button>
        ${secureLine}
      </form>`;
  }
  return shell(page, {
    title: `Invoice ${invoice.reference} | Bila Matata`,
    path: `/pay/${invoice.reference}`,
    index: false,
    // While Paystack hasn't confirmed, the page asks again by itself.
    refresh: options.waiting && invoice.status === "open" ? 8 : undefined,
    body: `    <h1>Invoice ${esc(invoice.reference)}</h1>
    ${options.testMode ? '<p class="notice test">Test mode: use Paystack\'s test cards; no money moves.</p>' : ""}
    ${invoice.status === "open" && !options.available ? notice("off") : ""}
    ${notice(invoice.status === "paid" && options.message !== "paid" ? null : options.message)}
    <section class="panel" aria-label="Invoice">
      ${badge}
      <p class="amount">${esc(amount)}</p>
      <dl class="facts">
        ${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("\n        ")}
      </dl>
      ${action}
    </section>
    ${helpLine(invoice.reference)}`,
  });
}

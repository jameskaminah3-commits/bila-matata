// src/orders/page.ts
//
// The page an order's link opens (/pay/o/<token>): what was ordered, line by
// line with the delivery fee, where the order stands, and the ways to pay the
// business takes, into its own accounts. Server-rendered HTML with no
// scripts, styled like a booking's payment page; while a payment prompt
// waits on the customer's phone, the page reloads itself.

import type { Order, Payment } from "../db/schema.ts";
import { holdUntil } from "../booking/notices.ts";
import { formatMoney } from "../booking/money.ts";
import { onlineWays, type PaymentOptions } from "../booking/settings.ts";
import { PAGE_MESSAGES } from "../payments/page.ts";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** The booking page's messages, in an order's words where they differ. */
export const ORDER_MESSAGES: Record<string, { kind: "error" | "info" | "ok"; text: string }> = {
  ...PAGE_MESSAGES,
  not_available: { kind: "error", text: "That way of paying isn't available for this order." },
  wrong_status: { kind: "error", text: "This order can't be paid now." },
  nothing_due: { kind: "info", text: "There's nothing to pay on this order now." },
  code_used: { kind: "error", text: "That M-Pesa code was already used. Please check it." },
};

export type OrderPageView = {
  businessName: string;
  brand?: { cssUrl: string; logoUrl: string | null };
  order: Order;
  options: PaymentOptions;
  due: number;
  pending: Payment | null;
  lastFailure: Payment | null;
  message: string | null;
  collectionPoint: string | null;
  contactLine: string;
  timeZone: string;
  now: Date;
  host: string;
  token: string;
};

function statusNotice(view: OrderPageView): { kind: "info" | "warn" | "ok" | "error"; lines: string[] } {
  const { order, businessName } = view;
  const holding = order.holdExpiresAt !== null && order.holdExpiresAt > view.now;
  const until = order.holdExpiresAt ? holdUntil(order.holdExpiresAt, view.timeZone) : "";
  const where = order.fulfilment === "delivery" ? `We'll deliver to ${order.zone}.` : `Collect it${view.collectionPoint ? ` at ${view.collectionPoint}` : ""}.`;
  switch (order.status) {
    case "awaiting_payment":
      return holding
        ? { kind: "info", lines: [`Your items are kept for you until ${until}.`, "Pay to confirm your order."] }
        : { kind: "warn", lines: ["The time to pay has passed, so your items aren't kept any more.", "If they're still in stock, you can pay now."] };
    case "expired":
      return { kind: "warn", lines: ["The time to pay has passed, so your items aren't kept any more.", "If they're still in stock, you can pay now."] };
    case "requested":
      return { kind: "info", lines: [`Your order is with ${businessName}.`, "They'll confirm it in your chat, and by email if you gave one."] };
    case "confirmed":
      return order.conflict
        ? { kind: "warn", lines: ["We've received your payment.", `The team at ${businessName} will contact you shortly about your order.`] }
        : { kind: "ok", lines: ["Your order is confirmed.", where] };
    case "out_for_delivery":
      return { kind: "ok", lines: ["Your order is on its way."] };
    case "ready_for_collection":
      return { kind: "ok", lines: [`Your order is ready to collect${view.collectionPoint ? ` at ${view.collectionPoint}` : ""}.`] };
    case "completed":
      return { kind: "ok", lines: [`Thank you for ordering from ${businessName}.`] };
    case "cancelled":
      return { kind: "error", lines: [`This order was cancelled${order.cancelReason ? `: ${order.cancelReason}` : ""}.`] };
  }
}

function pendingNotice(view: OrderPageView): string {
  const payment = view.pending;
  if (!payment) return "";
  const amount = escapeHtml(formatMoney(payment.amountMinor, payment.currency));
  if (payment.method === "mpesa_express") return `<section class="notice info" role="status"><p><strong>Check your phone.</strong> Enter your M-Pesa PIN to pay ${amount}.</p><p>This page updates by itself.</p></section>`;
  if (payment.method === "mpesa_code") return `<section class="notice info" role="status"><p>We've got your M-Pesa code <strong>${escapeHtml(payment.providerReference ?? "")}</strong> for ${amount}.</p><p>The team is checking it and will confirm your order. Your items stay kept meanwhile.</p></section>`;
  return `<section class="notice info" role="status"><p>Your payment of ${amount} is being confirmed.</p><p>This page updates by itself.</p></section>`;
}

function lines(view: OrderPageView): string {
  const { order } = view;
  const money = (minor: number) => escapeHtml(formatMoney(minor, order.currency));
  const rows = order.lines.map((line) => `<tr><th scope="row">${line.quantity} × ${escapeHtml(line.name)}<span class="each">${escapeHtml(line.priceText)}</span></th><td>${line.lineTotalMinor === null ? "" : money(line.lineTotalMinor)}</td></tr>`);
  if (order.fulfilment === "delivery") rows.push(`<tr class="sub"><th scope="row">Delivery to ${escapeHtml(order.zone ?? "")}</th><td>${order.deliveryFeeMinor ? money(order.deliveryFeeMinor) : "Free"}</td></tr>`);
  const toConfirm = order.pricedByTeam && order.status === "requested";
  rows.push(`<tr class="total"><th scope="row">Total</th><td>${toConfirm ? "To be confirmed" : money(order.totalMinor)}</td></tr>`);
  if (order.paidMinor > 0) rows.push(`<tr class="sub"><th scope="row">Paid</th><td>${money(order.paidMinor)}</td></tr>`);
  if (order.payOnDelivery && view.due > 0) rows.push(`<tr class="sub"><th scope="row">To pay on ${order.fulfilment === "delivery" ? "delivery" : "collection"}</th><td>${money(view.due)}</td></tr>`);
  return `<table class="lines"><tbody>${rows.join("")}</tbody></table>`;
}

function payOptions(view: OrderPageView): string {
  const { order, options, due } = view;
  if (due <= 0 || view.pending) return "";
  const amount = escapeHtml(formatMoney(due, order.currency));
  const action = (path: string) => `/pay/o/${encodeURIComponent(view.token)}/${path}`;
  const methods: string[] = [];
  const ways = onlineWays(options, due);
  for (const way of ways) {
    if (way === "paystack") {
      methods.push(`<div class="method"><form method="post" action="${action("paystack")}">
${order.customerEmail ? "" : '<label>Email for your receipt<input name="email" type="email" autocomplete="email" required maxlength="200"></label>'}
<button type="submit">Pay ${amount} by card${order.currency === "KES" ? " or M-Pesa" : ""}</button>
<p class="hint">On a secure payment page.</p></form></div>`);
    } else if (way === "mpesa_express" && order.currency === "KES") {
      methods.push(`<div class="method"><form method="post" action="${action("mpesa")}">
<label>M-Pesa number<span>We'll send a payment prompt to this phone.</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20" value="${escapeHtml(order.customerPhone ?? "")}"></label>
<button type="submit"${ways[0] !== "mpesa_express" ? ' class="secondary"' : ""}>Send the M-Pesa prompt for ${amount}</button></form></div>`);
    } else if (way === "mpesa_manual" && options.mpesaManual && order.currency === "KES") {
      const manual = options.mpesaManual;
      const steps = manual.type === "paybill"
        ? ["M-Pesa → Lipa na M-Pesa → Pay Bill.", `Business number <strong>${escapeHtml(manual.number)}</strong>, account <strong>${escapeHtml(manual.account ?? order.reference)}</strong>.`, `Amount <strong>${amount}</strong>.`]
        : ["M-Pesa → Lipa na M-Pesa → Buy Goods and Services.", `Till number <strong>${escapeHtml(manual.number)}</strong>.`, `Amount <strong>${amount}</strong>.`];
      methods.push(`<div class="method"><h3>${methods.length ? "Or pay with M-Pesa yourself" : "Pay with M-Pesa"}</h3>
<ol class="steps">${steps.map((step) => `<li>${step}</li>`).join("")}</ol>
<form method="post" action="${action("mpesa-code")}"><label>M-Pesa confirmation code<span>From the M-Pesa message, like QK12ABC34D.</span><input name="code" required maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
<button type="submit" class="secondary">Send the code</button></form></div>`);
    }
  }
  if (!methods.length) {
    return order.payOnDelivery ? "" : `<section class="card"><h2>Paying</h2><p>The team will tell you how to pay. Questions? ${escapeHtml(view.contactLine)}.</p></section>`;
  }
  const heading = order.payOnDelivery ? `Pay now if you like: ${amount}` : `Pay ${amount} to confirm your order`;
  return `<section class="card"><h2>${heading}</h2>${order.payOnDelivery ? `<p class="small">Or pay on ${order.fulfilment === "delivery" ? "delivery" : "collection"}, as you chose.</p>` : ""}${methods.join("")}</section>`;
}

export function renderOrderPage(view: OrderPageView): string {
  const { order } = view;
  const message = view.message ? ORDER_MESSAGES[view.message] : null;
  const waiting = view.pending !== null && view.pending.method !== "mpesa_code";
  const failure = view.lastFailure && !view.pending && order.status !== "confirmed"
    ? `<section class="notice error" role="alert"><p>Your last payment didn't go through${view.lastFailure.failure ? `: ${escapeHtml(view.lastFailure.failure)}` : ""}.</p><p>You can try again below.</p></section>`
    : "";
  const status = statusNotice(view);
  const facts = [
    order.fulfilment === "delivery"
      ? `<div><dt>Delivery</dt><dd>${escapeHtml([order.address, order.zone].filter(Boolean).join(", "))}</dd></div>`
      : `<div><dt>Collection</dt><dd>${escapeHtml(view.collectionPoint ?? "From the business")}</dd></div>`,
    order.wanted ? `<div><dt>When</dt><dd>${escapeHtml(order.wanted)}</dd></div>` : "",
    `<div><dt>Name</dt><dd>${escapeHtml(order.customerName)}</dd></div>`,
  ].join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${waiting ? '<meta http-equiv="refresh" content="4">' : ""}
<title>Order ${escapeHtml(order.reference)} · ${escapeHtml(view.businessName)}</title>
<link rel="stylesheet" href="/pay-assets/pay.css">
${view.brand ? `<link rel="stylesheet" href="${escapeHtml(view.brand.cssUrl)}">` : ""}
<link rel="icon" href="data:,">
</head>
<body>
<main class="pay">
<header${view.brand?.logoUrl ? ' class="with-logo"' : ""}>
${view.brand?.logoUrl ? `<img class="logo" src="${escapeHtml(view.brand.logoUrl)}" alt="" width="56" height="56">` : ""}
<div>
<p class="business">${escapeHtml(view.businessName)}</p>
<h1>Your order</h1>
<p class="ref">Reference <strong>${escapeHtml(order.reference)}</strong></p>
</div>
</header>
${message ? `<section class="notice ${message.kind}" role="${message.kind === "error" ? "alert" : "status"}"><p>${escapeHtml(message.text)}</p></section>` : ""}
${pendingNotice(view)}
${failure}
<section class="notice ${status.kind}">${status.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</section>
<section class="card">
<h2>What you ordered</h2>
${lines(view)}
<dl class="facts">
${facts}
</dl>
</section>
${payOptions(view)}
<section class="card">
<h2>Good to know</h2>
<p>You'll hear in your chat${order.customerEmail ? " and by email" : ""} when your order is ${order.fulfilment === "delivery" ? "on its way" : "ready to collect"}.</p>
<p>Questions? ${escapeHtml(view.contactLine)}.</p>
</section>
<footer>
<p>Always check the address bar starts with ${escapeHtml(view.host)} before you pay.</p>
${view.options.paystack ? "<p>Card details are entered on the secure payment page, never here.</p>" : ""}
</footer>
</main>
</body>
</html>`;
}

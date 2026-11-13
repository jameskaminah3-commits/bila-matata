// src/studio/pay.ts
//
// The studio's own Paystack account at work: the checkout for /pay, what
// happens when a payment settles (receipt to the payer, a note to the
// studio), and the two ways a payment is heard about besides the payer
// coming back: Paystack's webhook and the sweep.
//
// The account is the platform's (PLATFORM_PAYSTACK_SECRET_KEY): the same one
// Zaina's monthly plans are paid into, because both are Bila Matata's own
// sales. A business that takes payments through Zaina uses its own account
// (its own keys), never this one.

import { createCheckout, type ChargeResult, type Checkout } from "../checkout/index.ts";
import type { VerifiedTransaction } from "../payments/paystack.ts";
import { sendEmail } from "../platform/mailer.ts";
import { formatMoney, STUDIO } from "./brand.ts";
import { categoryLabels, settleStudioPayment, sweepStudioPayments, type SettledPayment, type StudioInvoice } from "./invoices.ts";

type StudioPayConfig = { paystackKey: string | null; publicBaseUrl: string | null; notifyEmail: string | null };
let config: StudioPayConfig = { paystackKey: null, publicBaseUrl: null, notifyEmail: null };

export function configureStudioPay(next: StudioPayConfig) {
  config = next;
}

/** Whether /pay can take payments: the studio's Paystack key is set. */
export const studioPayAvailable = () => config.paystackKey !== null;

/** True while the key is a test key: nothing is charged. */
export const studioPayTestMode = () => config.paystackKey?.startsWith("sk_test_") ?? false;

/**
 * The studio's checkout. `baseUrl` is the site's own address (the payer comes
 * back to /pay/verify on it); null when there is no key, or no address.
 */
export function studioCheckout(baseUrl: string | null = config.publicBaseUrl): Checkout | null {
  if (!config.paystackKey || !baseUrl) return null;
  return createCheckout({ secretKey: config.paystackKey, returnUrl: `${baseUrl}/pay/verify` });
}

/** Where a client pays an invoice. */
export function invoiceLink(invoice: Pick<StudioInvoice, "reference">, baseUrl: string | null = config.publicBaseUrl): string | null {
  return baseUrl ? `${baseUrl}/pay/${invoice.reference}` : null;
}

const DATE = new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi" });

export function receiptEmail(invoice: StudioInvoice): { subject: string; text: string } {
  const amount = formatMoney(invoice.amountMinor, invoice.currency);
  const link = invoiceLink(invoice);
  return {
    subject: `Receipt: invoice ${invoice.reference} paid (${amount})`,
    text: [
      `Thank you. We've received your payment of ${amount}.`,
      "",
      `Invoice: ${invoice.reference}`,
      `For: ${invoice.clientName}`,
      `Service: ${categoryLabels[invoice.category]}`,
      `Details: ${invoice.description}`,
      `Paid on: ${DATE.format(invoice.paidAt ?? new Date())}`,
      ...(invoice.receipt ? [`Payment reference: ${invoice.receipt}`] : []),
      ...(link ? ["", `Your invoice: ${link}`] : []),
      "",
      `${STUDIO.name}, ${STUDIO.city}`,
      `WhatsApp or call ${STUDIO.phoneDisplay} · ${STUDIO.email}`,
    ].join("\n"),
  };
}

export function invoiceEmail(invoice: StudioInvoice): { subject: string; text: string } | null {
  const link = invoiceLink(invoice);
  if (!link) return null;
  const amount = formatMoney(invoice.amountMinor, invoice.currency);
  return {
    subject: `Invoice ${invoice.reference} from ${STUDIO.name} (${amount})`,
    text: [
      `Hello ${invoice.clientName},`,
      "",
      `Here is your invoice from ${STUDIO.name}.`,
      "",
      `Invoice: ${invoice.reference}`,
      `Service: ${categoryLabels[invoice.category]}`,
      `Details: ${invoice.description}`,
      `Amount: ${amount}`,
      ...(invoice.dueAt ? [`Due: ${DATE.format(invoice.dueAt)}`] : []),
      "",
      `Pay securely by M-Pesa or card: ${link}`,
      "",
      `Questions? WhatsApp or call ${STUDIO.phoneDisplay}, or reply to ${STUDIO.email}.`,
      "",
      `${STUDIO.name}, ${STUDIO.city}`,
    ].join("\n"),
  };
}

/** After a payment settles: the receipt goes out once, when the invoice was just paid. */
export async function afterStudioPayment(settled: SettledPayment): Promise<void> {
  if (!settled.justPaid) return;
  const { invoice } = settled;
  console.log(`[studio] invoice ${invoice.reference} paid (${formatMoney(invoice.amountMinor, invoice.currency)})`);
  const receipt = receiptEmail(invoice);
  const recipients = new Set([settled.payerEmail, invoice.clientEmail].filter((email): email is string => Boolean(email)));
  for (const to of recipients) await sendEmail({ to, ...receipt });
  if (config.notifyEmail) {
    await sendEmail({
      to: config.notifyEmail,
      subject: `Paid: ${invoice.reference} · ${invoice.clientName} · ${formatMoney(invoice.amountMinor, invoice.currency)}`,
      text: `${invoice.clientName} paid invoice ${invoice.reference} (${categoryLabels[invoice.category]}: ${invoice.description}) on Paystack.${invoice.receipt ? ` Paystack receipt: ${invoice.receipt}.` : ""}`,
    });
  }
}

/** Applies what Paystack says about one of the studio's payments, then sends what follows. */
export async function settleAndNotify(result: ChargeResult): Promise<SettledPayment | null> {
  const settled = await settleStudioPayment(result);
  if (settled) await afterStudioPayment(settled).catch((error) => console.error("[studio] receipt failed:", error));
  return settled;
}

/** A charge from Paystack's webhook (already checked against the account's signature). */
export async function applyStudioCharge(transaction: VerifiedTransaction): Promise<void> {
  await settleAndNotify({
    status: transaction.status,
    reference: transaction.reference,
    amountMinor: transaction.amountMinor,
    currency: transaction.currency,
    transactionId: transaction.id,
    channel: transaction.channel,
    message: transaction.message,
  });
}

/** Payments left under way: ask Paystack (a webhook may have gone astray). */
export async function sweepStudio(): Promise<number> {
  const checkout = studioCheckout(config.publicBaseUrl ?? "http://localhost");
  if (!checkout) return 0;
  return sweepStudioPayments(checkout, afterStudioPayment);
}

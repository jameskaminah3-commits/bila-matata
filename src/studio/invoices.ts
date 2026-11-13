// src/studio/invoices.ts
//
// The studio's own invoices (migration 0016): project work and Zaina set-up
// fees, paid on /pay through the studio's Paystack account, or by hand and
// recorded by the studio. Only the owner connection touches these tables.
//
// Paying: a client opens their invoice by its reference (BM- and 8
// characters they can't guess), gives an email for the receipt and goes to
// Paystack's page. The payment settles when they come back, on Paystack's
// signed webhook, or when the sweep asks, whichever is first; it settles
// once, only for the amount asked, and a payment for an invoice that's
// already paid is kept for a refund rather than lost.

import { randomBytes, randomInt } from "node:crypto";
import type pg from "pg";
import { outcomeOf, type ChargeOutcome, type ChargeResult, type Checkout } from "../checkout/index.ts";
import { ownerPool } from "../db/platform-db.ts";

export const STUDIO_INVOICE_REFERENCE = /^BM-[A-Z2-9]{8}$/;
export const STUDIO_PAYMENT_REFERENCE = /^bm_[0-9a-f]{24}$/;
export const studioCategories = ["zaina_setup", "software", "automation", "data", "research", "other"] as const;
export type StudioCategory = (typeof studioCategories)[number];
export const categoryLabels: Record<StudioCategory, string> = {
  zaina_setup: "Zaina AI set-up",
  software: "Website and app development",
  automation: "AI automation and workflows",
  data: "Data analysis and dashboards",
  research: "Research and writing",
  other: "Studio services",
};

export type StudioInvoice = {
  id: string;
  reference: string;
  clientName: string;
  clientEmail: string | null;
  description: string;
  category: StudioCategory;
  amountMinor: number;
  currency: "KES" | "USD";
  status: "open" | "paid" | "void";
  dueAt: Date | null;
  paidAt: Date | null;
  method: "paystack" | "manual" | null;
  receipt: string | null;
  notes: string | null;
  createdAt: Date;
  voidedAt: Date | null;
};

export type StudioPayment = {
  id: string;
  invoiceId: string;
  reference: string;
  amountMinor: number;
  currency: "KES" | "USD";
  status: "pending" | "succeeded" | "failed";
  payerEmail: string | null;
  authorizationUrl: string | null;
  receipt: string | null;
  note: string | null;
  createdAt: Date;
  settledAt: Date | null;
};

export class StudioInvoiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const INVOICE_COLUMNS = `id, reference, client_name as "clientName", client_email as "clientEmail", description, category,
  amount_minor::float8 as "amountMinor", currency, status, due_at as "dueAt", paid_at as "paidAt", method, receipt, notes,
  created_at as "createdAt", voided_at as "voidedAt"`;
const PAYMENT_COLUMNS = `id, invoice_id as "invoiceId", reference, amount_minor::float8 as "amountMinor", currency, status,
  payer_email as "payerEmail", authorization_url as "authorizationUrl", receipt, note, created_at as "createdAt", settled_at as "settledAt"`;

// No I, O, 0 or 1: a reference read over the phone is typed right first time.
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newInvoiceReference(): string {
  return `BM-${Array.from({ length: 8 }, () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]).join("")}`;
}

/** What someone typed or pasted, as a reference: "bm 7k2q9xhd" → "BM-7K2Q9XHD". Null when it can't be one. */
export function normalizeInvoiceReference(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const letters = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^BM/, "");
  const reference = `BM-${letters}`;
  return STUDIO_INVOICE_REFERENCE.test(reference) ? reference : null;
}

export type NewStudioInvoice = {
  clientName: string;
  clientEmail: string | null;
  description: string;
  category: StudioCategory;
  amountMinor: number;
  currency: "KES" | "USD";
  dueAt: Date | null;
  notes: string | null;
};

/** Checks what the studio typed for a new invoice. */
export function validateNewInvoice(body: any): { ok: true; value: NewStudioInvoice } | { ok: false; message: string } {
  const text = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");
  const clientName = text(body?.client_name);
  const clientEmail = text(body?.client_email).toLowerCase() || null;
  const description = text(body?.description);
  const category = body?.category as StudioCategory;
  const currency = body?.currency ?? "KES";
  const amount = Number(body?.amount);
  if (clientName.length < 1 || clientName.length > 120) return { ok: false, message: "Who is the invoice for? (up to 120 characters)" };
  if (clientEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) return { ok: false, message: "That email address doesn't look right." };
  if (description.length < 3 || description.length > 300) return { ok: false, message: "Say what the invoice is for, in 3 to 300 characters." };
  if (!studioCategories.includes(category)) return { ok: false, message: `The category is one of ${studioCategories.join(", ")}.` };
  if (currency !== "KES" && currency !== "USD") return { ok: false, message: "The currency is KES or USD." };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return { ok: false, message: "The amount is a number above zero." };
  const amountMinor = Math.round(amount * 100);
  let dueAt: Date | null = null;
  if (body?.due_on) {
    dueAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.due_on)) ? new Date(`${body.due_on}T23:59:59+03:00`) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) return { ok: false, message: "The due date is a day, like 2026-12-01." };
  }
  const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null;
  return { ok: true, value: { clientName, clientEmail, description, category, amountMinor, currency, dueAt, notes } };
}

export async function createStudioInvoice(input: NewStudioInvoice, createdBy: string | null): Promise<StudioInvoice> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const { rows } = await ownerPool().query<StudioInvoice>(
        `insert into studio_invoices (reference, client_name, client_email, description, category, amount_minor, currency, due_at, notes, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${INVOICE_COLUMNS}`,
        [newInvoiceReference(), input.clientName, input.clientEmail, input.description, input.category, input.amountMinor, input.currency, input.dueAt, input.notes, createdBy],
      );
      return rows[0];
    } catch (error) {
      // The reference is taken (one in a trillion): try another.
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  throw new Error("Couldn't find a free invoice reference");
}

export async function studioInvoiceByReference(reference: string): Promise<StudioInvoice | null> {
  if (!STUDIO_INVOICE_REFERENCE.test(reference)) return null;
  const { rows } = await ownerPool().query<StudioInvoice>(`select ${INVOICE_COLUMNS} from studio_invoices where reference = $1`, [reference]);
  return rows[0] ?? null;
}

export async function listStudioInvoices(): Promise<Array<StudioInvoice & { attention: string | null }>> {
  const { rows } = await ownerPool().query<StudioInvoice & { attention: string | null }>(
    `select ${INVOICE_COLUMNS},
       (select p.note from studio_invoice_payments p where p.invoice_id = studio_invoices.id and p.note is not null and p.status <> 'failed'
        order by p.created_at desc limit 1) as attention
     from studio_invoices order by created_at desc limit 500`,
  );
  return rows;
}

export async function studioPaymentsOf(invoiceId: string): Promise<StudioPayment[]> {
  const { rows } = await ownerPool().query<StudioPayment>(`select ${PAYMENT_COLUMNS} from studio_invoice_payments where invoice_id = $1 order by created_at desc`, [invoiceId]);
  return rows;
}

/** Runs work in one transaction on the owner connection. */
async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await ownerPool().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Records a payment made by hand (bank or M-Pesa to the studio), with its receipt. */
export async function markStudioInvoicePaid(id: string, receipt: string, recordedBy: string): Promise<StudioInvoice> {
  const trimmed = receipt.trim().slice(0, 120);
  if (trimmed.length < 3) throw new StudioInvoiceError(400, "receipt_required", "Give the payment's receipt or M-Pesa code, so it can be found later.");
  return inTransaction(async (client) => {
    const { rows: [invoice] } = await client.query<StudioInvoice>(`select ${INVOICE_COLUMNS} from studio_invoices where id = $1 for update`, [id]);
    if (!invoice) throw new StudioInvoiceError(404, "not_found", "That invoice wasn't found.");
    if (invoice.status !== "open") throw new StudioInvoiceError(409, "not_open", `That invoice is ${invoice.status} already.`);
    const { rows } = await client.query<StudioInvoice>(
      `update studio_invoices set status = 'paid', paid_at = now(), method = 'manual', receipt = $2, recorded_by = $3 where id = $1 returning ${INVOICE_COLUMNS}`,
      [id, trimmed, recordedBy],
    );
    return rows[0];
  });
}

/** Voids an open invoice: its link then says there's nothing to pay. */
export async function voidStudioInvoice(id: string): Promise<StudioInvoice> {
  return inTransaction(async (client) => {
    const { rows: [invoice] } = await client.query<StudioInvoice>(`select ${INVOICE_COLUMNS} from studio_invoices where id = $1 for update`, [id]);
    if (!invoice) throw new StudioInvoiceError(404, "not_found", "That invoice wasn't found.");
    if (invoice.status !== "open") throw new StudioInvoiceError(409, "not_open", `That invoice is ${invoice.status} already.`);
    const { rows } = await client.query<StudioInvoice>(`update studio_invoices set status = 'void', voided_at = now() where id = $1 returning ${INVOICE_COLUMNS}`, [id]);
    return rows[0];
  });
}

/** A Paystack page started this recently is reused: one payment, however many clicks or tabs. */
const REUSE_PAGE_MS = 30 * 60_000;
/** How old a payment under way is before the sweep asks Paystack (PAYMENT_CHECK_AFTER_MS: tests). */
const ASK_AFTER_MS = Number(process.env.PAYMENT_CHECK_AFTER_MS ?? "") || 45_000;
/** A payment not finished in this long has failed. */
const GIVE_UP_MS = 2 * 60 * 60_000;

/** Starts paying an open invoice: the address of Paystack's page to send the payer to. */
export async function startStudioPayment(checkout: Checkout, invoice: StudioInvoice, payerEmail: string, now = new Date()): Promise<string> {
  if (invoice.status !== "open") throw new StudioInvoiceError(409, "not_open", invoice.status === "paid" ? "That invoice is paid already." : "That invoice was cancelled: there's nothing to pay.");
  const { rows: [recent] } = await ownerPool().query<StudioPayment>(
    `select ${PAYMENT_COLUMNS} from studio_invoice_payments
     where invoice_id = $1 and status = 'pending' and authorization_url is not null and payer_email = $2 and created_at > $3
     order by created_at desc limit 1`,
    [invoice.id, payerEmail, new Date(now.getTime() - REUSE_PAGE_MS)],
  );
  if (recent?.authorizationUrl) return recent.authorizationUrl;

  const reference = `bm_${randomBytes(12).toString("hex")}`;
  await ownerPool().query(
    "insert into studio_invoice_payments (invoice_id, reference, amount_minor, currency, payer_email) values ($1, $2, $3, $4, $5)",
    [invoice.id, reference, invoice.amountMinor, invoice.currency, payerEmail],
  );
  const started = await checkout.start({
    reference,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    payerEmail,
    invoiceNumber: invoice.reference,
    description: `${categoryLabels[invoice.category]}: ${invoice.description}`.slice(0, 200),
  });
  if (!started.ok) {
    await ownerPool().query("update studio_invoice_payments set status = 'failed', note = $2, settled_at = now() where reference = $1", [reference, started.message.slice(0, 300)]);
    console.warn(`[studio] Paystack checkout for ${invoice.reference} failed: ${started.message}`);
    throw new StudioInvoiceError(502, "provider_failed", "Paystack couldn't start the payment just now. Please try again in a minute.");
  }
  await ownerPool().query("update studio_invoice_payments set authorization_url = $2 where reference = $1", [reference, started.url]);
  return started.url;
}

/** `payerEmail` is where the payer asked for their receipt. */
export type SettledPayment = { outcome: ChargeOutcome; invoice: StudioInvoice; justPaid: boolean; payerEmail: string | null };

/**
 * Applies what Paystack says about a payment. Settles once: a second report
 * of the same payment changes nothing. `justPaid` is true only for the report
 * that marked the invoice paid (so its receipt is emailed once).
 */
export async function settleStudioPayment(result: ChargeResult, now = new Date()): Promise<SettledPayment | null> {
  if (!STUDIO_PAYMENT_REFERENCE.test(result.reference)) return null;
  return inTransaction(async (client) => {
    const { rows: [payment] } = await client.query<StudioPayment>(`select ${PAYMENT_COLUMNS} from studio_invoice_payments where reference = $1 for update`, [result.reference]);
    if (!payment) return null;
    const { rows: [invoice] } = await client.query<StudioInvoice>(`select ${INVOICE_COLUMNS} from studio_invoices where id = $1 for update`, [payment.invoiceId]);
    const done = (outcome: ChargeOutcome, current: StudioInvoice, justPaid = false): SettledPayment => ({ outcome, invoice: current, justPaid, payerEmail: payment.payerEmail });
    if (payment.status !== "pending") return done(payment.status === "succeeded" ? "paid" : "failed", invoice);

    const settle = (status: "succeeded" | "failed", receipt: string | null, note: string | null) =>
      client.query("update studio_invoice_payments set status = $2, receipt = $3, note = $4, settled_at = $5 where id = $1", [payment.id, status, receipt, note, now]);
    const { outcome, mismatch } = outcomeOf(result, payment);
    if (mismatch) {
      console.error(`[studio] Paystack paid ${result.amountMinor} ${result.currency} on ${payment.reference}, asked ${payment.amountMinor} ${payment.currency}`);
      await settle("failed", result.transactionId, `Paystack reported ${result.amountMinor / 100} ${result.currency}, not the amount asked: check it in Paystack.`);
      return done("failed", invoice);
    }
    if (outcome === "paid") {
      if (invoice.status !== "open") {
        console.error(`[studio] ${payment.reference} paid invoice ${invoice.reference}, which is ${invoice.status} already: refund it in Paystack`);
        await settle("succeeded", result.transactionId, `Paid after invoice ${invoice.reference} was ${invoice.status === "paid" ? "paid" : "cancelled"}: refund this payment in Paystack.`);
        return done("paid", invoice);
      }
      await settle("succeeded", result.transactionId, null);
      const { rows: [paid] } = await client.query<StudioInvoice>(
        `update studio_invoices set status = 'paid', paid_at = $2, method = 'paystack', receipt = $3 where id = $1 returning ${INVOICE_COLUMNS}`,
        [invoice.id, now, result.transactionId],
      );
      return done("paid", paid, true);
    }
    if (outcome === "failed") {
      await settle("failed", null, result.message ?? `Paystack: ${result.status}`);
      return done("failed", invoice);
    }
    return done("pending", invoice);
  });
}

/** The invoice a payment reference belongs to (for the page to send the payer back to). */
export async function studioInvoiceOfPayment(reference: string): Promise<StudioInvoice | null> {
  if (!STUDIO_PAYMENT_REFERENCE.test(reference)) return null;
  const { rows } = await ownerPool().query<StudioInvoice>(
    `select ${INVOICE_COLUMNS} from studio_invoices where id = (select invoice_id from studio_invoice_payments where reference = $1)`,
    [reference],
  );
  return rows[0] ?? null;
}

/** Payments under way that Paystack may have settled without telling us: ask, and give up on old ones. */
export async function sweepStudioPayments(checkout: Checkout, onSettled: (settled: SettledPayment) => Promise<void>, now = new Date()): Promise<number> {
  const { rows } = await ownerPool().query<{ reference: string; createdAt: Date }>(
    `select reference, created_at as "createdAt" from studio_invoice_payments where status = 'pending' and created_at < $1 order by created_at limit 50`,
    [new Date(now.getTime() - ASK_AFTER_MS)],
  );
  let settled = 0;
  for (const payment of rows) {
    try {
      const result = await checkout.check(payment.reference);
      let outcome = result ? await settleStudioPayment(result, now) : null;
      if ((!outcome || outcome.outcome === "pending") && now.getTime() - payment.createdAt.getTime() > GIVE_UP_MS) {
        outcome = await settleStudioPayment({ status: "failed", reference: payment.reference, amountMinor: 0, currency: "", transactionId: null, channel: null, message: "Not finished on Paystack." }, now);
      }
      if (outcome && outcome.outcome !== "pending") {
        settled += 1;
        await onSettled(outcome);
      }
    } catch (error) {
      console.error(`[studio] asking Paystack about ${payment.reference} failed:`, error);
    }
  }
  return settled;
}

// src/checkout/index.ts
//
// A reusable Paystack checkout (M-Pesa and cards): one hosted payment page per
// payable, and three ways to hear how it went (the payer's return, Paystack's
// signed webhook, and asking Paystack).
//
// It knows nothing about what is sold or where it is stored. The caller gives
// it the Paystack account's own secret key, so each business (and each
// project that reuses this folder) is paid into its own Paystack account,
// under its own name and with its own description of what was bought:
//
//   const checkout = createCheckout({ secretKey: process.env.PAYSTACK_SECRET_KEY, returnUrl: "https://example.com/pay/verify" });
//   const started = await checkout.start({ reference, amountMinor, currency, payerEmail, invoiceNumber, description });
//   if (started.ok) redirect(started.url);
//
//   // When the payer comes back (?reference=…), and for payments left pending:
//   const result = await checkout.check(reference);
//
//   // Paystack's webhook (the raw request body and the x-paystack-signature header):
//   const { valid, charge } = checkout.readWebhook(rawBody, signature);
//
// To reuse it elsewhere, copy this folder and src/payments/paystack.ts (which
// needs only fetch and node:crypto). See README.md in this folder.

import {
  chargeFromWebhook,
  initializeCheckout,
  validWebhookSignature,
  verifyTransaction,
  type VerifiedTransaction,
} from "../payments/paystack.ts";

export type CheckoutConfig = {
  /** The secret key of the Paystack account the money is paid into (sk_live_… or sk_test_…). */
  secretKey: string;
  /** Where Paystack sends the payer afterwards; Paystack adds ?reference=<our reference>. */
  returnUrl: string;
};

export type Payable = {
  /** Our own reference for this attempt: unique, and what Paystack reports back. */
  reference: string;
  /** In the currency's smallest unit (cents). */
  amountMinor: number;
  currency: "KES" | "USD";
  payerEmail: string;
  /** The invoice the payer sees on Paystack's receipt. */
  invoiceNumber: string;
  /** What is being paid for, in plain words, as the seller would describe it to its bank. */
  description: string;
};

export type ChargeResult = {
  /** Paystack's own status: success, failed, abandoned, pending, ongoing, reversed. */
  status: string;
  reference: string;
  amountMinor: number;
  currency: string;
  /** Paystack's transaction id: the receipt. */
  transactionId: string | null;
  /** card, mobile_money, … */
  channel: string | null;
  message: string | null;
};

export type ChargeOutcome = "paid" | "failed" | "pending";

const toResult = (transaction: VerifiedTransaction): ChargeResult => ({
  status: transaction.status,
  reference: transaction.reference,
  amountMinor: transaction.amountMinor,
  currency: transaction.currency,
  transactionId: transaction.id,
  channel: transaction.channel,
  message: transaction.message,
});

/**
 * What a charge means for a payable of this amount: paid only when Paystack
 * says success for exactly the amount and currency asked. A success for
 * another amount is "failed" (and needs a person to look at it).
 */
export function outcomeOf(result: Pick<ChargeResult, "status" | "amountMinor" | "currency">, asked: { amountMinor: number; currency: string }): { outcome: ChargeOutcome; mismatch: boolean } {
  if (result.status === "success") {
    const mismatch = result.amountMinor !== asked.amountMinor || result.currency !== asked.currency;
    return { outcome: mismatch ? "failed" : "paid", mismatch };
  }
  if (result.status === "failed" || result.status === "reversed") return { outcome: "failed", mismatch: false };
  return { outcome: "pending", mismatch: false };
}

export type Checkout = ReturnType<typeof createCheckout>;

export function createCheckout(config: CheckoutConfig) {
  if (!/^sk_(live|test)_[A-Za-z0-9]{10,100}$/.test(config.secretKey)) throw new Error("A Paystack secret key starts with sk_live_ or sk_test_.");
  if (!/^https?:\/\//.test(config.returnUrl)) throw new Error("The checkout's return address is an http(s) address.");
  return {
    /** True for a test key: nothing is charged. */
    testMode: config.secretKey.startsWith("sk_test_"),

    /** Starts a payment: the address of Paystack's page to send the payer to. */
    async start(payable: Payable): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
      const started = await initializeCheckout({ secretKey: config.secretKey, subaccount: null }, {
        email: payable.payerEmail,
        amountMinor: payable.amountMinor,
        currency: payable.currency,
        reference: payable.reference,
        callbackUrl: config.returnUrl,
        metadata: {
          invoice: payable.invoiceNumber,
          custom_fields: [
            { display_name: "Invoice", variable_name: "invoice", value: payable.invoiceNumber },
            { display_name: "For", variable_name: "description", value: payable.description },
          ],
        },
      });
      return started.ok ? { ok: true, url: started.checkout.authorizationUrl } : { ok: false, message: started.message };
    },

    /** Asks Paystack how a payment went. Null when Paystack couldn't be asked. */
    async check(reference: string): Promise<ChargeResult | null> {
      const verified = await verifyTransaction(config.secretKey, reference);
      return verified.ok ? toResult(verified.transaction) : null;
    },

    /**
     * Reads a webhook delivery. `valid` is whether Paystack signed it with
     * this account's key (answer 401 when it isn't); `charge` is the payment
     * when the event is a successful charge.
     */
    readWebhook(rawBody: Buffer, signature: string | undefined): { valid: boolean; charge: ChargeResult | null } {
      if (!validWebhookSignature(config.secretKey, rawBody, signature)) return { valid: false, charge: null };
      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return { valid: true, charge: null };
      }
      const charge = chargeFromWebhook(body);
      return { valid: true, charge: charge ? toResult(charge) : null };
    },
  };
}

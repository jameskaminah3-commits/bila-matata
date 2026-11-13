# Checkout

A small, reusable Paystack checkout (M-Pesa and cards). It knows nothing about
what is sold or where it is stored: you give it **one Paystack account's own
secret key** and it gives you a hosted payment page and three ways to hear how
the payment went.

```ts
import { createCheckout, outcomeOf } from "./checkout/index.ts";

const checkout = createCheckout({
  secretKey: process.env.PAYSTACK_SECRET_KEY!,       // this business's own account
  returnUrl: "https://example.com/pay/verify",        // Paystack adds ?reference=…
});

// 1. Start: send the payer to Paystack's page.
const started = await checkout.start({
  reference: "inv_0123456789abcdef",                  // yours, unique per attempt
  amountMinor: 1_000_000,                             // KES 10,000.00
  currency: "KES",
  payerEmail: "client@example.com",
  invoiceNumber: "INV-1042",
  description: "Website design: 50% deposit",         // what was actually sold
});
if (started.ok) redirect(started.url);

// 2. The payer comes back (GET /pay/verify?reference=…), or a payment was left pending:
const result = await checkout.check(reference);       // null when Paystack couldn't be asked
const { outcome, mismatch } = outcomeOf(result, { amountMinor: 1_000_000, currency: "KES" });

// 3. Paystack's webhook (raw request body + the x-paystack-signature header):
const { valid, charge } = checkout.readWebhook(rawBody, signature);
if (!valid) return res.status(401).end();
```

Rules it follows, so you don't have to remember them:

- **Paid means paid in full.** `outcomeOf` says `paid` only for a success of
  exactly the amount and currency you asked for. A success for another amount
  is `failed` with `mismatch: true`: look at it in Paystack.
- **A webhook counts only when the account's own key signed it** (HMAC-SHA512
  of the raw body). Parse nothing before checking.
- **Settle once.** The return, the webhook and your own polling can all report
  the same payment. Mark your record paid in one transaction, keyed by your
  reference, and ignore repeats (see `src/studio/invoices.ts` for a worked
  example: `settleStudioPayment`).

## Using it for another business

Copy this folder and `src/payments/paystack.ts` (it needs only `fetch` and
`node:crypto`), and give it **that business's own Paystack secret key**.

One Paystack account is approved for one business and what that business
sells. So:

- Each business (each legal entity, each line of business Paystack approved
  separately) gets its own Paystack account, its own keys, its own webhook
  address and its own descriptions of what was bought.
- Don't collect one business's sales through another business's account, and
  don't describe a sale as something else. Paystack reviews what an account
  processes; payments that don't match what the account was approved for get
  accounts frozen, and the money in them held, for every business using it.
- A business in a regulated category applies to Paystack with the licence
  that category needs, under its own name.

Bila Matata's own account (this service's `PLATFORM_PAYSTACK_SECRET_KEY`) takes
only what Bila Matata sells: Zaina AI plans and set-up, and the studio's
software, automation, data and research work. Businesses that take payments
through Zaina connect their own account in their dashboard.

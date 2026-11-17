// src/orders/pay.ts
//
// Paying for an order, into the business's own account, the same ways as a
// booking (payments/checkout.ts): card or M-Pesa on Paystack's page, an
// M-Pesa prompt on the customer's phone, or an M-Pesa code the team checks.
// The payment settles through checkout.ts's one settle step, which confirms
// the order (store.ts settleOrderPayment) and tells the customer and team.

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { formatMoney } from "../booking/money.ts";
import { getBookingSettings, paymentOptionsOf } from "../booking/settings.ts";
import { setPaymentReference } from "../booking/bookings.ts";
import { payments, type Business, type Order, type Payment, type PaymentWay } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { mpesaAccountFor, paystackAccountFor, type PayErrorCode } from "../payments/checkout.ts";
import { initializeCheckout } from "../payments/paystack.ts";
import { mpesaPhone, stkPush } from "../payments/mpesa.ts";
import { holdOrderWhileChecking, orderAmountDue, recordOrderPayment, settleOrderPayment } from "./store.ts";
import { tellOrderCustomer, tellOrderTeam } from "./notices.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const base = () => process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ?? "";

export type OrderPayStart = { ok: true; redirect?: string; payment: Payment } | { ok: false; code: PayErrorCode; message: string };
const failed = (code: PayErrorCode, message: string): OrderPayStart => ({ ok: false, code, message });

function overLimit(maxMinor: Partial<Record<PaymentWay, number>> | null | undefined, way: PaymentWay, amountMinor: number): boolean {
  const max = maxMinor?.[way];
  return max !== undefined && amountMinor > max;
}

/** An order can be paid while it waits for payment, after its hold lapsed (if stock is still there), or when it's to be paid on delivery. */
function payable(order: Order): PayErrorCode | null {
  if (orderAmountDue(order) <= 0) return ["requested"].includes(order.status) ? "wrong_status" : "nothing_due";
  return null;
}

export async function startOrderPaystack(business: Business, order: Order, input: { email?: string | null }): Promise<OrderPayStart> {
  const settings = await getBookingSettings(business.id);
  const account = await paystackAccountFor(business.id, settings);
  if (!account) return failed("not_available", "Card payments aren't available for this order.");
  const email = (order.customerEmail ?? input.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return failed("email_needed", "Please give an email address for your receipt.");
  const blocked = payable(order);
  if (blocked) return failed(blocked, "There's nothing to pay on this order now.");
  const amount = orderAmountDue(order);
  if (overLimit(settings.methodMaxMinor, "paystack", amount)) return failed("over_limit", "This amount is more than the business takes by card. Please pay another way.");
  const reference = `zb_${randomBytes(12).toString("hex")}`;
  const payment = await recordOrderPayment({ businessId: business.id, orderId: order.id, method: "paystack", amountMinor: amount, currency: order.currency, providerReference: reference, payerEmail: email });
  const started = await initializeCheckout(account, {
    email, amountMinor: amount, currency: order.currency, reference,
    callbackUrl: `${base()}/pay/o/${order.payToken}/done`,
    metadata: { order_reference: order.reference, business: business.id, custom_fields: [{ display_name: "Order", variable_name: "order", value: order.reference }] },
  });
  if (!started.ok) {
    await settleOrderPayment(business.id, payment.id, { succeeded: false, failure: started.message });
    console.warn(`[orders] ${business.id}: Paystack checkout for ${order.reference} failed: ${started.message}`);
    return failed("provider_failed", "Card payment couldn't be started just now. Please try again, or pay another way.");
  }
  return { ok: true, redirect: started.checkout.authorizationUrl, payment };
}

export async function startOrderMpesa(business: Business, order: Order, input: { phone: string }): Promise<OrderPayStart> {
  const settings = await getBookingSettings(business.id);
  const account = order.currency === "KES" ? await mpesaAccountFor(business.id, settings) : null;
  if (!account) return failed("not_available", "M-Pesa prompts aren't available for this order.");
  const phone = mpesaPhone(input.phone);
  if (!phone) return failed("phone_invalid", "Please give a Safaricom number, like 0712 345 678.");
  const blocked = payable(order);
  if (blocked) return failed(blocked, "There's nothing to pay on this order now.");
  const shillings = Math.ceil(orderAmountDue(order) / 100);
  if (overLimit(settings.methodMaxMinor, "mpesa_express", shillings * 100)) return failed("over_limit", "This amount is more than the business takes by M-Pesa prompt. Please pay another way.");
  const callbackToken = randomBytes(24).toString("base64url");
  const payment = await recordOrderPayment({ businessId: business.id, orderId: order.id, method: "mpesa_express", amountMinor: shillings * 100, currency: "KES", callbackToken, payerPhone: phone });
  const pushed = await stkPush(account, { phone, amount: shillings, reference: order.reference, description: "Order", callbackUrl: `${base()}/v1/payments/mpesa/${callbackToken}` });
  if (!pushed.ok) {
    await settleOrderPayment(business.id, payment.id, { succeeded: false, failure: pushed.message });
    console.warn(`[orders] ${business.id}: M-Pesa prompt for ${order.reference} failed: ${pushed.message}`);
    return failed("provider_failed", "The M-Pesa prompt couldn't be sent just now. Please try again, or pay another way.");
  }
  await setPaymentReference(business.id, payment.id, pushed.checkoutRequestId);
  return { ok: true, payment: { ...payment, providerReference: pushed.checkoutRequestId } };
}

export type OrderCodeResult = { ok: true; payment: Payment; already: boolean } | { ok: false; reason: "used" | "nothing_due" | "not_taken" | "over_limit" };

/** An M-Pesa code the customer sent for their order (chat or payment page): for the team to check; the stock stays held meanwhile. */
export async function submitOrderCode(business: Business, order: Order, code: string): Promise<OrderCodeResult> {
  const settings = await getBookingSettings(business.id);
  if (!paymentOptionsOf(settings).mpesaManual && !settings.mpesaExpress) return { ok: false, reason: "not_taken" };
  const [existing] = await inBusiness((db) => db.select().from(payments)
    .where(and(eq(payments.businessId, business.id), eq(payments.method, "mpesa_code"), eq(payments.providerReference, code))).limit(1), business.id);
  if (existing) return existing.orderId === order.id ? { ok: true, payment: existing, already: true } : { ok: false, reason: "used" };
  const amount = orderAmountDue(order);
  if (amount <= 0) return { ok: false, reason: "nothing_due" };
  if (overLimit(settings.methodMaxMinor, "mpesa_manual", amount)) return { ok: false, reason: "over_limit" };
  let payment: Payment;
  try {
    payment = await recordOrderPayment({ businessId: business.id, orderId: order.id, method: "mpesa_code", amountMinor: amount, currency: order.currency, providerReference: code });
  } catch (error) {
    const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string };
    if (database.code === "23505") return { ok: false, reason: "used" };
    throw error;
  }
  await holdOrderWhileChecking(business.id, order.id, settings.codeCheckHours);
  void tellOrderTeam(business, order, "code", `M-Pesa code ${code} for ${formatMoney(amount, order.currency)}: check it in your M-Pesa statement, then confirm or reject it on the order.`);
  void tellOrderCustomer(business, order, "code_received");
  return { ok: true, payment, already: false };
}

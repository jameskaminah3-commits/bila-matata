// src/orders/notices.ts
//
// Telling the customer where their order stands, at every step, without the
// team writing a word: in the chat it came from (on WhatsApp too, as a reply
// waiting when the 24-hour window has closed) and by email when they gave
// one. And telling the team what needs them. Never throws.

import { holdUntil, sendCustomerEmail } from "../booking/notices.ts";
import { formatMoney } from "../booking/money.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import { requestDelivery } from "../channels/whatsapp/runtime.ts";
import { appendEvent, getSession } from "../conversations/store.ts";
import { alertTeam } from "../conversations/team-alerts.ts";
import { runForBusiness } from "../db/tenant.ts";
import type { Business, ChatLanguage, Order } from "../db/schema.ts";
import { getOrderSettings } from "./settings.ts";
import { orderSummary, type OrderSettlement } from "./store.ts";

export type OrderNotice =
  | "awaiting_payment" | "requested" | "confirmed" | "paid" | "code_received" | "code_rejected"
  | "out_for_delivery" | "ready_for_collection" | "completed" | "cancelled" | "declined" | "expired" | "conflict";

const base = () => process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
/** The order's own payment page: what it is, what's due, the business's ways to pay. */
export const orderPayLink = (order: Pick<Order, "payToken">) => `${base()}/pay/o/${order.payToken}`;

type Words = { order: Order; name: string; language: ChatLanguage; timeZone: string; collectionPoint: string | null; reason: string | null };

/** "10 × Golden Fry 20L, 2 × Pishori rice 25kg". */
const items = (order: Order) => order.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ");

function text(notice: OrderNotice, w: Words): string {
  const { order } = w;
  const total = formatMoney(order.totalMinor, order.currency);
  const sw = w.language === "sw";
  const until = order.holdExpiresAt ? holdUntil(order.holdExpiresAt, w.timeZone, w.language) : "";
  const handing = order.spot
    ? (sw ? `Tutakuletea ${order.spot}.` : `We'll bring it to you at ${order.spot}.`)
    : order.fulfilment === "delivery"
    ? (sw ? `Tutakuletea ${order.address ? `${order.address}, ` : ""}${order.zone}.` : `We'll deliver to ${order.address ? `${order.address}, ` : ""}${order.zone}.`)
    : (sw ? `Utaichukua${w.collectionPoint ? ` ${w.collectionPoint}` : ""}.` : `You'll collect it${w.collectionPoint ? ` at ${w.collectionPoint}` : ""}.`);
  const payNote = !order.payOnDelivery ? ""
    : order.spot ? (sw ? ` Utalipa ${total} ikifika.` : ` You'll pay ${total} when it arrives.`)
    : (sw ? ` Utalipa ${total} ${order.fulfilment === "delivery" ? "ukiletewa" : "ukichukua"}.` : ` You'll pay ${total} on ${order.fulfilment === "delivery" ? "delivery" : "collection"}.`);
  switch (notice) {
    case "awaiting_payment":
      return sw
        ? `Oda ${order.reference} (${items(order)}): jumla ${total}. Lipa hapa kuithibitisha: ${orderPayLink(order)} . Bidhaa zako zimehifadhiwa hadi ${until}.`
        : `Order ${order.reference} (${items(order)}): ${total} in all. Pay here to confirm it: ${orderPayLink(order)} . Your items are kept for you until ${until}.`;
    case "requested":
      return sw
        ? `Oda ${order.reference} imefika kwa ${w.name}. Watakuthibitishia hapa hivi karibuni.`
        : `Order ${order.reference} is with ${w.name}. They'll confirm it here shortly.`;
    case "confirmed":
      return sw ? `Oda ${order.reference} imethibitishwa. ${handing}${payNote}` : `Order ${order.reference} is confirmed. ${handing}${payNote}`;
    case "paid":
      return sw ? `Tumepokea malipo yako ya ${total}. Oda ${order.reference} imethibitishwa. ${handing}` : `We've received your payment of ${total}. Order ${order.reference} is confirmed. ${handing}`;
    case "code_received":
      return sw ? `Tumepokea namba yako ya M-Pesa ya oda ${order.reference}. Timu inaikagua na itathibitisha oda yako.` : `We've got your M-Pesa code for order ${order.reference}. The team is checking it and will confirm your order.`;
    case "code_rejected":
      return sw
        ? `Timu haikupata malipo hayo ya M-Pesa kwa oda ${order.reference}${w.reason ? ` (${w.reason})` : ""}. Unaweza kulipa tena hapa: ${orderPayLink(order)} .`
        : `The team couldn't find that M-Pesa payment for order ${order.reference}${w.reason ? ` (${w.reason})` : ""}. You can pay again here: ${orderPayLink(order)} .`;
    case "out_for_delivery":
      return sw ? `Oda ${order.reference} iko njiani kukuletea.${payNote}` : `Order ${order.reference} is on its way to you.${payNote}`;
    case "ready_for_collection":
      if (order.spot) return sw ? `Oda ${order.reference} iko tayari: tunakuletea ${order.spot}.${payNote}` : `Order ${order.reference} is ready: we're bringing it to you at ${order.spot}.${payNote}`;
      return sw ? `Oda ${order.reference} iko tayari kuchukuliwa${w.collectionPoint ? ` ${w.collectionPoint}` : ""}.${payNote}` : `Order ${order.reference} is ready for you to collect${w.collectionPoint ? ` at ${w.collectionPoint}` : ""}.${payNote}`;
    case "completed":
      return sw ? `Oda ${order.reference} imekamilika. Asante kwa kununua kutoka ${w.name}!` : `Order ${order.reference} is complete. Thank you for ordering from ${w.name}!`;
    case "cancelled":
      return sw
        ? `Oda ${order.reference} imeghairiwa${w.reason ? `: ${w.reason}` : ""}.${order.paidMinor > 0 ? " Timu itawasiliana nawe kuhusu pesa uliyolipa." : ""}`
        : `Order ${order.reference} was cancelled${w.reason ? `: ${w.reason}` : ""}.${order.paidMinor > 0 ? " The team will contact you about what you paid." : ""}`;
    case "declined":
      return sw ? `Samahani, ${w.name} haikuweza kuchukua oda ${order.reference}${w.reason ? `: ${w.reason}` : ""}.` : `Sorry, ${w.name} couldn't take order ${order.reference}${w.reason ? `: ${w.reason}` : ""}.`;
    case "expired":
      return sw ? `Muda wa kulipa oda ${order.reference} umeisha, kwa hivyo bidhaa hazijahifadhiwa tena. Niambie ukitaka kuagiza tena.` : `The time to pay for order ${order.reference} has passed, so its items aren't kept any more. Tell me if you'd like to order again.`;
    case "conflict":
      return sw ? `Tumepokea malipo yako ya oda ${order.reference}. Timu ya ${w.name} itawasiliana nawe hivi karibuni kuithibitisha.` : `We've received your payment for order ${order.reference}. The team at ${w.name} will contact you shortly to confirm it.`;
  }
}

const SUBJECTS: Record<OrderNotice, string> = {
  awaiting_payment: "Pay to confirm your order", requested: "Your order is with the team", confirmed: "Your order is confirmed", paid: "Payment received: your order is confirmed",
  code_received: "We've got your M-Pesa code", code_rejected: "Your M-Pesa payment", out_for_delivery: "Your order is on its way", ready_for_collection: "Your order is ready to collect",
  completed: "Thank you for your order", cancelled: "Your order was cancelled", declined: "About your order", expired: "Your order lapsed", conflict: "Payment received for your order",
};

/** Tells the customer about their order, in its chat (and WhatsApp) and by email. */
export async function tellOrderCustomer(business: Business, order: Order, notice: OrderNotice, reason: string | null = null): Promise<void> {
  try {
    await runForBusiness(business.id, async () => {
      const [settings, orderSettings] = await Promise.all([getBusinessSettings(business.id), getOrderSettings(business.id)]);
      const session = order.sessionId ? await getSession(order.sessionId) : undefined;
      const words: Words = { order, name: settings?.displayName ?? business.name, language: session?.language ?? "en", timeZone: business.timeZone, collectionPoint: orderSettings.collectionPoint, reason };
      const message = text(notice, words);
      if (session) {
        await appendEvent({ businessId: business.id, sessionId: session.id, actor: "ZAINA_REASONING", content: message });
        if (session.channel === "whatsapp") void requestDelivery(business.id, session.id, 0);
      }
      if (order.customerEmail) {
        const english = words.language === "en" ? message : text(notice, { ...words, language: "en" });
        await sendCustomerEmail(order.customerEmail, `${order.spot && notice === "ready_for_collection" ? "Your order is ready" : SUBJECTS[notice]} (${order.reference}, ${words.name})`, `${english}\n\n— ${words.name}`, settings?.supportEmail ?? null);
      }
    });
  } catch (error) {
    console.error(`[orders] telling the customer about ${order.reference} (${notice}) failed:`, error);
  }
}

/** Tells the team what needs them, or what's worth knowing. */
export function tellOrderTeam(business: Business, order: Order, what: "request" | "new" | "paid" | "code" | "conflict", extra = ""): Promise<void> {
  const summary = `${orderSummary(order)}${extra ? `. ${extra}` : ""}`.slice(0, 400);
  return alertTeam(business, { kind: "order", what, orderId: order.id, sessionId: order.sessionId, summary }).catch((error) => console.error(`[orders] alerting the team about ${order.reference} failed:`, error));
}

/** After money arrives for an order: the customer and the team hear what it means. */
export async function afterOrderSettlement(business: Business, settled: OrderSettlement | undefined): Promise<void> {
  if (!settled?.changed || settled.payment.status !== "succeeded") return;
  const paid = `Paid ${formatMoney(settled.payment.amountMinor, settled.payment.currency)} (${settled.payment.method.replace("_", " ")}).`;
  if (settled.conflict) {
    await Promise.all([tellOrderCustomer(business, settled.order, "conflict"), tellOrderTeam(business, settled.order, "conflict", `${paid} ${settled.order.conflict ?? ""}`)]);
  } else if (settled.confirmed) {
    await Promise.all([tellOrderCustomer(business, settled.order, "paid"), tellOrderTeam(business, settled.order, "paid", paid)]);
  }
}

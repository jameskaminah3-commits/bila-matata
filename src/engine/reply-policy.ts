// src/engine/reply-policy.ts
//
// Deterministic rules for what Zaina sends to customers. The model writes
// the conversational part; the server owns anything that must be exactly
// right — payment links, payment steps, and listing links.
//
// Pure module: no database or network access, so every rule is unit-tested.

import type { ChatLanguage } from "../db/schema.ts";
import { texts } from "./messages.ts";

// ═══════════════════════════════════════════════════════════════════
// LISTING AND PAYMENT LINKS
// ═══════════════════════════════════════════════════════════════════

export type CustomerLink = { kind: "listing" | "payment"; url: string };

export function collectCustomerLinks(value: any, links: CustomerLink[]): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "public_url" || key === "payment_link") && typeof child === "string") {
      const kind = key === "payment_link" ? "payment" : "listing";
      if (!links.some((link) => link.url === child)) links.push({ kind, url: child });
    }
    collectCustomerLinks(child, links);
  }
}

export function appendMissingCustomerLink(value: string, links: CustomerLink[]): string {
  if (links.length === 0 || links.some((link) => value.includes(link.url))) return value;
  const link = links.at(-1);
  if (!link) return value;
  const label = link.kind === "payment"
    ? (/\/pay\/o\//.test(link.url) ? "Pay for your order here" : "Complete your booking here")
    : "View the full listing here";
  return `${value.trim()}\n\n${label}:\n${link.url}`;
}

// Never let storage image URLs leak into the customer conversation. Listings
// have a public booking page; that is the only link Zaina should share.
// ")" is excluded so a markdown link's closing bracket is never swallowed.
const MEDIA_URL_PATTERN = /https?:\/\/[^\s"'<>)]+\/storage\/v1\/object\/public\/media\/[^\s"'<>)]+/gi;

export function redactMediaUrls(value: string): string {
  return value.replace(MEDIA_URL_PATTERN, "[image link omitted — use the public listing page link]");
}

export function redactMediaUrlsDeep(value: any): any {
  if (typeof value === "string") return redactMediaUrls(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactMediaUrlsDeep);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, redactMediaUrlsDeep(child)]),
  );
}

export function replaceMediaUrls(value: string, latestCustomerLink: string | undefined): string {
  return value.replace(
    MEDIA_URL_PATTERN,
    latestCustomerLink ?? "[public listing or payment link unavailable]",
  );
}

// ═══════════════════════════════════════════════════════════════════
// LINK AND NUMBER SAFETY — what the model is allowed to pass on
// ═══════════════════════════════════════════════════════════════════
//
// Tool results include text written by listing owners, and the model can be
// talked into repeating anything. Customers act on links and phone numbers
// (including M-Pesa numbers), so those are checked deterministically:
//   • links: the business's own sites (from its settings), WhatsApp, or a
//     link the customer sent in this conversation;
//   • phone and M-Pesa numbers: the business's official numbers, or a number
//     the customer gave;
//   • images are never sent, and non-web links (javascript:, data:) are dropped.

// Allowed when a business's settings name no hosts of their own.
const TRUSTED_HOSTS = ["wa.me", "whatsapp.com", "api.whatsapp.com"];
const LINK_REMOVED = "(link removed)";
const NUMBER_REMOVED = "(number removed)";

export type SanitizeContext = {
  /** Everything the customer has written in this conversation. */
  customerTexts: string[];
  /**
   * The business's rules (from its settings). Left out, only WhatsApp links
   * and what the customer sent are allowed, and no phone number is official.
   */
  allowedHosts?: string[];
  allowedHostSuffixes?: string[];
  officialPhones?: string[];
  /** Exact links the business's own system returned in this turn (its checkout, tracking or payment pages). */
  allowedUrls?: string[];
};

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function trimUrlPunctuation(url: string): { url: string; trailing: string } {
  const match = url.match(/[.,;:!?]+$/);
  return match ? { url: url.slice(0, -match[0].length), trailing: match[0] } : { url, trailing: "" };
}

/** Compares links loosely: protocol, "www.", case of the host, and a trailing "/" don't matter. */
function comparableUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${normalizeHost(parsed.hostname)}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  } catch {
    return null;
  }
}

function customerSentUrl(url: string, context: SanitizeContext): boolean {
  const target = comparableUrl(url);
  if (!target) return false;
  return context.customerTexts.some((text) =>
    (text.match(/https?:\/\/[^\s<>"'\])]+/gi) ?? []).some((sent) => comparableUrl(trimUrlPunctuation(sent).url) === target));
}

export function isAllowedCustomerUrl(rawUrl: string, context: SanitizeContext): boolean {
  const url = rawUrl.trim();
  if (url.startsWith("/") && !url.startsWith("//")) return true; // a path on the business's own site
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (context.allowedUrls?.length) {
    const target = comparableUrl(url);
    if (target && context.allowedUrls.some((allowed) => comparableUrl(allowed) === target)) return true;
  }
  const host = normalizeHost(parsed.hostname);
  if (context.allowedHosts) {
    const hosts = context.allowedHosts.map(normalizeHost);
    if (hosts.includes(host) || (context.allowedHostSuffixes ?? []).some((suffix) => host.endsWith(suffix.toLowerCase()))) return true;
    return customerSentUrl(url, context);
  }
  if (TRUSTED_HOSTS.includes(host)) return true;
  return customerSentUrl(url, context);
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Kenyan numbers in any common spelling compare equal: 0718…, +254 718…, 254718…. */
function canonicalPhone(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length === 10 && digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9 && /^[17]/.test(digits)) return `254${digits}`;
  return digits;
}

function customerNumbers(context: SanitizeContext): Set<string> {
  const numbers = new Set<string>();
  for (const text of context.customerTexts) {
    for (const match of text.match(/\+?\d[\d\s-]{5,16}\d/g) ?? []) {
      numbers.add(canonicalPhone(match));
      numbers.add(digitsOnly(match));
    }
  }
  return numbers;
}

// Kenyan mobile numbers (07…, 01…, +254 7…, 254 1…) and other international "+" numbers.
const PHONE_PATTERN = /(?<![\w+])(?:(?:\+?254[\s-]?|0)[17]\d{2}[\s-]?\d{3}[\s-]?\d{3}|\+\d{1,3}[\s-]?\d[\d\s-]{6,13}\d)(?![\w])/g;
// M-Pesa paybill / till / account numbers, e.g. "Paybill 522522, account no. 1234".
// "till" needs an explicit "number"/"no." so "till 2026-10-12" (a date) is left alone.
const PAYMENT_NUMBER_PATTERN = /\b(pay\s?bill(?:\s+(?:no\.?|number))?|till\s+(?:no\.?|number)|buy\s+goods(?:\s+(?:till|number|no\.?))?|business\s+(?:no\.?|number)|account\s+(?:no\.?|number))(\s*[:#-]?\s*)(\d[\d\s-]{2,14}\d)/gi;

function sanitizePlainText(text: string, context: SanitizeContext): string {
  const allowedNumbers = customerNumbers(context);
  for (const phone of context.officialPhones ?? []) allowedNumbers.add(canonicalPhone(phone));

  return text
    .replace(PHONE_PATTERN, (match) => (allowedNumbers.has(canonicalPhone(match)) ? match : NUMBER_REMOVED))
    .replace(PAYMENT_NUMBER_PATTERN, (match, label: string, separator: string, number: string) => (
      allowedNumbers.has(digitsOnly(number)) || allowedNumbers.has(canonicalPhone(number))
        ? match
        : `${label}${separator}${NUMBER_REMOVED}`
    ));
}

// Markdown images, markdown links, and bare URLs — in that order of precedence.
// Link targets may contain one level of parentheses, e.g. javascript:alert(1).
// A bare "https://" with no host after it (as in "a link beginning with
// https://") is plain text, not a link.
const LINK_TOKEN_PATTERN = /!\[[^\]]*\]\((?:[^()\s]|\([^()\s]*\))*\)|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\b(?:https?:\/\/[a-z0-9][^\s<>"'\])]*|(?:javascript|data|vbscript):[^\s<>"'\])]+)/gi;

/**
 * Applies the link and number rules to text written by the model. Server-built
 * sections (payment steps, listing links) are appended after this runs.
 */
export function sanitizeModelText(text: string, context: SanitizeContext): string {
  let result = "";
  let lastIndex = 0;
  for (const match of Array.from(text.matchAll(LINK_TOKEN_PATTERN))) {
    const index = match.index ?? 0;
    result += sanitizePlainText(text.slice(lastIndex, index), context);
    lastIndex = index + match[0].length;

    const token = match[0];
    if (token.startsWith("!")) continue; // images are never sent
    if (match[1] !== undefined && match[2] !== undefined) {
      const label = sanitizePlainText(match[1], context);
      result += isAllowedCustomerUrl(match[2], context) ? `[${label}](${match[2]})` : label;
      continue;
    }
    const { url, trailing } = trimUrlPunctuation(token);
    result += (isAllowedCustomerUrl(url, context) ? url : LINK_REMOVED) + trailing;
  }
  result += sanitizePlainText(text.slice(lastIndex), context);
  return result;
}

/**
 * Customer messages are replayed to the model next to earlier tool results.
 * A customer must not be able to pass their own text off as a tool result.
 */
export function neutralizeToolMarkers(text: string): string {
  return text
    .replace(/<(\/?)(tool_result|turn_context)/gi, "‹$1$2")
    .replace(/\[earlier tool\]/gi, "(earlier tool)")
    .replace(/\[earlier in this chat/gi, "(earlier in this chat");
}

/**
 * How an earlier tool call is replayed to the model: clearly delimited data.
 * Text inside it (a listing owner's description, a knowledge passage) can't
 * close the block early or pose as the system's turn context.
 */
export function formatToolHistoryEntry(toolName: string, argsText: string, resultText: string): string {
  return `<tool_result name="${toolName.replace(/[^\w-]/g, "")}">\nargs: ${neutralizeToolMarkers(argsText)}\nresult: ${neutralizeToolMarkers(resultText)}\n</tool_result>`;
}

// ═══════════════════════════════════════════════════════════════════
// PAYMENT SECTIONS — appended by the server, never written by the model
// ═══════════════════════════════════════════════════════════════════

export type PaymentKind = "room_booking";

export type PaymentDetails = {
  kind: PaymentKind;
  url: string;
  bookingId?: string;
  /** Deposit for a booking, already formatted in the customer's currency. */
  depositDisplay?: string;
  /** A booking on the platform: its reference, total, deposit share, hold and ways to pay. */
  reference?: string;
  totalDisplay?: string;
  depositPercent?: number;
  /** The whole amount is paid up front (the business's rule). */
  paysInFull?: boolean;
  /** A time slot (a salon or table booking): its time is held, not rooms. */
  slot?: boolean;
  holdUntil?: string;
  payBy?: string;
};

const PAYMENT_TOOL_KINDS: Record<string, PaymentKind> = {
  create_booking: "room_booking",
  create_appointment: "room_booking",
};

/** Returns payment details when a tool call created (or replayed) something payable. */
export function paymentDetailsFromToolResult(toolName: string, result: any): PaymentDetails | null {
  const kind = PAYMENT_TOOL_KINDS[toolName];
  if (!kind || !result || result.ok !== true || typeof result.payment_link !== "string") return null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
  return {
    kind,
    url: result.payment_link,
    bookingId: text(result.booking_id),
    depositDisplay: text(result.deposit_display),
    reference: text(result.reference),
    totalDisplay: text(result.total_display),
    depositPercent: typeof result.deposit_percent === "number" ? result.deposit_percent : undefined,
    paysInFull: result.pays_in_full === true,
    slot: result.slot === true,
    holdUntil: text(result.hold_until),
    payBy: text(result.pay_by),
  };
}

/**
 * The payment section for a room booking on the platform: the business's own
 * payment page (its link carries the booking), its deposit and hold, and the
 * way the customer hears it's confirmed.
 */
function roomBookingSection(details: PaymentDetails, language: ChatLanguage): string {
  const host = (() => {
    try {
      return new URL(details.url).host;
    } catch {
      return "";
    }
  })();
  const sw = language === "sw";
  const reference = details.reference ?? "";
  const full = details.paysInFull === true;
  const percent = !full && details.depositPercent !== undefined && details.depositPercent < 100 ? details.depositPercent : null;
  if (sw) {
    return [
      full
        ? `Uhifadhi ${reference} umeshikiliwa kwa ajili yako. Lipa kiasi chote${details.depositDisplay ? `, yaani ${details.depositDisplay},` : ""} hapa ili kuuthibitisha:`
        : `Uhifadhi ${reference} umeshikiliwa kwa ajili yako. Lipa amana${percent !== null ? ` ya asilimia ${percent}` : ""}${details.depositDisplay ? `, yaani ${details.depositDisplay},` : ""} hapa ili kuuthibitisha:`,
      details.url,
      "",
      "Kinachofuata:",
      `• Ukurasa unaonyesha uhifadhi wako na jumla yake${details.totalDisplay ? ` (${details.totalDisplay})` : ""}.${details.payBy ? ` Lipa kwa ${details.payBy === "card or M-Pesa" ? "kadi au M-Pesa" : details.payBy === "card" ? "kadi" : details.payBy}.` : ""}`,
      full
        ? "• Malipo yakifika, uhifadhi wako unathibitishwa na utapata ujumbe hapa."
        : "• Amana ikifika, uhifadhi wako unathibitishwa na utapata ujumbe hapa. Kiasi kilichobaki kinalipwa ukifika.",
      details.holdUntil
        ? details.slot
          ? `• Muda huu umeshikiliwa hadi ${details.holdUntil}; baada ya hapo unaweza kupewa mtu mwingine.`
          : `• Vyumba vimeshikiliwa hadi ${details.holdUntil}; baada ya hapo vinaweza kupewa mtu mwingine.`
        : null,
      host ? `• Kila mara hakikisha anwani inaanza na ${host} kabla ya kulipa.` : null,
    ].filter((line) => line !== null).join("\n");
  }
  return [
    full
      ? `Booking ${reference} is held for you. Pay the full amount${details.depositDisplay ? ` of ${details.depositDisplay}` : ""} here to confirm it:`
      : `Booking ${reference} is held for you. Pay the${percent !== null ? ` ${percent}%` : ""} deposit${details.depositDisplay ? ` of ${details.depositDisplay}` : ""} here to confirm it:`,
    details.url,
    "",
    "What happens next:",
    `• The page shows your booking and its total${details.totalDisplay ? ` (${details.totalDisplay})` : ""}.${details.payBy ? ` Pay by ${details.payBy}.` : ""}`,
    full
      ? "• Once the payment arrives, your booking is confirmed and you'll get a message here."
      : `• Once the deposit arrives, your booking is confirmed and you'll get a message here. The rest is paid ${details.slot ? "when you arrive" : "at the property"}.`,
    details.holdUntil
      ? `• ${details.slot ? "This time is" : "The rooms are"} held until ${details.holdUntil}; after that ${details.slot ? "it" : "they"} may go to someone else.`
      : null,
    host ? `• Always check the address starts with ${host} before you pay.` : null,
  ].filter((line) => line !== null).join("\n");
}

/**
 * The payment link and "what happens next" steps for something payable. The
 * Swahili is a draft until a fluent speaker has checked it (see messages.ts).
 */
export function buildPaymentSection(details: PaymentDetails, language: ChatLanguage = "en"): string {
  return roomBookingSection(details, language);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes the model's own copies of payment links (full, markdown, or a
 * shortened /bookings path) and its own "What happens next" section, so the
 * server-built section is the only one the customer sees.
 */
export function removeModelPaymentCopies(text: string, payments: PaymentDetails[]): string {
  let result = text;

  const stepsHeading = result.search(/^[ \t>#*_]*(?:what happens next|kinachofuata)\b/im);
  if (stepsHeading >= 0) result = result.slice(0, stepsHeading);

  const targets = new Set<string>();
  for (const payment of payments) {
    targets.add(payment.url);
    if (payment.bookingId) targets.add(`/bookings?bookingId=${payment.bookingId}`);
  }
  if (targets.size === 0) return result.trim();

  const targetPattern = Array.from(targets).map(escapeRegExp).join("|");
  // A markdown link to the payment page, then any bare URL or path containing it.
  const markdownLink = new RegExp(`\\[[^\\]]*\\]\\((?:https?:\\/\\/[^\\s)]*)?(?:${targetPattern})[^\\s)]*\\)`, "g");
  const bareLink = new RegExp(`(?:https?:\\/\\/[^\\s)]*?)?(?:${targetPattern})[^\\s)]*`, "g");

  const lines = result.split("\n").map((line) => {
    const withoutLink = line.replace(markdownLink, "").replace(bareLink, "");
    if (withoutLink === line) return line;
    const trimmed = withoutLink.trim();
    const core = trimmed.replace(/[\s()[\]<>:.,;–—-]+$/, "").trim();
    // A line that only labelled the link ("Pay here:", "Or here:") goes entirely.
    const onlyALabel = core.length === 0
      || (core.length <= 40 && (/[:–—-]$/.test(trimmed) || /\b(here|link|below|now)$/i.test(core)));
    return onlyALabel ? null : withoutLink.replace(/ {2,}/g, " ").trimEnd();
  });

  return lines.filter((line): line is string => line !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Markdown bold/underline markers render as literal symbols in the widget. */
export function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/\*\*/g, "");
}

/**
 * Final shaping of the model's text for this turn: plain text, no model-made
 * payment copies, and exactly one server-built payment section per payable
 * item created in this turn.
 */
export function composeCustomerReply(modelText: string, payments: PaymentDetails[], language: ChatLanguage = "en"): string {
  let text = stripMarkdownEmphasis(modelText);
  if (payments.length === 0) return text;

  text = removeModelPaymentCopies(text, payments);
  const unique = payments.filter((payment, index) => payments.findIndex((other) => other.url === payment.url) === index);
  const sections = unique.map((payment) => buildPaymentSection(payment, language));
  return [text, ...sections].filter((part) => part.trim().length > 0).join("\n\n");
}

/** What the customer sees if the turn fails after something payable was created. */
export function paymentRecoveryMessage(payments: PaymentDetails[], language: ChatLanguage = "en"): string {
  return composeCustomerReply(texts(language).paymentRecovery, payments, language);
}

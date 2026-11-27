// src/frontdoor/page.ts
//
// A business's own page on this service (/c/<business>), for a business with
// no website of its own: its name, logo and colours, and Zaina, its
// receptionist, ready to talk. A QR code on the counter opens it.
//
// The page is complete HTML with no inline script or style (its policy allows
// only the service's own files): the look comes from door.css and the
// business's colours from /c/<business>/brand.css; the chat is the same
// widget every website uses, filling the page instead of floating.

import type { VenuePayment } from "../db/schema.ts";
import { createHash } from "node:crypto";
import { readableOn } from "../brand/assets.ts";
import type { DoorCatalogue } from "./catalogue.ts";
import { TITLE_FONTS, TITLE_FONT_KEYS, type TitleFont } from "./title-fonts.ts";
import { widgetVersion } from "./widget-version.ts";

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type DoorView = {
  businessId: string;
  name: string;
  tagline: string | null;
  /** The page in the guest's phone's light or dark, or always one. */
  menuStyle?: "auto" | "light" | "dark" | "backdrop";
  /** The logo already spells the name: shown large as the heading, the name kept for screen readers. */
  logoHasName?: boolean;
  /** The lettering of the name and section titles (classic unless the business chose another). */
  titleFont?: TitleFont;
  assistant: string;
  role: string;
  color: string;
  logoUrl: string | null;
  coverUrl: string | null;
  /** "+254 700 000 000" as people read it, and +254700000000 to dial. */
  phoneDisplay: string | null;
  phone: string | null;
  whatsapp: string | null;
  via: "qr" | "link" | "card";
  /** Changes when the colours do, so the stylesheet can be kept. */
  brandVersion: string;
  /** What the business offers, when it shows anything: a tab beside the chat. */
  catalogue?: DoorCatalogue | null;
  /** What's on, as the team posted it: today's, and the coming days'. */
  whatsOn?: { today: string[]; soon: Array<{ label: string; text: string }> } | null;
  /** Where the customer is, from the code they scanned ("Table 5"). */
  spot?: string | null;
  /** False on the Menu plan: the menu and What's on alone, with no chat and no "Ask Zaina" anywhere. */
  chat?: boolean;
  /** How guests pay at the place, as the owner set it: an M-Pesa till, or a Paybill and account. */
  pay?: VenuePayment | null;
};

/**
 * One slim line under the name: where the guest is (from the table's code)
 * and how to reach the team (call, WhatsApp). On a phone the call shows as
 * "Call" alone, the number kept for screen readers, so the line stays one.
 */
function utilityLine(view: DoorView, orders: boolean): string {
  const spot = view.catalogue && view.spot
    ? `<p class="door-spot">${ICONS.pin}<span>You're at <strong>${esc(view.spot)}</strong>${orders ? '<span class="door-spot-more">. Anything you order here is brought to you.</span>' : ""}</span></p>`
    : "";
  const contact = [
    view.phone && view.phoneDisplay ? `<a class="door-btn" href="tel:${esc(view.phone)}" aria-label="Call ${esc(view.phoneDisplay)}">${ICONS.phone}<span>Call<span class="door-btn-detail"> ${esc(view.phoneDisplay)}</span></span></a>` : "",
    view.whatsapp ? `<a class="door-btn" href="${esc(view.whatsapp)}" target="_blank" rel="noopener noreferrer">${ICONS.whatsapp}<span>WhatsApp</span></a>` : "",
  ].join("");
  return spot || contact ? `<div class="door-utility">${spot}${contact}</div>` : "";
}

/**
 * "Pay with M-Pesa" as one slim strip: the till (or the Paybill and its
 * account) with a Copy pill, and the name M-Pesa shows in small type under it.
 */
export function renderPay(pay: VenuePayment | null | undefined): string {
  if (!pay || (!pay.till && !pay.paybill)) return "";
  const number = (pay.till ?? pay.paybill)!;
  const what = pay.till ? "M-Pesa till" : "M-Pesa paybill";
  // Under the number, small: the Paybill's account, and the name M-Pesa shows so guests can check it.
  const below = [!pay.till && pay.account ? `Account <b>${esc(pay.account)}</b>` : "", pay.name ? `M-Pesa shows ${esc(pay.name)}` : ""].filter(Boolean).join(" · ");
  return `<div class="door-pay" role="group" aria-label="Pay with M-Pesa"><div class="door-pay-row"><span class="door-pay-what">${ICONS.pay}<span>${what}</span></span><span class="door-pay-number">${esc(number)}</span><button type="button" class="door-pay-copy" data-copy="${esc(number)}" aria-label="Copy the ${pay.till ? "till" : "Paybill"} number" hidden>Copy</button></div>${below ? `<p class="door-pay-name">${below}</p>` : ""}</div>`;
}

/** The quiet line at the foot of every page and printed card. */
export const POWERED_BY = { text: "Powered by Bila Matata", href: "https://bilamatata.com" };

/** Up to two letters for a business with no logo: "Palm Cove Stays" → "PC". */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

const ICONS = {
  phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 7.8 19.4L3 21z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2L9 9.5z"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  pay: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
};

/** "Dark, over your photos": one layer behind the menu, its photo blurred once and dimmed; the cover photo first, else the first section's. */
function backdropLayer(view: DoorView): string {
  const first = view.coverUrl ?? (view.catalogue?.banners ? Object.values(view.catalogue.banners)[0] : undefined) ?? null;
  return `<div class="cat-backdrop" aria-hidden="true"><img id="cat-backdrop-img" alt="" decoding="async"${first ? ` src="${esc(first)}"` : ""}></div>`;
}

/** A section typed in capitals ("SALADS & SANDWICHES") reads as a title ("Salads & Sandwiches"); one typed any other way stays as it is. */
export function sectionTitle(name: string): string {
  if (/\p{Ll}/u.test(name) || !/\p{Lu}.*\p{Lu}/u.test(name)) return name;
  return name.toLowerCase().replace(/(^|[\s\-/(&])(\p{L}+)/gu, (_, before: string, word: string, at: number) =>
    before + (at > 0 && ["and", "of", "the", "with", "on", "in", "a"].includes(word) ? word : word[0].toUpperCase() + word.slice(1)));
}

/** The dotted line from a name to its price, as on a printed menu. */
const DOTS = '<i class="cat-dots" aria-hidden="true"></i>';

/**
 * The catalogue tab: what the business offers, set like a good printed menu:
 * each section under its title (or the business's own photo for it), a name
 * and its price on one line, the description below, sizes as lines of their
 * own. A line opens to its full description and photo; asking Zaina, or
 * ordering through her where the business takes orders online, is inside it
 * and never in the way.
 */
function renderCatalogue(catalogue: DoorCatalogue, view: DoorView): string {
  const assistant = esc(view.assistant);
  const chat = view.chat !== false;
  const pills = catalogue.sections.length > 1
    ? `<div class="cat-pills" role="group" aria-label="Sections"><button type="button" class="cat-pill" data-section="" aria-pressed="true">All</button>${catalogue.sections.map((section) => `<button type="button" class="cat-pill" data-section="${esc(section)}" aria-pressed="false">${esc(sectionTitle(section))}</button>`).join("")}</div>`
    : "";
  // A long list of sections gets a one-tap jump as well as the pills.
  const jump = catalogue.sections.length > 4
    ? `<label class="cat-jump" title="Jump to a section">${ICONS.list}<span class="visually-hidden">Jump to a section</span><select id="cat-jump"><option value="">Jump to…</option>${catalogue.sections.map((section) => `<option value="${esc(section)}">${esc(sectionTitle(section))}</option>`).join("")}</select></label>`
    : "";
  const headed = catalogue.sections.length > 1;
  // With sections, each one's items together under its heading, in the menu's own order (items with none first).
  const ordered = headed
    ? [...catalogue.items.filter((item) => !item.section), ...catalogue.sections.flatMap((name) => catalogue.items.filter((item) => item.section === name))]
    : catalogue.items;
  let previous: string | null = null;
  const cards = ordered.map((item) => {
    // Where each section starts: its title, or the business's own photo for it with its name and the business's.
    const banner = item.section ? catalogue.banners?.[item.section] : undefined;
    const heading = !headed || !item.section || item.section === previous ? ""
      : banner
        ? `<li class="cat-heading cat-banner has-picture" data-heading="${esc(item.section)}" data-backdrop="${esc(banner)}"><img class="cat-banner-img" src="${esc(banner)}" alt="" width="1200" height="480" loading="lazy" decoding="async"><div class="cat-banner-text"><span class="cat-banner-brand">${esc(view.name)}</span><h2>${esc(sectionTitle(item.section))}</h2></div></li>\n`
        : `<li class="cat-heading" data-heading="${esc(item.section)}"><h2>${esc(sectionTitle(item.section))}</h2></li>\n`;
    previous = item.section;
    const search = [item.name, item.description, item.section, ...item.variants.map((variant) => variant.label)].filter(Boolean).join(" ").toLowerCase();
    const thumb = item.picture ? `<img class="cat-thumb" src="${esc(item.picture)}" alt="" width="64" height="64" loading="lazy" decoding="async">` : "";
    const top = `<span class="cat-top"><span class="cat-name">${esc(item.name)}</span>${!item.variants.length && item.price ? `${DOTS}<span class="cat-price">${esc(item.price)}</span>` : ""}</span>`;
    const sizes = item.variants.length
      ? `<span class="cat-variants">${item.variants.map((variant) => `<span class="cat-variant${variant.inStock ? "" : " out"}"><span>${esc(variant.label)}${variant.inStock ? "" : " <em>Out of stock</em>"}</span>${variant.price ? `${DOTS}<b>${esc(variant.price)}</b>` : ""}</span>`).join("")}</span>`
      : "";
    const order = chat && item.order && item.inStock
      ? `<button type="button" class="cat-zaina main" data-ask="${esc(item.order.text)}">${item.order.verb === "book" ? "Book" : "Order"} via ${assistant}</button>`
      : "";
    return `${heading}<li class="cat-item${item.inStock ? "" : " out"}" data-section="${esc(item.section ?? "")}" data-search="${esc(search)}"><details class="cat-card">
<summary>${thumb}<span class="cat-body">${top}${item.description ? `<span class="cat-desc">${esc(item.description)}</span>` : ""}${sizes}${item.inStock ? "" : '<span class="cat-out">Out of stock</span>'}</span></summary>
<div class="cat-more">${item.picture ? `<img class="cat-photo" src="${esc(item.picture)}" alt="${esc(item.name)}" loading="lazy" decoding="async">` : ""}${chat ? `<div class="cat-actions"><button type="button" class="cat-zaina" data-ask="${esc(item.tell)}">Ask ${assistant} about this</button>${order}</div>` : ""}</div>
</details></li>`;
  }).join("\n");
  const on = view.whatsOn;
  const whatsOn = on && (on.today.length || on.soon.length)
    ? `<aside class="whats-on" aria-label="What's on"><p class="whats-on-title">${on.today.length ? `Today at ${esc(view.name)}` : "Coming up"}</p>${on.today.length ? `<ul class="whats-on-today">${on.today.map((text) => `<li>${esc(text)}</li>`).join("")}</ul>` : ""}${on.soon.length ? `<ul class="whats-on-soon">${on.soon.map((entry) => `<li><b>${esc(entry.label)}</b> ${esc(entry.text)}</li>`).join("")}</ul>` : ""}</aside>`
    : "";
  return `<section class="door-catalogue" id="door-catalogue"${chat ? ' role="tabpanel" aria-labelledby="door-tab-catalogue"' : ` aria-label="${esc(catalogue.tab.replace(/^Browse\s+/i, ""))}"`}>
    <div class="cat-tools">
      <label class="cat-search" title="${esc(catalogue.search)}">${ICONS.search}<span class="visually-hidden">${esc(catalogue.search)}</span><input type="search" id="cat-search" placeholder="${esc(catalogue.search)}" autocomplete="off" enterkeyhint="search"></label>${pills}${jump}
    </div>
    ${whatsOn}
    <ul class="cat-list">
${cards}
    </ul>
    <p class="cat-none" id="cat-none" hidden>Nothing matches that.${chat ? ` <button type="button" class="cat-link" data-tab-to="chat">Ask ${assistant}</button> instead.` : ""}</p>
    ${chat ? `<div class="cat-nudge" id="cat-nudge"><button type="button" class="cat-nudge-go" data-tab-to="chat" title="Need a recommendation? Ask ${assistant}">${ICONS.chat}<span>Ask ${assistant}</span></button><button type="button" class="cat-nudge-x" id="cat-nudge-x" aria-label="Hide this">×</button></div>` : ""}
  </section>`;
}

export function renderFrontDoor(view: DoorView): string {
  if (view.chat === false) return renderMenuDoor(view);
  const title = `${view.name} · Chat with ${view.assistant}`;
  const description = `Chat with ${view.assistant}, the ${view.role} at ${view.name}: ask a question, check what's available, or leave your details for the team.`;
  const id = encodeURIComponent(view.businessId);
  const orders = view.catalogue?.items.some((item) => item.order?.verb === "order") ?? false;
  const wordmark = Boolean(view.logoHasName && view.logoUrl);
  // The chat's script and its settings start loading with the page, not after it.
  const widget = `/zaina.js${widgetVersion() ? `?v=${widgetVersion()}` : ""}`;
  const font: TitleFont = view.titleFont && TITLE_FONT_KEYS.includes(view.titleFont) ? view.titleFont : "classic";
  const utility = utilityLine(view, orders);
  return `<!doctype html>
<html lang="en"${view.menuStyle && view.menuStyle !== "auto" ? ` data-menu="${view.menuStyle}"` : ""}${font === "classic" ? "" : ` data-title="${font}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${esc(view.color)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
${view.logoUrl ? `<meta property="og:image" content="${esc(view.logoUrl)}">\n<link rel="icon" href="${esc(view.logoUrl)}">` : `<link rel="icon" href="/site/zaina.svg" type="image/svg+xml">`}
<link rel="preload" href="/c-assets/title-${font}.woff2?v=${TITLE_FONTS[font].version}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/c-assets/door.css?v=${DOOR_ASSETS_VERSION}">
<link rel="stylesheet" href="/c/${id}/brand.css?v=${esc(view.brandVersion)}">
<link rel="preload" href="${widget}" as="script">
<link rel="preload" href="/api/zaina/widget/config?business=${id}" as="fetch" crossorigin="anonymous">
</head>
<body>
<div class="door${view.coverUrl ? " has-cover" : ""}${view.catalogue ? " has-catalogue" : ""}${wordmark ? " has-wordmark" : ""}">
  <header class="door-head">
    ${view.coverUrl ? `<img class="door-cover" src="${esc(view.coverUrl)}" alt="" width="1200" height="600">` : ""}
    <div class="door-brand">
      <span class="door-logo${view.logoUrl ? "" : " letters"}">${view.logoUrl ? `<img src="${esc(view.logoUrl)}" alt="" width="${wordmark ? 240 : 72}" height="${wordmark ? 240 : 72}">` : esc(initials(view.name))}</span>
      <div class="door-name">
        <h1${wordmark ? ' class="visually-hidden"' : ""}>${esc(view.name)}</h1>
        ${view.tagline ? `<p>${esc(view.tagline)}</p>` : ""}
      </div>
    </div>
    ${utility}
    <p class="door-intro">${esc(view.assistant)} is our ${esc(view.role)}. Ask anything, any time: she answers from our own information, and our team is right behind her.</p>
    ${renderPay(view.pay)}
    <p class="door-trust">${ICONS.shield}<span>You pay ${esc(view.name)} directly. ${esc(view.assistant)} never asks for card numbers or PINs.</span></p>
  </header>
  ${view.catalogue ? `<div class="door-main">${view.menuStyle === "backdrop" ? backdropLayer(view) : ""}
  <div class="door-tabs" role="tablist" aria-label="${esc(view.name)}">
    <button type="button" role="tab" id="door-tab-catalogue" aria-controls="door-catalogue" aria-selected="true" data-tab="catalogue">${esc(view.catalogue.tab)}</button>
    <button type="button" role="tab" id="door-tab-chat" aria-controls="zaina-chat" aria-selected="false" data-tab="chat">Ask ${esc(view.assistant)}</button>
  </div>
  ${renderCatalogue(view.catalogue, view)}
  ` : ""}<main class="door-chat" id="zaina-chat"${view.catalogue ? ` role="tabpanel" aria-labelledby="door-tab-chat" hidden` : ` aria-label="Chat with ${esc(view.assistant)}"`}>
    <p class="door-loading" data-door-loading>Opening the chat…</p>
    <noscript><p class="door-loading">The chat needs JavaScript.${view.phoneDisplay ? ` You can also call ${esc(view.phoneDisplay)}.` : ""}</p></noscript>
  </main>${view.catalogue ? "\n  </div>" : ""}
  <footer class="door-foot"><a href="${POWERED_BY.href}" target="_blank" rel="noopener">${POWERED_BY.text}</a></footer>
</div>
${view.catalogue || view.pay ? `<script src="/c-assets/door.js?v=${DOOR_ASSETS_VERSION}" defer></script>\n` : ""}<script src="${widget}" data-business="${esc(view.businessId)}" data-mode="page" data-mount="#zaina-chat" data-via="${view.via}"${view.spot ? ` data-spot="${esc(view.spot)}"` : ""} async></script>
</body>
</html>`;
}

/**
 * The Menu plan's page: the same branded header, menu and What's on, with no
 * chat. No chat script loads, and nothing on the page offers one.
 */
function renderMenuDoor(view: DoorView): string {
  // "Browse Menu" on the tab beside the chat; here, with no tab, just "Menu".
  const tab = (view.catalogue?.tab ?? "Menu").replace(/^Browse\s+/i, "");
  const title = `${view.name} · ${tab}`;
  const description = `The ${tab.toLowerCase()} at ${view.name}${view.tagline ? `: ${view.tagline}` : ""}.`;
  const id = encodeURIComponent(view.businessId);
  const wordmark = Boolean(view.logoHasName && view.logoUrl);
  const font: TitleFont = view.titleFont && TITLE_FONT_KEYS.includes(view.titleFont) ? view.titleFont : "classic";
  const utility = utilityLine(view, false);
  return `<!doctype html>
<html lang="en"${view.menuStyle && view.menuStyle !== "auto" ? ` data-menu="${view.menuStyle}"` : ""}${font === "classic" ? "" : ` data-title="${font}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${esc(view.color)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
${view.logoUrl ? `<meta property="og:image" content="${esc(view.logoUrl)}">\n<link rel="icon" href="${esc(view.logoUrl)}">` : `<link rel="icon" href="/site/zaina.svg" type="image/svg+xml">`}
<link rel="preload" href="/c-assets/title-${font}.woff2?v=${TITLE_FONTS[font].version}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/c-assets/door.css?v=${DOOR_ASSETS_VERSION}">
<link rel="stylesheet" href="/c/${id}/brand.css?v=${esc(view.brandVersion)}">
</head>
<body>
<div class="door menu-only${view.coverUrl ? " has-cover" : ""}${view.catalogue ? " has-catalogue" : ""}${wordmark ? " has-wordmark" : ""}">
  <header class="door-head">
    ${view.coverUrl ? `<img class="door-cover" src="${esc(view.coverUrl)}" alt="" width="1200" height="600">` : ""}
    <div class="door-brand">
      <span class="door-logo${view.logoUrl ? "" : " letters"}">${view.logoUrl ? `<img src="${esc(view.logoUrl)}" alt="" width="${wordmark ? 240 : 72}" height="${wordmark ? 240 : 72}">` : esc(initials(view.name))}</span>
      <div class="door-name">
        <h1${wordmark ? ' class="visually-hidden"' : ""}>${esc(view.name)}</h1>
        ${view.tagline ? `<p>${esc(view.tagline)}</p>` : ""}
      </div>
    </div>
    ${utility}
    ${renderPay(view.pay)}
  </header>
  ${view.catalogue ? `<div class="door-main">${view.menuStyle === "backdrop" ? backdropLayer(view) : ""}
  ${renderCatalogue(view.catalogue, view)}
  </div>` : `<main class="door-chat"><p class="door-loading">Our ${esc(tab.toLowerCase())} is on its way.${view.phoneDisplay ? ` Call us on ${esc(view.phoneDisplay)} in the meantime.` : ""}</p></main>`}
  <footer class="door-foot"><a href="${POWERED_BY.href}" target="_blank" rel="noopener">${POWERED_BY.text}</a></footer>
</div>
${view.catalogue || view.pay ? `<script src="/c-assets/door.js?v=${DOOR_ASSETS_VERSION}" defer></script>\n` : ""}</body>
</html>`;
}

export function renderDoorClosed(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This page isn't available</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/c-assets/door.css?v=${DOOR_ASSETS_VERSION}">
</head>
<body>
<div class="door closed">
  <main class="door-closed">
    <h1>This page isn't available</h1>
    <p>The business may not be taking chats here right now. Check the address or the code you scanned, or contact the business directly.</p>
  </main>
</div>
</body>
</html>`;
}

/** The business's colours, as a stylesheet of its own (the page allows no inline style). */
export function brandCss(color: string): string {
  const brand = /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#0f766e";
  // --accent is the payment page's name for the same colour (in its light theme: its dark theme keeps a colour that reads on dark).
  return `:root{--brand:${brand};--on-brand:${readableOn(brand)}}\n@media (prefers-color-scheme: light){:root{--accent:${brand};--accent-text:${readableOn(brand)}}}\n`;
}

export const DOOR_CSS = String.raw`
${TITLE_FONT_KEYS.map((key) => `@font-face { font-family: "Door ${key}"; src: url(/c-assets/title-${key}.woff2?v=${TITLE_FONTS[key].version}) format("woff2"); font-weight: 100 900; font-style: normal; font-display: swap; }`).join("\n")}
:root { --brand: #0f766e; --on-brand: #ffffff; --bg: #faf8f4; --surface: #ffffff; --ink: #1c1a17; --muted: #6b645a; --line: #e8e2d7; --alert: #b42318;
  --mark: color-mix(in srgb, var(--brand) 78%, var(--ink)); --tint: color-mix(in srgb, var(--brand) 8%, var(--bg)); --sheet: var(--surface);
  --hero: color-mix(in srgb, var(--brand) 6%, var(--bg)); --hero-glow: color-mix(in srgb, var(--brand) 16%, var(--bg));
  --hero-ink: var(--ink); --hero-soft: var(--muted); --hero-veil: color-mix(in srgb, var(--ink) 4%, transparent); --hero-edge: color-mix(in srgb, var(--ink) 14%, transparent);
  --foil-top: var(--ink); --foil-bottom: color-mix(in srgb, var(--brand) 60%, var(--ink)); --hero-rule: var(--mark);
  --display: "Door classic", "Playfair Display", Georgia, "Times New Roman", serif; --title-scale: 1; --title-track: -.005em; --title-weight: 700; --tabs-h: 50px;
  --chip: var(--ink); --chip-ink: var(--sheet); --pill: var(--ink); --pill-ink: var(--sheet); --pill-line: transparent; color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root:not([data-menu="light"]) { --bg: #181613; --surface: #211e1a; --ink: #f4f0e9; --muted: #b0a79b; --line: #35302a; --alert: #ff8f80; --mark: color-mix(in srgb, var(--brand) 62%, #ffffff);
    --hero: color-mix(in srgb, var(--brand) 10%, #15130f); --hero-glow: color-mix(in srgb, var(--brand) 30%, #15130f);
    --hero-ink: #ffffff; --hero-soft: rgba(255, 255, 255, .78); --hero-veil: rgba(255, 255, 255, .1); --hero-edge: rgba(255, 255, 255, .18);
    --foil-top: #ffffff; --foil-bottom: color-mix(in srgb, var(--brand) 42%, #ffffff); --hero-rule: color-mix(in srgb, var(--brand) 60%, #ffffff);
    --chip: var(--mark); --chip-ink: #181613; --pill: #1d1a16; --pill-ink: #f4f0e9; --pill-line: color-mix(in srgb, var(--brand) 50%, transparent); color-scheme: dark; }
}
:root[data-menu="dark"], :root[data-menu="backdrop"] { --bg: #181613; --surface: #211e1a; --ink: #f4f0e9; --muted: #b0a79b; --line: #35302a; --alert: #ff8f80; --mark: color-mix(in srgb, var(--brand) 62%, #ffffff);
    --hero: color-mix(in srgb, var(--brand) 10%, #15130f); --hero-glow: color-mix(in srgb, var(--brand) 30%, #15130f);
    --hero-ink: #ffffff; --hero-soft: rgba(255, 255, 255, .78); --hero-veil: rgba(255, 255, 255, .1); --hero-edge: rgba(255, 255, 255, .18);
    --foil-top: #ffffff; --foil-bottom: color-mix(in srgb, var(--brand) 42%, #ffffff); --hero-rule: color-mix(in srgb, var(--brand) 60%, #ffffff);
    --chip: var(--mark); --chip-ink: #181613; --pill: #1d1a16; --pill-ink: #f4f0e9; --pill-line: color-mix(in srgb, var(--brand) 50%, transparent); color-scheme: dark; }
/* The lettering the business chose, each set to sit at the same visual size. */
:root[data-title="roman"] { --display: "Door roman", Cinzel, "Trajan Pro", Georgia, serif; --title-scale: .88; --title-track: .03em; --title-weight: 600; }
:root[data-title="elegant"] { --display: "Door elegant", "Cormorant Garamond", Garamond, Georgia, serif; --title-scale: 1.16; --title-track: 0em; --title-weight: 600; }
:root[data-title="modern"] { --display: "Door modern", Jost, Futura, "Century Gothic", system-ui, sans-serif; --title-scale: .92; --title-track: .01em; --title-weight: 600; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--tint); -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; }
.door { min-height: 100%; height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 460px); gap: 40px; align-items: center;
  max-width: 1080px; margin: 0 auto; padding: 32px max(24px, env(safe-area-inset-right)) 32px max(24px, env(safe-area-inset-left)); }
.door-head { position: relative; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.door-cover { width: 100%; height: auto; aspect-ratio: 2 / 1; object-fit: cover; border-radius: 22px; display: block; box-shadow: 0 18px 40px -24px rgba(0, 0, 0, .45); }
.door-brand { display: flex; align-items: center; gap: 16px; min-width: 0; }
.door-logo { width: 72px; height: 72px; flex: none; border-radius: 20px; overflow: hidden; background: var(--surface); border: 1px solid var(--line); display: grid; place-items: center;
  box-shadow: 0 8px 22px -14px rgba(0, 0, 0, .5); }
.door-logo img { width: 100%; height: 100%; object-fit: contain; display: block; }
.door-logo.letters { background: var(--brand); color: var(--on-brand); border-color: transparent; font-family: var(--display); font-weight: var(--title-weight); font-synthesis: none; font-size: calc(1.6rem * var(--title-scale)); }
.door-name { min-width: 0; }
/* A logo that spells the name is the heading itself: large, on no plate of ours. */
.has-wordmark .door-brand { flex-direction: column; align-items: flex-start; }
.has-wordmark .door-logo { width: 168px; height: 168px; border-radius: 28px; border: 0; background: transparent; }
.door-name h1 { margin: 0; font-family: var(--display); font-weight: var(--title-weight); font-synthesis: none; font-size: calc(clamp(1.6rem, 1.1rem + 1.8vw, 2.5rem) * var(--title-scale)); line-height: 1.1; letter-spacing: var(--title-track); text-wrap: balance; overflow-wrap: anywhere; }
.door-name p { margin: 6px 0 0; color: var(--muted); font-size: 1.05rem; overflow-wrap: anywhere; }
.door-spot { margin: 0; align-self: flex-start; display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-radius: 14px; background: var(--surface); border: 1px solid var(--line); font-size: .92rem; max-width: 46ch; }
.door-spot svg { color: var(--mark); flex: none; }
.door-intro { margin: 0; max-width: 46ch; color: var(--muted); font-size: 1.02rem; }
.door-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.door-utility { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.door-utility .door-spot { align-self: center; }
.door-pay { display: grid; gap: 1px; padding: 5px 5px 5px 14px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--mark) 55%, transparent); max-width: 46ch; text-align: left; }
.door-pay-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 36px; min-width: 0; }
.door-pay-what { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: .66rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--mark); }
.door-pay-what svg { flex: none; }
.door-pay-number { font-size: 1.06rem; font-weight: 700; letter-spacing: .06em; font-variant-numeric: tabular-nums; -webkit-user-select: all; user-select: all; }
.door-pay-name b { font-weight: 700; letter-spacing: .04em; }
.door-pay-copy { margin-left: auto; flex: none; min-height: 30px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--mark); background: transparent; color: var(--mark); font: inherit; font-size: .76rem; font-weight: 700; letter-spacing: .04em; cursor: pointer; }
.door-pay-copy.done { background: var(--mark); color: var(--sheet); }
.door-pay-name { margin: 0 0 3px; font-size: 11px; letter-spacing: .02em; color: var(--muted); overflow-wrap: anywhere; }
.door-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface);
  color: var(--ink); text-decoration: none; font-weight: 600; font-size: .95rem; transition: border-color .15s ease, transform .15s ease; }
.door-btn:hover { border-color: var(--brand); transform: translateY(-1px); }
.door-btn:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
.door-btn svg { color: var(--mark); flex: none; }
.door-trust { margin: 0; display: flex; gap: 8px; align-items: flex-start; color: var(--muted); font-size: .88rem; max-width: 46ch; }
.door-trust svg { flex: none; margin-top: 3px; color: var(--mark); }
.door-chat { height: min(720px, calc(100dvh - 64px)); min-height: 420px; background: var(--surface); border: 1px solid var(--line); border-radius: 24px; overflow: hidden;
  box-shadow: 0 30px 60px -34px rgba(0, 0, 0, .5); display: flex; flex-direction: column; }
.door-chat #zaina-widget { flex: 1; min-height: 0; display: block; }
.door-loading { margin: auto; padding: 24px; color: var(--muted); text-align: center; }
.door-chat.ready .door-loading { display: none; }
.door.closed { display: grid; grid-template-columns: 1fr; place-items: center; }
.door-closed { max-width: 46ch; text-align: center; }
.door-closed h1 { font-family: var(--display); font-weight: var(--title-weight); font-synthesis: none; font-size: calc(1.7rem * var(--title-scale)); margin: 0 0 10px; }
.door-closed p { color: var(--muted); margin: 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.door-foot { grid-column: 1 / -1; text-align: center; font-size: .78rem; padding: 4px 0 0; }
.door-foot a { color: var(--muted); text-decoration: none; letter-spacing: .02em; }
.door-foot a:hover, .door-foot a:focus-visible { color: var(--ink); text-decoration: underline; }

/* With a catalogue: tabs over the catalogue and the chat, which share the right-hand column. */
.door.has-catalogue { grid-template-rows: 1fr auto; }
.door-main { --sheet: var(--surface); height: min(760px, calc(100dvh - 92px)); min-height: 460px; display: flex; flex-direction: column; background: var(--sheet); border: 1px solid var(--line);
  border-radius: 24px; overflow: hidden; box-shadow: 0 30px 60px -34px rgba(0, 0, 0, .5); min-width: 0; }
.door-main .door-chat { flex: 1; min-height: 0; height: auto; border: none; border-radius: 0; box-shadow: none; }
.door-main [hidden] { display: none !important; }
.door-tabs { flex: none; display: grid; grid-template-columns: 1fr 1fr; height: var(--tabs-h); background: var(--sheet); border-bottom: 1px solid var(--line); }
.door-tabs button { position: relative; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: .95rem; font-weight: 600; cursor: pointer; }
.door-tabs button[aria-selected="true"] { color: var(--ink); }
.door-tabs button[aria-selected="true"]::after { content: ""; position: absolute; left: 50%; bottom: -1px; width: 48px; height: 2px; border-radius: 2px; transform: translateX(-50%); background: var(--mark); }
.door-tabs button:focus-visible { outline: 3px solid var(--mark); outline-offset: -3px; }
.door-catalogue { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }

/* One slim bar that stays on top: search (an icon until it's tapped), the sections, and a jump to any of them. */
.cat-tools { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 10px 16px;
  background: color-mix(in srgb, var(--sheet) 90%, transparent); -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3); border-bottom: 1px solid var(--line); }
.cat-search, .cat-jump { position: relative; flex: none; width: 44px; height: 44px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
.cat-search svg, .cat-jump svg { position: absolute; left: 12px; top: 12px; pointer-events: none; }
/* 16px at least, or iPhones zoom the page in when it's tapped. */
.cat-search input { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: inherit; background: transparent; color: var(--ink); font: inherit; font-size: 16px; padding: 0 12px 0 40px; outline: none; opacity: 0; cursor: pointer; }
.cat-search:focus-within, .cat-search.on, .cat-search:only-child { flex: 1 1 auto; width: auto; }
.cat-search:focus-within { border-color: var(--mark); }
.cat-search:focus-within input, .cat-search.on input, .cat-search:only-child input { opacity: 1; cursor: text; }
.cat-search:focus-within ~ *, .cat-search.on ~ * { display: none; }
.cat-jump select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; font: inherit; font-size: 16px; cursor: pointer; border: 0; }
.cat-jump:focus-within { outline: 3px solid var(--mark); outline-offset: 2px; }
.cat-pills { flex: 1 1 auto; min-width: 0; display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; padding-right: 24px;
  -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); }
.cat-pills.scrolled { -webkit-mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 28px), transparent); }
.cat-pills::-webkit-scrollbar { display: none; }
.cat-pill { flex: none; min-height: 40px; padding: 0 14px; border-radius: 999px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: .92rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.cat-pill[aria-pressed="true"] { background: var(--chip); color: var(--chip-ink); }
.cat-pill:focus-visible { outline: 3px solid var(--mark); outline-offset: 1px; }

/* The menu itself: section titles set in the display face, then name · · · price. */
.cat-list { list-style: none; margin: 0; padding: 0 20px 12px; }
.cat-heading { padding: 34px 0 6px; text-align: center; }
.cat-list > .cat-heading:first-child { padding-top: 24px; }
.cat-heading h2 { margin: 0; font-family: var(--display); font-weight: var(--title-weight); font-synthesis: none; font-size: calc(1.7rem * var(--title-scale)); letter-spacing: var(--title-track); line-height: 1.15; color: var(--ink); text-wrap: balance; overflow-wrap: anywhere; }
.cat-heading h2::after { content: ""; display: block; width: 28px; height: 2px; margin: 12px auto 0; border-radius: 2px; background: var(--mark); }
/* A section with the business's own photo for it: the whole photo, its name over it. */
.cat-banner.has-picture { position: relative; aspect-ratio: 5 / 2; margin: 28px -4px 8px; padding: 0; border-radius: 18px; overflow: hidden; isolation: isolate; text-align: left; background: #111111; }
.cat-list > .cat-banner.has-picture:first-child { margin-top: 16px; }
.cat-banner-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -1; }
.cat-banner.has-picture::after { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(0deg, rgba(0, 0, 0, .72), rgba(0, 0, 0, .08) 72%); }
.cat-banner-text { height: 100%; display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; padding: 14px 18px; color: #ffffff; }
.cat-banner-brand { font-size: .66rem; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; opacity: .85; }
.cat-banner.has-picture h2 { color: #ffffff; font-size: calc(1.8rem * var(--title-scale)); text-shadow: 0 1px 14px rgba(0, 0, 0, .5); }
.cat-banner.has-picture h2::after { margin: 10px 0 0; background: color-mix(in srgb, var(--brand) 55%, #ffffff); }
.cat-item + .cat-item { border-top: 1px solid var(--line); }
/* No line under a title, nor above the first of what a search or a section shows. */
.cat-heading + .cat-item, .cat-item.lead { border-top: 0; }
.cat-card summary { display: flex; gap: 14px; align-items: flex-start; padding: 16px 0; cursor: pointer; list-style: none; }
.cat-card summary::-webkit-details-marker { display: none; }
.cat-card summary:focus-visible { outline: 3px solid var(--mark); outline-offset: 2px; border-radius: 10px; }
/* A light plate behind every photo, so a cut-out with no background still reads in dark mode. */
.cat-thumb { flex: none; width: 64px; height: 64px; border-radius: 12px; object-fit: contain; background: #ffffff; display: block; }
.cat-body { flex: 1; min-width: 0; display: grid; gap: 4px; }
.cat-top { display: flex; align-items: baseline; gap: 10px; }
.cat-name { min-width: 0; font-size: 1.0625rem; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.cat-dots { flex: 1 1 16px; min-width: 16px; border-bottom: 1.5px dotted color-mix(in srgb, var(--muted) 50%, transparent); transform: translateY(-.3em); }
.cat-price { flex: none; font-size: 1rem; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cat-desc { color: var(--muted); font-size: .92rem; line-height: 1.5; max-width: 62ch; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cat-card[open] .cat-desc { display: block; overflow: visible; }
.cat-variants { display: grid; gap: 4px; margin-top: 4px; }
.cat-variant { display: flex; align-items: baseline; gap: 10px; font-size: .95rem; font-variant-numeric: tabular-nums; }
.cat-variant > span { min-width: 0; color: var(--muted); }
.cat-variant b { flex: none; font-weight: 600; white-space: nowrap; }
.cat-variant.out > span, .cat-variant.out b { color: var(--muted); opacity: .7; }
.cat-variant em { font-style: normal; font-size: .72rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--alert); margin-left: 4px; }
.cat-out { justify-self: start; font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--alert); }
.cat-item.out .cat-name, .cat-item.out .cat-price { color: var(--muted); }
.cat-more { display: grid; gap: 14px; padding: 0 0 18px; }
/* The whole picture, never cropped: square like every uploaded one, and an older one of another shape shown whole on white. */
.cat-photo { width: 100%; max-width: 420px; aspect-ratio: 1 / 1; object-fit: contain; border-radius: 16px; background: #ffffff; display: block; }
.cat-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cat-zaina { min-height: 44px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: inherit; font-size: .92rem; font-weight: 600; cursor: pointer; }
.cat-zaina.main { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.cat-zaina:focus-visible { outline: 3px solid var(--mark); outline-offset: 2px; }
.cat-nudge { position: sticky; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); z-index: 2; display: flex; align-items: center; width: max-content; max-width: calc(100% - 32px);
  margin: 12px 16px 14px auto; border-radius: 999px; background: var(--pill); color: var(--pill-ink); border: 1px solid var(--pill-line); box-shadow: 0 12px 28px -10px rgba(0, 0, 0, .55); }
.cat-nudge-go { display: inline-flex; align-items: center; gap: 8px; border: 0; background: none; color: inherit; font: inherit; font-size: .92rem; font-weight: 600; min-height: 44px; padding: 0 2px 0 16px; cursor: pointer; }
.cat-nudge-x { flex: none; border: 0; background: none; color: inherit; font: inherit; font-size: 1.2rem; line-height: 1; width: 40px; height: 44px; border-radius: 999px; cursor: pointer; opacity: .65; }
.cat-nudge button:focus-visible { outline: 3px solid var(--mark); outline-offset: -3px; }
.cat-nudge { transition: opacity .2s ease, transform .2s ease, visibility .2s; }
.cat-nudge.away { opacity: 0; visibility: hidden; transform: translateY(10px); pointer-events: none; }
.cat-none { margin: 28px 16px; color: var(--muted); text-align: center; }
/* What's on: today's special and tonight's event, posted by the team, above the menu (hidden while the guest filters). */
.whats-on { margin: 20px 20px 0; padding: 16px 18px; border: 1px solid color-mix(in srgb, var(--brand) 35%, var(--line)); border-radius: 16px; background: color-mix(in srgb, var(--brand) 6%, var(--sheet)); text-align: center; }
.whats-on-title { margin: 0 0 8px; font-size: .7rem; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: var(--mark); }
.whats-on ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.whats-on-today li { text-wrap: balance; font-family: var(--display); font-weight: var(--title-weight); font-synthesis: none; font-size: calc(1.15rem * var(--title-scale)); letter-spacing: var(--title-track); line-height: 1.3; overflow-wrap: anywhere; }
.whats-on-today + .whats-on-soon { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.whats-on-soon li { font-size: .9rem; color: var(--muted); overflow-wrap: anywhere; }
.whats-on-soon b { color: var(--ink); font-weight: 600; margin-right: 6px; }
.door-catalogue.filtering .whats-on { display: none; }
.cat-link { border: 0; background: none; padding: 0; font: inherit; color: var(--ink); font-weight: 650; text-decoration: underline; text-decoration-color: var(--mark); cursor: pointer; min-height: 44px; }

/* "Dark, over your photos": the photo blurred once on a single layer and dimmed, glass cards over it.
   Only the small sticky bar blurs what's behind it, so scrolling stays smooth on any phone. */
.cat-backdrop { display: none; }
[data-menu="backdrop"] .door-main { --sheet: #121110; position: relative; background: #0b0a09; }
[data-menu="backdrop"] .cat-backdrop { display: block; position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
  background: radial-gradient(120% 90% at 20% 0%, color-mix(in srgb, var(--brand) 45%, #000000), #0b0a09 70%); }
[data-menu="backdrop"] .cat-backdrop img { position: absolute; inset: -40px; width: calc(100% + 80px); height: calc(100% + 80px); object-fit: cover; filter: blur(18px) saturate(1.15); opacity: 0; transition: opacity .5s ease; }
[data-menu="backdrop"] .cat-backdrop img.on { opacity: 1; }
[data-menu="backdrop"] .cat-backdrop::after { content: ""; position: absolute; inset: 0; background: rgba(8, 7, 6, .74); }
[data-menu="backdrop"] .door-tabs, [data-menu="backdrop"] .door-catalogue, [data-menu="backdrop"] .door-chat { position: relative; z-index: 1; }
[data-menu="backdrop"] .door-tabs { background: rgba(12, 11, 10, .55); border-bottom-color: rgba(255, 255, 255, .08); }
[data-menu="backdrop"] .door-catalogue { background: transparent; }
[data-menu="backdrop"] .cat-tools { background: rgba(12, 11, 10, .6); border-bottom-color: rgba(255, 255, 255, .08); }
[data-menu="backdrop"] .cat-search, [data-menu="backdrop"] .cat-jump { background: rgba(255, 255, 255, .06); border-color: rgba(255, 255, 255, .14); }
[data-menu="backdrop"] .cat-heading h2 { color: #ffffff; text-shadow: 0 2px 18px rgba(0, 0, 0, .6); }
[data-menu="backdrop"] .whats-on { background: rgba(20, 18, 16, .74); border-color: rgba(255, 255, 255, .12); }
[data-menu="backdrop"] .cat-item, [data-menu="backdrop"] .cat-item + .cat-item { margin: 8px 0; padding: 0 16px; border: 1px solid rgba(255, 255, 255, .08); border-radius: 16px;
  background: rgba(20, 18, 16, .72); box-shadow: 0 10px 30px -18px rgba(0, 0, 0, .8); }
@media (prefers-reduced-transparency: reduce) {
  [data-menu="backdrop"] .cat-item, [data-menu="backdrop"] .cat-tools { background: #171513; -webkit-backdrop-filter: none; backdrop-filter: none; }
}
@media (prefers-reduced-motion: reduce) { [data-menu="backdrop"] .cat-backdrop img { transition: none; } .door-btn, .cat-nudge { transition: none; } .door-btn:hover { transform: none; } }

@media (max-width: 860px) {
  body { background: var(--surface); }
  .door { display: flex; flex-direction: column; align-items: stretch; gap: 0; padding: 0; max-width: none; }
  /* A page that's only the chat: the business's colour across the top, the chat below. */
  .door-head { flex: none; gap: 0; padding: calc(14px + env(safe-area-inset-top, 0px)) 16px 14px; color: var(--on-brand);
    background: linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 88%, var(--on-brand))); }
  .door-head .door-name h1 { color: var(--on-brand); }
  .door-head .door-name p { color: color-mix(in srgb, var(--on-brand) 82%, transparent); }
  .door-head .door-logo.letters { background: var(--on-brand); color: var(--brand); }
  .door-head .door-btn { background: color-mix(in srgb, var(--on-brand) 14%, transparent); color: var(--on-brand); border-color: color-mix(in srgb, var(--on-brand) 35%, transparent); }
  .door-head .door-btn svg { color: currentColor; }
  .door-logo { width: 46px; height: 46px; border-radius: 13px; }
  .door-logo.letters { font-size: calc(1.15rem * var(--title-scale)); }
  .has-wordmark .door-brand { flex-direction: row; align-items: center; }
  .has-wordmark .door-logo { width: 72px; height: 72px; border-radius: 16px; }
  .door-brand { gap: 12px; }
  .door-name h1 { font-size: calc(1.3rem * var(--title-scale)); }
  .door-name p { font-size: .9rem; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .door-intro, .door-trust { display: none; }
  .door-actions { margin-top: 10px; gap: 8px; }
  .door-btn { min-height: 40px; padding: 0 13px; font-size: .88rem; flex: 1; justify-content: center; }
  .door-chat { flex: 1; min-height: 0; height: auto; border: none; border-radius: 0; box-shadow: none; }
  .has-cover .door-head { overflow: hidden; }
  .has-cover .door-cover { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: auto; border-radius: 0; box-shadow: none; opacity: .28; }
  .has-cover .door-brand, .has-cover .door-actions { position: relative; }
  .door-foot { flex: none; padding: 6px 0 calc(6px + env(safe-area-inset-bottom, 0px)); background: var(--surface); border-top: 1px solid var(--line); }

  /* With a catalogue the whole page scrolls, like a menu in the hand: the name and photo pass by, the bar stays on top. */
  body:has(.has-catalogue) { background: var(--bg); }
  .door.has-catalogue { display: block; height: auto; min-height: 100%; background: var(--bg); }
  .has-catalogue .door-head { z-index: 3; align-items: center; text-align: center; padding: calc(20px + env(safe-area-inset-top, 0px)) 18px 16px; color: var(--hero-ink); overflow: hidden; isolation: isolate;
    background: radial-gradient(130% 95% at 50% 0%, var(--hero-glow), var(--hero) 72%); border-bottom: 1px solid var(--line); }
  /* Over the business's cover photo the header is always dark, so its name reads. */
  .has-catalogue.has-cover .door-head { --hero-ink: #ffffff; --hero-soft: rgba(255, 255, 255, .8); --hero-veil: rgba(255, 255, 255, .12); --hero-edge: rgba(255, 255, 255, .2);
    --foil-top: #ffffff; --foil-bottom: color-mix(in srgb, var(--brand) 42%, #ffffff); --hero-rule: color-mix(in srgb, var(--brand) 60%, #ffffff); }
  .has-catalogue .door-brand { flex-direction: column; gap: 12px; }
  .has-catalogue .door-logo { width: 76px; height: 76px; border-radius: 22px; border: 0; box-shadow: 0 0 0 1px var(--hero-edge), 0 16px 32px -16px rgba(0, 0, 0, .55); }
  .has-catalogue .door-logo.letters { background: var(--brand); color: var(--on-brand); font-size: calc(2rem * var(--title-scale)); }
  .has-catalogue .door-name h1 { color: var(--hero-ink); font-size: calc(clamp(2rem, 1.3rem + 3.4vw, 2.6rem) * var(--title-scale));
    background: linear-gradient(180deg, var(--foil-top) 10%, var(--foil-bottom) 90%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  /* A fine line in the business's colour, inset like the edge of a menu's cover. */
  .has-catalogue .door-head::before { content: ""; position: absolute; inset: calc(10px + env(safe-area-inset-top, 0px)) 10px 10px; border: 1px solid color-mix(in srgb, var(--brand) 42%, transparent); border-radius: 18px; pointer-events: none; }
  .has-catalogue.has-wordmark .door-brand { flex-direction: column; }
  .has-catalogue.has-wordmark .door-logo { width: min(112px, 31vw); height: auto; aspect-ratio: 1 / 1; border-radius: 24px; box-shadow: 0 22px 44px -24px rgba(0, 0, 0, .6); }
  .has-catalogue .door-name p { color: var(--hero-soft); white-space: normal; font-size: .74rem; font-weight: 600; letter-spacing: .22em; text-transform: uppercase; margin-top: 8px; }
  .has-catalogue .door-name::after { content: ""; display: block; width: 36px; height: 2px; margin: 10px auto 0; border-radius: 2px; background: var(--hero-rule); }
  /* One slim line: the table and the call, side by side. */
  .has-catalogue .door-utility { justify-content: center; margin-top: 12px; }
  .has-catalogue .door-spot { margin: 0; min-height: 36px; padding: 0 14px; border-radius: 999px; background: var(--hero-veil); border: 1px solid var(--hero-edge); color: var(--hero-ink); text-align: left; font-size: .86rem; max-width: 100%; }
  .has-catalogue .door-spot svg { color: currentColor; }
  .has-catalogue .door-spot-more { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .has-catalogue .door-btn { flex: none; min-height: 36px; padding: 0 14px; font-size: .86rem; background: var(--hero-veil); color: var(--hero-ink); border-color: var(--hero-edge); }
  .has-catalogue .door-btn-detail { display: none; }
  /* M-Pesa: a hairline strip in the brand's colour, not a box. */
  .has-catalogue .door-pay { align-self: center; width: 100%; max-width: 340px; margin-top: 10px; border-color: color-mix(in srgb, var(--hero-rule) 60%, transparent); color: var(--hero-ink); }
  .has-catalogue .door-pay-what, .has-catalogue .door-pay-copy { color: var(--hero-rule); }
  .has-catalogue .door-pay-copy { border-color: var(--hero-rule); }
  .has-catalogue .door-pay-copy.done { background: var(--hero-rule); color: var(--hero); }
  .has-catalogue .door-pay-name { color: var(--hero-soft); }
  .has-catalogue.has-cover .door-cover { z-index: -1; opacity: 1; }
  .has-catalogue.has-cover .door-head::after { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, rgba(0, 0, 0, .42), rgba(0, 0, 0, .74)); }
  .has-catalogue .door-main { --sheet: var(--bg); display: block; height: auto; min-height: 0; overflow: visible; border: 0; border-radius: 0; box-shadow: none; }
  .has-catalogue .door-catalogue { overflow: visible; }
  .has-catalogue .door-chat { height: calc(100dvh - var(--tabs-h)); min-height: 380px; }
  .has-catalogue .cat-tools { top: env(safe-area-inset-top, 0px); }
  .has-catalogue .door-foot { padding: 24px 0 calc(28px + env(safe-area-inset-bottom, 0px)); background: transparent; border: 0; }
  /* What's on and the first section, sooner: the food starts on the first screen. */
  .has-catalogue .whats-on { margin: 14px 16px 0; padding: 12px 16px; }
  .has-catalogue .whats-on-title { margin-bottom: 6px; }
  .has-catalogue .whats-on ul { gap: 4px; }
  .has-catalogue .whats-on-today li { font-size: calc(1.05rem * var(--title-scale)); }
  .has-catalogue .whats-on-today + .whats-on-soon { margin-top: 8px; padding-top: 8px; }
  .has-catalogue .cat-heading { padding-top: 24px; }
  .has-catalogue .cat-heading h2::after { margin-top: 10px; }
  /* "Dark, over your photos" on a phone: the photo stays put behind the menu as it scrolls. */
  [data-menu="backdrop"] .has-catalogue .cat-backdrop { position: fixed; }
  [data-menu="backdrop"] .has-catalogue .door-foot { position: relative; z-index: 1; }
}
`;

/**
 * The page's own script (the page allows no inline script): the two tabs,
 * the section pills, the jump and the search, and the buttons that ask
 * Zaina about an item. Plain JavaScript, no build step; the page works
 * without it as a menu to read.
 */
export const DOOR_JS = String.raw`(function () {
  "use strict";
  // The till or Paybill, copied in one tap (where the phone allows it; the number can always be selected).
  if (navigator.clipboard) document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.hidden = false;
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(button.getAttribute("data-copy") || "").then(function () {
        button.textContent = "Copied";
        button.classList.add("done");
        setTimeout(function () { button.textContent = "Copy"; button.classList.remove("done"); }, 1800);
      }, function () { /* not allowed: the number stays selectable */ });
    });
  });
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
  var panels = { catalogue: document.getElementById("door-catalogue"), chat: document.getElementById("zaina-chat") };
  var main = document.querySelector(".door-main");
  if (!panels.catalogue || !main) return;
  // On the Menu plan the page is the menu alone: no tabs and no chat.
  var chatOn = tabs.length > 0 && Boolean(panels.chat);
  // On a phone the whole page scrolls (the menu's own box does on a wide screen).
  function pageScrolls() { return getComputedStyle(panels.catalogue).overflowY === "visible"; }
  function scrollUp(to, always) {
    var top = to.getBoundingClientRect().top + window.scrollY;
    if (always || window.scrollY > top) window.scrollTo(0, top);
  }
  function show(name, focus) {
    if (!chatOn) return;
    tabs.forEach(function (tab) {
      var on = tab.getAttribute("data-tab") === name;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    panels.catalogue.hidden = name !== "catalogue";
    panels.chat.hidden = name !== "chat";
    // The chat fills the screen under the tabs; back on the menu, its top.
    if (pageScrolls()) scrollUp(main, name === "chat");
  }
  tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () { show(tab.getAttribute("data-tab"), false); });
    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      var next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      show(next.getAttribute("data-tab"), true);
    });
  });
  document.querySelectorAll("[data-tab-to]").forEach(function (link) {
    link.addEventListener("click", function () { show(link.getAttribute("data-tab-to"), false); });
  });
  if (location.hash === "#chat" || location.hash === "#zaina") show("chat", false);

  // Filter: a section pill and the search words, together; the list starts again at its top.
  var items = Array.prototype.slice.call(document.querySelectorAll(".cat-item"));
  var pills = Array.prototype.slice.call(document.querySelectorAll(".cat-pill"));
  var search = document.getElementById("cat-search");
  var none = document.getElementById("cat-none");
  var headings = Array.prototype.slice.call(document.querySelectorAll(".cat-heading"));
  var section = "";
  // What the guest chose comes into view: the bar at the top of the screen, what it shows right under it.
  function toListTop() {
    if (pageScrolls()) scrollUp(panels.catalogue, true);
    else panels.catalogue.scrollTop = 0;
  }
  function apply() {
    var words = (search && search.value ? search.value : "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    var shown = 0;
    items.forEach(function (item) {
      var text = item.getAttribute("data-search") || "";
      var ok = (!section || item.getAttribute("data-section") === section) && words.every(function (word) { return text.indexOf(word) !== -1; });
      item.hidden = !ok;
      if (ok) shown += 1;
    });
    if (none) none.hidden = shown > 0;
    panels.catalogue.classList.toggle("filtering", Boolean(section) || words.length > 0);
    var group = null;
    items.forEach(function (item) {
      if (item.hidden) return;
      var name = item.getAttribute("data-section");
      item.classList.toggle("lead", group === null || name !== group);
      group = name;
    });
    headings.forEach(function (heading) {
      var name = heading.getAttribute("data-heading");
      heading.hidden = (Boolean(section) && name !== section) || !items.some(function (item) { return !item.hidden && item.getAttribute("data-section") === name; });
    });
  }
  var jump = document.getElementById("cat-jump");
  function choose(value, from) {
    section = value;
    pills.forEach(function (pill) {
      var on = (pill.getAttribute("data-section") || "") === value;
      pill.setAttribute("aria-pressed", on ? "true" : "false");
      // The chosen one comes into the middle of the row (both measured from the same bar).
      var row = pill.parentNode;
      if (on && from !== "pill" && row && row.scrollTo) row.scrollTo({ left: pill.offsetLeft - row.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2 });
    });
    if (jump && from !== "jump") jump.value = value;
    apply();
    toListTop();
  }
  pills.forEach(function (pill) {
    pill.addEventListener("click", function () { choose(pill.getAttribute("data-section") || "", "pill"); });
  });
  // The row fades at an edge only where there's more to scroll to.
  var row = document.querySelector(".cat-pills");
  if (row) row.addEventListener("scroll", function () { row.classList.toggle("scrolled", row.scrollLeft > 4); }, { passive: true });
  if (jump) jump.addEventListener("change", function () { choose(jump.value, "jump"); });
  if (search) {
    // The search stays open while it holds words; Escape clears it.
    var box = search.parentNode;
    var typed = function () {
      box.classList.toggle("on", Boolean(search.value));
      apply();
      toListTop();
    };
    search.addEventListener("input", typed);
    search.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { search.value = ""; typed(); search.blur(); }
      if (event.key === "Enter") search.blur();
    });
  }

  // Asking Zaina is optional: a button inside an opened line, or the small pill at the bottom.
  function ask(text, tries) {
    var zaina = window.Zaina;
    if (zaina && typeof zaina.ask === "function") { zaina.ask(text); return; }
    if (tries > 0) setTimeout(function () { ask(text, tries - 1); }, 200);
  }
  document.querySelectorAll(".cat-zaina").forEach(function (button) {
    button.addEventListener("click", function () {
      show("chat", false);
      ask(button.getAttribute("data-ask") || "", 50);
    });
  });
  var nudge = document.getElementById("cat-nudge");
  var hide = document.getElementById("cat-nudge-x");
  try { if (nudge && sessionStorage.getItem("door-nudge") === "hidden") nudge.hidden = true; } catch (error) { /* no storage */ }
  if (nudge && hide) hide.addEventListener("click", function () {
    nudge.hidden = true;
    try { sessionStorage.setItem("door-nudge", "hidden"); } catch (error) { /* no storage */ }
  });
  // An open dish has its own Ask and Order buttons: the floating one steps aside so it never covers them.
  if (nudge) document.querySelectorAll(".cat-card").forEach(function (card) {
    card.addEventListener("toggle", function () { nudge.classList.toggle("away", Boolean(document.querySelector(".cat-card[open]"))); });
  });

  // "Dark, over your photos": the backdrop shows the cover photo, then each section's own as it comes into view.
  var backdrop = document.getElementById("cat-backdrop-img");
  if (backdrop) {
    var current = backdrop.getAttribute("src") || "";
    var reveal = function () { backdrop.classList.add("on"); };
    if (current) { if (backdrop.complete && backdrop.naturalWidth) reveal(); else backdrop.addEventListener("load", reveal); }
    var swap = function (src) {
      if (!src || src === current) return;
      current = src;
      var next = new Image();
      next.onload = function () {
        backdrop.classList.remove("on");
        setTimeout(function () { backdrop.src = src; reveal(); }, 200);
      };
      next.src = src;
    };
    if ("IntersectionObserver" in window) {
      // The screen itself, whether the page scrolls or the menu's box does.
      var watcher = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { if (entry.isIntersecting) swap(entry.target.getAttribute("data-backdrop")); });
      }, { rootMargin: "0px 0px -60% 0px" });
      Array.prototype.forEach.call(document.querySelectorAll("[data-backdrop]"), function (banner) { watcher.observe(banner); });
    }
  }
})();
`;

/** Changes whenever the page's look or script does, so phones keep them until then and get a new one at once. */
export const DOOR_ASSETS_VERSION = createHash("sha256").update(DOOR_CSS).update(DOOR_JS).digest("hex").slice(0, 12);

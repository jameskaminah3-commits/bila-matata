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

import { readableOn } from "../brand/assets.ts";
import type { DoorCatalogue } from "./catalogue.ts";

const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type DoorView = {
  businessId: string;
  name: string;
  tagline: string | null;
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
  /** Where the customer is, from the code they scanned ("Table 5"). */
  spot?: string | null;
};

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
  pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
};

/**
 * The catalogue tab: what the business offers, to browse quietly. A card
 * opens to its full description and photo; asking Zaina, or ordering
 * through her where the business takes orders online, is inside it and
 * never in the way.
 */
function renderCatalogue(catalogue: DoorCatalogue, view: DoorView): string {
  const assistant = esc(view.assistant);
  const pills = catalogue.sections.length > 1
    ? `<div class="cat-pills" role="group" aria-label="Sections"><button type="button" class="cat-pill" data-section="" aria-pressed="true">All</button>${catalogue.sections.map((section) => `<button type="button" class="cat-pill" data-section="${esc(section)}" aria-pressed="false">${esc(section)}</button>`).join("")}</div>`
    : "";
  // A long list of sections gets a one-tap jump as well as the pills.
  const jump = catalogue.sections.length > 4
    ? `<label class="cat-jump"><span class="visually-hidden">Jump to a section</span><select id="cat-jump"><option value="">Jump to…</option>${catalogue.sections.map((section) => `<option value="${esc(section)}">${esc(section)}</option>`).join("")}</select></label>`
    : "";
  const orders = catalogue.items.some((item) => item.order?.verb === "order");
  const cards = catalogue.items.map((item) => {
    const search = [item.name, item.description, item.section, ...item.variants.map((variant) => variant.label)].filter(Boolean).join(" ").toLowerCase();
    const visual = item.picture
      ? `<img class="cat-thumb" src="${esc(item.picture)}" alt="" width="64" height="64" loading="lazy" decoding="async">`
      : `<span class="cat-mono" aria-hidden="true">${esc(initials(item.name))}</span>`;
    const prices = item.variants.length
      ? `<span class="cat-variants">${item.variants.map((variant) => `<span class="cat-variant${variant.inStock ? "" : " out"}">${esc(variant.label)}${variant.price ? ` <b>${esc(variant.price)}</b>` : ""}${variant.inStock ? "" : " <em>Out of stock</em>"}</span>`).join("")}</span>`
      : item.price ? `<span class="cat-price">${esc(item.price)}</span>` : "";
    const order = item.order && item.inStock
      ? `<button type="button" class="cat-zaina main" data-ask="${esc(item.order.text)}">${item.order.verb === "book" ? "Book" : "Order"} via ${assistant}</button>`
      : "";
    return `<li class="cat-item${item.inStock ? "" : " out"}" data-section="${esc(item.section ?? "")}" data-search="${esc(search)}"><details class="cat-card">
<summary>${visual}<span class="cat-body"><span class="cat-name">${esc(item.name)}</span>${item.description ? `<span class="cat-desc">${esc(item.description)}</span>` : ""}${prices}</span>${item.inStock ? "" : '<span class="cat-out">Out of stock</span>'}</summary>
<div class="cat-more">${item.picture ? `<img class="cat-photo" src="${esc(item.picture)}" alt="${esc(item.name)}" loading="lazy" decoding="async">` : ""}<div class="cat-actions"><button type="button" class="cat-zaina" data-ask="${esc(item.tell)}">Ask ${assistant} about this</button>${order}</div></div>
</details></li>`;
  }).join("\n");
  const spot = view.spot ? `<p class="door-spot">${ICONS.pin}<span>You're at <strong>${esc(view.spot)}</strong>.${orders ? " Anything you order here is brought to you." : ""}</span></p>` : "";
  return `<section class="door-catalogue" id="door-catalogue" role="tabpanel" aria-labelledby="door-tab-catalogue">
    ${spot}
    <div class="cat-tools">
      <div class="cat-row"><label class="cat-search">${ICONS.search}<span class="visually-hidden">${esc(catalogue.search)}</span><input type="search" id="cat-search" placeholder="${esc(catalogue.search)}" autocomplete="off" enterkeyhint="search"></label>${jump}</div>
      ${pills}
    </div>
    <ul class="cat-list">
${cards}
    </ul>
    <p class="cat-none" id="cat-none" hidden>Nothing matches that. <button type="button" class="cat-link" data-tab-to="chat">Ask ${assistant}</button> instead.</p>
    <div class="cat-nudge" id="cat-nudge"><button type="button" class="cat-nudge-go" data-tab-to="chat">Need a recommendation? Ask ${assistant}</button><button type="button" class="cat-nudge-x" id="cat-nudge-x" aria-label="Hide this">×</button></div>
  </section>`;
}

export function renderFrontDoor(view: DoorView): string {
  const title = `${view.name} · Chat with ${view.assistant}`;
  const description = `Chat with ${view.assistant}, the ${view.role} at ${view.name}: ask a question, check what's available, or leave your details for the team.`;
  const id = encodeURIComponent(view.businessId);
  const contact = [
    view.phone && view.phoneDisplay ? `<a class="door-btn" href="tel:${esc(view.phone)}">${ICONS.phone}<span>Call ${esc(view.phoneDisplay)}</span></a>` : "",
    view.whatsapp ? `<a class="door-btn" href="${esc(view.whatsapp)}" target="_blank" rel="noopener noreferrer">${ICONS.whatsapp}<span>WhatsApp</span></a>` : "",
  ].filter(Boolean).join("");
  return `<!doctype html>
<html lang="en">
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
<link rel="stylesheet" href="/c-assets/door.css">
<link rel="stylesheet" href="/c/${id}/brand.css?v=${esc(view.brandVersion)}">
</head>
<body>
<div class="door${view.coverUrl ? " has-cover" : ""}${view.catalogue ? " has-catalogue" : ""}">
  <header class="door-head">
    ${view.coverUrl ? `<img class="door-cover" src="${esc(view.coverUrl)}" alt="" width="1200" height="600">` : ""}
    <div class="door-brand">
      <span class="door-logo${view.logoUrl ? "" : " letters"}">${view.logoUrl ? `<img src="${esc(view.logoUrl)}" alt="" width="72" height="72">` : esc(initials(view.name))}</span>
      <div class="door-name">
        <h1>${esc(view.name)}</h1>
        ${view.tagline ? `<p>${esc(view.tagline)}</p>` : ""}
      </div>
    </div>
    <p class="door-intro">${esc(view.assistant)} is our ${esc(view.role)}. Ask anything, any time: she answers from our own information, and our team is right behind her.</p>
    ${contact ? `<div class="door-actions">${contact}</div>` : ""}
    <p class="door-trust">${ICONS.shield}<span>You pay ${esc(view.name)} directly. ${esc(view.assistant)} never asks for card numbers or PINs.</span></p>
  </header>
  ${view.catalogue ? `<div class="door-main">
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
${view.catalogue ? `<script src="/c-assets/door.js" defer></script>\n` : ""}<script src="/zaina.js" data-business="${esc(view.businessId)}" data-mode="page" data-mount="#zaina-chat" data-via="${view.via}"${view.spot ? ` data-spot="${esc(view.spot)}"` : ""} async></script>
</body>
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
<link rel="stylesheet" href="/c-assets/door.css">
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
:root { --brand: #0f766e; --on-brand: #ffffff; --bg: #f6f5f1; --surface: #ffffff; --ink: #111a17; --muted: #5b6763; --line: #e4e2da; --alert: #b42318;
  --tint: color-mix(in srgb, var(--brand) 9%, var(--bg)); color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0e1412; --surface: #151d1a; --ink: #f1f4f2; --muted: #a3afab; --line: #26312d; --alert: #ff8f80; color-scheme: dark; }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--tint); -webkit-font-smoothing: antialiased; }
.door { min-height: 100%; height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 460px); gap: 40px; align-items: center;
  max-width: 1080px; margin: 0 auto; padding: 32px max(24px, env(safe-area-inset-right)) 32px max(24px, env(safe-area-inset-left)); }
.door-head { position: relative; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.door-cover { width: 100%; height: auto; aspect-ratio: 2 / 1; object-fit: cover; border-radius: 22px; display: block; box-shadow: 0 18px 40px -24px rgba(0, 0, 0, .45); }
.door-brand { display: flex; align-items: center; gap: 16px; min-width: 0; }
.door-logo { width: 72px; height: 72px; flex: none; border-radius: 20px; overflow: hidden; background: var(--surface); border: 1px solid var(--line); display: grid; place-items: center;
  box-shadow: 0 8px 22px -14px rgba(0, 0, 0, .5); }
.door-logo img { width: 100%; height: 100%; object-fit: contain; display: block; }
.door-logo.letters { background: var(--brand); color: var(--on-brand); border-color: transparent; font-weight: 700; font-size: 1.5rem; letter-spacing: .02em; }
.door-name { min-width: 0; }
.door-name h1 { margin: 0; font-size: clamp(1.5rem, 1.1rem + 1.6vw, 2.25rem); line-height: 1.12; letter-spacing: -.02em; text-wrap: balance; overflow-wrap: anywhere; }
.door-name p { margin: 6px 0 0; color: var(--muted); font-size: 1.05rem; overflow-wrap: anywhere; }
.door-intro { margin: 0; max-width: 46ch; color: var(--muted); font-size: 1.02rem; }
.door-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.door-btn { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface);
  color: var(--ink); text-decoration: none; font-weight: 600; font-size: .95rem; transition: border-color .15s ease, transform .15s ease; }
.door-btn:hover { border-color: var(--brand); transform: translateY(-1px); }
.door-btn:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
.door-btn svg { color: var(--brand); flex: none; }
.door-trust { margin: 0; display: flex; gap: 8px; align-items: flex-start; color: var(--muted); font-size: .88rem; max-width: 46ch; }
.door-trust svg { flex: none; margin-top: 3px; color: var(--brand); }
.door-chat { height: min(720px, calc(100dvh - 64px)); min-height: 420px; background: var(--surface); border: 1px solid var(--line); border-radius: 24px; overflow: hidden;
  box-shadow: 0 30px 60px -34px rgba(0, 0, 0, .5); display: flex; flex-direction: column; }
.door-chat #zaina-widget { flex: 1; min-height: 0; display: block; }
.door-loading { margin: auto; padding: 24px; color: var(--muted); text-align: center; }
.door-chat.ready .door-loading { display: none; }
.door.closed { display: grid; grid-template-columns: 1fr; place-items: center; }
.door-closed { max-width: 46ch; text-align: center; }
.door-closed h1 { font-size: 1.6rem; margin: 0 0 10px; }
.door-closed p { color: var(--muted); margin: 0; }
@media (max-width: 860px) {
  body { background: var(--surface); }
  .door { display: flex; flex-direction: column; align-items: stretch; gap: 0; padding: 0; max-width: none; }
  .door-head { flex: none; gap: 0; padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 12px; background: var(--tint); border-bottom: 1px solid var(--line); }
  .door-logo { width: 46px; height: 46px; border-radius: 13px; }
  .door-logo.letters { font-size: 1.05rem; }
  .door-brand { gap: 12px; }
  .door-name h1 { font-size: 1.15rem; }
  .door-name p { font-size: .9rem; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .door-intro, .door-trust { display: none; }
  .door-actions { margin-top: 10px; gap: 8px; }
  .door-btn { min-height: 40px; padding: 0 13px; font-size: .88rem; flex: 1; justify-content: center; }
  .door-chat { flex: 1; min-height: 0; height: auto; border: none; border-radius: 0; box-shadow: none; }
  /* The cover becomes the header's ground, under a wash of the page colour so the name stays readable. */
  .has-cover .door-head { overflow: hidden; }
  .has-cover .door-cover { position: absolute; inset: 0; width: 100%; height: 100%; aspect-ratio: auto; border-radius: 0; box-shadow: none; opacity: .28; }
  .has-cover .door-brand, .has-cover .door-actions { position: relative; }
}
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.door-foot { grid-column: 1 / -1; text-align: center; font-size: .78rem; padding: 4px 0 0; }
.door-foot a { color: var(--muted); text-decoration: none; }
.door-foot a:hover, .door-foot a:focus-visible { color: var(--ink); text-decoration: underline; }
/* With a catalogue: tabs over the catalogue and the chat, which share the right-hand column. */
.door.has-catalogue { grid-template-rows: 1fr auto; }
.door-main { height: min(760px, calc(100dvh - 92px)); min-height: 460px; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line);
  border-radius: 24px; overflow: hidden; box-shadow: 0 30px 60px -34px rgba(0, 0, 0, .5); min-width: 0; }
.door-main .door-chat { flex: 1; min-height: 0; height: auto; border: none; border-radius: 0; box-shadow: none; }
.door-main [hidden] { display: none !important; }
.door-tabs { flex: none; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 6px; background: var(--tint); border-bottom: 1px solid var(--line); }
.door-tabs button { min-height: 44px; border: 0; border-radius: 14px; background: transparent; color: var(--muted); font: inherit; font-weight: 650; font-size: .95rem; cursor: pointer; }
.door-tabs button[aria-selected="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 2px 8px -4px rgba(0, 0, 0, .35); }
.door-tabs button:focus-visible { outline: 3px solid var(--brand); outline-offset: -3px; }
.door-catalogue { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.door-spot { margin: 12px 16px 0; padding: 10px 12px; border-radius: 12px; background: var(--tint); display: flex; gap: 8px; align-items: center; font-size: .92rem; }
.door-spot svg { color: var(--brand); flex: none; }
.cat-tools { position: sticky; top: 0; z-index: 1; background: var(--surface); padding: 12px 16px 10px; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid var(--line); }
.cat-search { display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 0 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--muted); }
.cat-search:focus-within { border-color: var(--brand); }
/* 16px at least, or iPhones zoom the page in when it's tapped. */
.cat-search input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 16px; outline: none; padding: 10px 0; }
.cat-pills { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 0 16px; }
.cat-pills::-webkit-scrollbar { display: none; }
.cat-pill { flex: none; min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: inherit; font-size: .9rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.cat-pill[aria-pressed="true"] { background: var(--brand); border-color: var(--brand); color: var(--on-brand); }
.cat-pill:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
.cat-row { display: flex; gap: 8px; }
.cat-row .cat-search { flex: 1; min-width: 0; }
.cat-jump { flex: none; width: 36%; display: flex; }
.cat-jump select { width: 100%; min-width: 0; text-overflow: ellipsis; min-height: 46px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); font: inherit; font-size: 16px; font-weight: 600; }
.cat-jump select:focus-visible { outline: 3px solid var(--brand); outline-offset: 1px; }
.cat-list { list-style: none; margin: 0; padding: 4px 16px 8px; }
.cat-item { border-bottom: 1px solid var(--line); }
.cat-item:last-child { border-bottom: 0; }
.cat-card summary { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-auto-flow: column; grid-auto-columns: auto; gap: 12px; align-items: start; padding: 14px 0; cursor: pointer; list-style: none; }
.cat-card summary::-webkit-details-marker { display: none; }
.cat-card summary::after { content: ""; width: 9px; height: 9px; margin: 7px 4px 0 0; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(45deg); transition: transform .15s ease; }
.cat-card[open] summary::after { transform: rotate(225deg); margin-top: 12px; }
.cat-card summary:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; border-radius: 12px; }
.cat-thumb, .cat-mono { width: 64px; height: 64px; border-radius: 14px; }
/* A light plate behind every photo, so a cut-out with no background still reads in dark mode. */
.cat-thumb { object-fit: cover; background: #f4f4f1; display: block; }
.cat-mono { display: grid; place-items: center; background: color-mix(in srgb, var(--brand) 16%, var(--surface)); color: var(--ink); border: 1px solid var(--line); font-weight: 800; font-size: 1.15rem; letter-spacing: .03em; }
.cat-body { min-width: 0; display: grid; gap: 4px; }
.cat-name { font-size: 1.0625rem; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
.cat-desc { color: var(--muted); font-size: .94rem; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cat-card[open] .cat-desc { display: block; overflow: visible; color: var(--ink); }
.cat-price { font-size: 1rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.cat-variants { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.cat-variant { display: inline-flex; gap: 6px; align-items: baseline; padding: 5px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); font-size: .9rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.cat-variant b { font-weight: 800; }
.cat-variant.out { color: var(--muted); }
.cat-variant em { font-style: normal; font-size: .78rem; font-weight: 800; color: var(--alert); }
.cat-out { align-self: center; font-size: .8rem; font-weight: 800; color: var(--alert); border: 1.5px solid currentColor; border-radius: 999px; padding: 5px 10px; white-space: nowrap; }
.cat-item.out .cat-name, .cat-item.out .cat-price { color: var(--muted); }
.cat-more { display: grid; gap: 12px; padding: 0 0 16px; }
.cat-photo { width: 100%; max-height: 320px; object-fit: cover; border-radius: 16px; background: #f4f4f1; display: block; }
.cat-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.cat-zaina { min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1.5px solid var(--brand); background: transparent; color: var(--ink); font: inherit; font-size: .92rem; font-weight: 700; cursor: pointer; }
.cat-zaina.main { background: var(--brand); color: var(--on-brand); }
.cat-zaina:focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
.cat-nudge { position: sticky; bottom: 12px; display: flex; align-items: center; gap: 2px; width: max-content; max-width: calc(100% - 32px); margin: 8px auto 12px; padding: 2px 2px 2px 16px; border-radius: 999px; background: var(--ink); color: var(--bg); box-shadow: 0 10px 24px -12px rgba(0, 0, 0, .6); }
.cat-nudge-go { border: 0; background: none; color: inherit; font: inherit; font-size: .9rem; font-weight: 650; min-height: 44px; text-align: left; cursor: pointer; }
.cat-nudge-x { flex: none; border: 0; background: none; color: inherit; font: inherit; font-size: 1.25rem; line-height: 1; width: 44px; height: 44px; border-radius: 999px; cursor: pointer; }
.cat-nudge button:focus-visible { outline: 3px solid var(--brand); outline-offset: -3px; }
.cat-none { margin: 24px 16px; color: var(--muted); text-align: center; }
.cat-link { border: 0; background: none; padding: 0; font: inherit; color: var(--brand); font-weight: 650; text-decoration: underline; cursor: pointer; min-height: 44px; }
@media (max-width: 860px) {
  .door.has-catalogue { display: flex; }
  .door-main { flex: 1; min-height: 0; height: auto; border: none; border-radius: 0; box-shadow: none; }
  .door-tabs { position: relative; }
  .door-foot { flex: none; padding: 6px 0 calc(6px + env(safe-area-inset-bottom, 0px)); background: var(--surface); border-top: 1px solid var(--line); }
  .cat-card summary { gap: 10px; }
}
@media (prefers-reduced-motion: reduce) { .door-btn { transition: none; } .door-btn:hover { transform: none; } }
`;

/**
 * The page's own script (the page allows no inline script): the two tabs,
 * the section pills and the search, and the buttons that ask Zaina for an
 * item. Plain JavaScript, no build step; the page works without it as a
 * list to read.
 */
export const DOOR_JS = String.raw`(function () {
  "use strict";
  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
  var panels = { catalogue: document.getElementById("door-catalogue"), chat: document.getElementById("zaina-chat") };
  if (!tabs.length || !panels.catalogue || !panels.chat) return;
  function show(name, focus) {
    tabs.forEach(function (tab) {
      var on = tab.getAttribute("data-tab") === name;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    panels.catalogue.hidden = name !== "catalogue";
    panels.chat.hidden = name !== "chat";
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

  // Filter: a section pill and the search words, together.
  var items = Array.prototype.slice.call(document.querySelectorAll(".cat-item"));
  var pills = Array.prototype.slice.call(document.querySelectorAll(".cat-pill"));
  var search = document.getElementById("cat-search");
  var none = document.getElementById("cat-none");
  var section = "";
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
  }
  var jump = document.getElementById("cat-jump");
  function choose(value, from) {
    section = value;
    pills.forEach(function (pill) {
      var on = (pill.getAttribute("data-section") || "") === value;
      pill.setAttribute("aria-pressed", on ? "true" : "false");
      if (on && from !== "pill" && pill.scrollIntoView) pill.scrollIntoView({ block: "nearest", inline: "center" });
    });
    if (jump && from !== "jump") jump.value = value;
    apply();
    if (from === "jump") panels.catalogue.scrollTop = 0;
  }
  pills.forEach(function (pill) {
    pill.addEventListener("click", function () { choose(pill.getAttribute("data-section") || "", "pill"); });
  });
  if (jump) jump.addEventListener("change", function () { choose(jump.value, "jump"); });
  if (search) search.addEventListener("input", apply);

  // Asking Zaina is optional: a button inside an opened card, or the small pill at the bottom.
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
})();
`;

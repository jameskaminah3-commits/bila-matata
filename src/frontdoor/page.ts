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
  via: "qr" | "link";
  /** Changes when the colours do, so the stylesheet can be kept. */
  brandVersion: string;
};

/** Up to two letters for a business with no logo: "Palm Cove Stays" → "PC". */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

const ICONS = {
  phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 7.8 19.4L3 21z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2L9 9.5z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
};

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
<div class="door${view.coverUrl ? " has-cover" : ""}">
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
  <main class="door-chat" id="zaina-chat" aria-label="Chat with ${esc(view.assistant)}">
    <p class="door-loading" data-door-loading>Opening the chat…</p>
    <noscript><p class="door-loading">The chat needs JavaScript.${view.phoneDisplay ? ` You can also call ${esc(view.phoneDisplay)}.` : ""}</p></noscript>
  </main>
</div>
<script src="/zaina.js" data-business="${esc(view.businessId)}" data-mode="page" data-mount="#zaina-chat" data-via="${view.via}" async></script>
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
:root { --brand: #0f766e; --on-brand: #ffffff; --bg: #f6f5f1; --surface: #ffffff; --ink: #111a17; --muted: #5b6763; --line: #e4e2da;
  --tint: color-mix(in srgb, var(--brand) 9%, var(--bg)); color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0e1412; --surface: #151d1a; --ink: #f1f4f2; --muted: #a3afab; --line: #26312d; color-scheme: dark; }
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
@media (prefers-reduced-motion: reduce) { .door-btn { transition: none; } .door-btn:hover { transform: none; } }
`;

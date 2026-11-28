// src/studio/site-css.ts
//
// The styles of bilamatata.com's own pages (home, terms, pay), served at
// /site/site.css. One file, no outside frameworks; light and dark.
//
// The brand: alabaster and deep forest emerald, finished in glass, a high-trust light page for
// owners reading prices and plans, with dark slate stages where the product
// itself shows (the live demo, the code snippet, the calculator's answer).
// Emerald for actions and trust cues (it sits naturally beside WhatsApp and
// M-Pesa); text-sized emerald is the darker #047857 so it always reads
// (WCAG AA); cyan and amber only inside the demo and the figures. Light
// only: the bright page is the point. Headlines, the wordmark and prices in
// Jost, a precise geometric sans (served from our own address); everything
// else in the phone's own sans-serif, so pages stay fast and easy to read.

import { createHash } from "node:crypto";
import { TITLE_FONTS } from "../frontdoor/title-fonts.ts";
import { DEMO_CSS, DEMO_JS } from "./demo.ts";
import { HOME_CSS, HOME_JS } from "./home-sections.ts";

export const SITE_CSS = String.raw`
@font-face { font-family: "Bila Display"; src: url(/c-assets/title-modern.woff2?v=${TITLE_FONTS.modern.version}) format("woff2"); font-weight: 600; font-style: normal; font-display: swap; }
:root {
  color-scheme: light;
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-2: #f1f5f9;
  --ink: #0f172a;
  --body: #334155;
  --muted: #475569;
  --line: #e2e8f0;
  --accent: #047857;
  --accent-strong: #065f46;
  --accent-ink: #ffffff;
  --accent-soft: #ecfdf5;
  --brand: #059669;
  --mint: #6ee7b7;
  --cyan: #0284c7;
  --amber: #d97706;
  --stage: #0b1120;
  --stage-card: #0f172a;
  --stage-line: #1e293b;
  --stage-ink: #e2e8f0;
  --stage-muted: #94a3b8;
  --warm: #b45309;
  --warm-soft: #fef3c7;
  --ok: #047857;
  --ok-soft: #ecfdf5;
  --bad: #b91c1c;
  --bad-soft: #fdecec;
  --pen: rgba(16, 185, 129, 0.28);
  --display: "Bila Display", Jost, Futura, "Century Gothic", ui-sans-serif, system-ui, sans-serif;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 18px 40px -24px rgba(15, 23, 42, 0.28);
  --radius: 18px;
  --wrap: 1200px;
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--body);
  font-family: var(--sans);
  font-size: 17px;
  line-height: 1.6;
}
img, svg { max-width: 100%; }
a { color: var(--accent); text-underline-offset: 3px; text-decoration-thickness: 1px; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent); }
a:hover { color: var(--accent-strong); text-decoration-color: currentColor; }
::selection { background: #a7f3d0; color: #064e3b; }
h1, h2, h3 { line-height: 1.15; letter-spacing: -0.02em; margin: 0; text-wrap: balance; color: var(--ink); }
/* Headlines in the display serif: one weight, set a touch loose, figures that line up. */
h1, h2 { font-family: var(--display); font-weight: 600; letter-spacing: -0.022em; font-synthesis: none; }
h1 { font-size: clamp(2.5rem, 5.6vw, 4.2rem); line-height: 1.02; }
h2 { font-size: clamp(1.95rem, 3.6vw, 2.8rem); line-height: 1.07; }
h3 { font-size: 1.18rem; font-weight: 700; letter-spacing: -0.01em; }
p { margin: 0; }
.wrap { width: 100%; max-width: var(--wrap); margin: 0 auto; padding-inline: 20px; }
.skip { position: absolute; left: -999px; top: 8px; background: var(--surface); padding: 8px 12px; border-radius: 8px; z-index: 50; }
.skip:focus { left: 12px; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

/* ── Header ───────────────────────────────────────────────────────── */
.site-header { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--bg) 84%, transparent); -webkit-backdrop-filter: saturate(1.4) blur(14px); backdrop-filter: saturate(1.4) blur(14px); border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent); transition: box-shadow 0.25s ease, background 0.25s ease; }
/* Once the page moves, the header lifts off it a little. */
.site-header.is-scrolled { background: color-mix(in srgb, var(--surface) 86%, transparent); box-shadow: 0 12px 32px -24px rgba(15, 23, 42, 0.45); }
.site-header .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 68px; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; font-family: var(--display); font-weight: 600; letter-spacing: -0.01em; font-size: 1.3rem; font-synthesis: none; }
.brand svg { width: 30px; height: 30px; flex: none; }
.logo-bg { fill: var(--accent); }
.logo-fg { fill: var(--accent-ink); }
.nav { display: flex; align-items: center; gap: 4px; }
.nav a { color: var(--ink); text-decoration: none; font-size: 0.95rem; font-weight: 550; padding: 8px 12px; border-radius: 999px; white-space: nowrap; transition: background 0.15s ease, color 0.15s ease; }
.nav a:hover { background: var(--surface-2); color: var(--ink); }
.nav a[aria-current="page"] { color: var(--accent); }
/* Sign-in and invoices are for existing clients: quieter, after a hairline. */
.nav a.nav-util { color: var(--muted); font-size: 0.9rem; }
.nav a.nav-split { position: relative; margin-left: 12px; }
.nav a.nav-split::before { content: ""; position: absolute; left: -8px; top: 50%; width: 1px; height: 18px; background: var(--line); transform: translateY(-50%); }
.nav a.nav-cta { margin-left: 8px; padding: 9px 18px; background: linear-gradient(180deg, #05845f, #036b4d); color: var(--accent-ink); font-weight: 650; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 10px 20px -14px rgba(4, 120, 87, 0.9); }
.nav a.nav-cta:hover { background: linear-gradient(180deg, var(--accent), var(--accent-strong)); color: var(--accent-ink); }
.nav-toggle { display: none; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink); font: inherit; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
@media (max-width: 900px) {
  .nav-toggle { display: inline-flex; }
  .nav { display: none; position: absolute; left: 0; right: 0; top: 68px; flex-direction: column; align-items: stretch; gap: 2px; padding: 12px 20px 20px; background: var(--surface); border-bottom: 1px solid var(--line); box-shadow: 0 24px 40px -28px rgba(15, 23, 42, 0.45); }
  .nav.open { display: flex; }
  .nav a { padding: 12px 14px; font-size: 1.02rem; }
  .nav a.nav-split { margin: 8px 0 0; padding-top: 16px; border-top: 1px solid var(--line); border-radius: 0; }
  .nav a.nav-split::before { display: none; }
  .nav a.nav-cta { text-align: center; margin: 10px 0 0; padding: 13px 14px; }
}

/* ── Buttons ──────────────────────────────────────────────────────── */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 50px; padding: 0 24px; border-radius: 999px; border: 1px solid transparent; font: inherit; font-weight: 650; font-size: 1rem; text-decoration: none; cursor: pointer; letter-spacing: -0.005em; transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.2s ease, border-color 0.15s ease, color 0.15s ease; }
.btn:hover { transform: translateY(-1px); }
.btn:active { transform: translateY(0); }
/* Emerald with a little depth: lighter at the top, a soft green shadow beneath. White text stays above 4.5:1 across the whole gradient. */
.btn-primary { background: linear-gradient(180deg, #05845f, #036b4d); color: var(--accent-ink); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 1px 2px rgba(4, 120, 87, 0.3), 0 14px 28px -16px rgba(4, 120, 87, 0.75); }
.btn-primary:hover { background: linear-gradient(180deg, var(--accent), var(--accent-strong)); color: var(--accent-ink); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 1px 2px rgba(4, 120, 87, 0.3), 0 18px 34px -16px rgba(4, 120, 87, 0.8); }
.btn-ghost { background: var(--surface); color: var(--ink); border-color: var(--line); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
.btn-ghost:hover { border-color: color-mix(in srgb, var(--brand) 55%, var(--line)); background: var(--accent-soft); color: var(--ink); }
.btn svg { width: 20px; height: 20px; flex: none; }
.btn[disabled] { opacity: 0.6; cursor: not-allowed; transform: none; }

/* ── Hero ─────────────────────────────────────────────────────────── */
/* A soft light behind the headline: emerald to the right, a cool cyan glow to the left. */
.hero { position: relative; isolation: isolate; padding-block: clamp(48px, 8vw, 104px) clamp(40px, 6vw, 80px);
  background: radial-gradient(52% 68% at 86% 22%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 72%),
    radial-gradient(42% 52% at 2% 0%, color-mix(in srgb, var(--cyan) 8%, transparent), transparent 70%); }
/* A fine dot grid, fading out from behind the example chat: texture without noise. */
.hero::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: radial-gradient(rgba(15, 23, 42, 0.1) 1px, transparent 1.3px); background-size: 24px 24px; -webkit-mask-image: radial-gradient(58% 70% at 78% 38%, #000, transparent 72%); mask-image: radial-gradient(58% 70% at 78% 38%, #000, transparent 72%); }
.hero-solo { max-width: var(--wrap); }
.hero-solo > div { max-width: 50em; }
.hero-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); gap: clamp(28px, 5vw, 64px); align-items: center; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
.eyebrow::before { content: ""; width: 22px; height: 2px; background: var(--brand); border-radius: 2px; }
.section-head .eyebrow { margin-top: 0; font-size: 0.8rem; color: var(--accent); }
.section-head .eyebrow + h2 { margin-top: 12px; }
.hero h1 { margin-top: 18px; }
/* The promise, underlined with a soft emerald band like a highlighter stroke. */
.hero h1 em { font-style: normal; color: var(--accent); background: linear-gradient(transparent 87%, var(--pen) 87%, var(--pen) 95%, transparent 95%); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.lede { margin-top: 20px; font-size: clamp(1.05rem, 1.6vw, 1.22rem); color: var(--muted); max-width: 36em; }
.cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.hero-note { margin-top: 18px; font-size: 0.92rem; color: var(--muted); }
/* Three plain facts under the buttons, not a row of pills. */
.hero-proof { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 24px 0 0; padding: 0; list-style: none; font-size: 0.95rem; font-weight: 550; color: var(--muted); }
.hero-proof li { display: inline-flex; align-items: center; gap: 9px; }
.hero-proof li::before { content: ""; width: 11px; height: 6px; margin-top: -3px; border-left: 2px solid var(--accent); border-bottom: 2px solid var(--accent); transform: rotate(-45deg); flex: none; }
@media (max-width: 640px) { .cta-row .btn { flex: 1 1 100%; } }
.hero .picker { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--line); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 34px 0 0; padding: 0; list-style: none; }
.chips li { font-size: 0.86rem; font-weight: 600; padding: 7px 13px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--muted); }

/* The example chat beside the headline. */
.chat-card { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 32px 64px -34px rgba(15, 23, 42, 0.4); overflow: hidden; min-width: 0; }
.chat-head { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--line); }
.chat-dot { width: 34px; height: 34px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; font-weight: 800; flex: none; }
.chat-head strong { display: block; font-size: 0.98rem; line-height: 1.2; }
.chat-head div span { font-size: 0.8rem; color: var(--muted); }
.chat-body { display: flex; flex-direction: column; gap: 10px; padding: 18px; }
.bubble { max-width: 86%; padding: 10px 14px; border-radius: 16px; font-size: 0.94rem; line-height: 1.45; }
.bubble.them { align-self: flex-end; background: var(--accent); color: var(--accent-ink); border-bottom-right-radius: 5px; }
.bubble.zaina { align-self: flex-start; background: var(--surface-2); border-bottom-left-radius: 5px; }
.bubble small { display: block; margin-top: 4px; font-size: 0.74rem; opacity: 0.75; }
.chat-foot { padding: 10px 18px 14px; font-size: 0.78rem; color: var(--muted); border-top: 1px solid var(--line); }

@media (max-width: 900px) {
  .hero-grid { grid-template-columns: minmax(0, 1fr); }
}

/* ── Sections ─────────────────────────────────────────────────────── */
section { scroll-margin-top: 80px; }
.band { padding-block: clamp(56px, 8vw, 104px); }
.band.alt { background: var(--surface); border-block: 1px solid var(--line); }
.section-head { max-width: 46em; }
.section-head p { margin-top: 14px; color: var(--muted); font-size: 1.08rem; }
.grid { display: grid; gap: 18px; margin-top: 36px; }
.grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 1200px) { .grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .grid.two, .grid.four { grid-template-columns: minmax(0, 1fr); } }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 24px; min-width: 0; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); transition: border-color 0.2s ease, box-shadow 0.25s ease, transform 0.25s ease; }
@media (hover: hover) {
  .card:hover { border-color: color-mix(in srgb, var(--brand) 30%, var(--line)); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 24px 48px -32px rgba(15, 23, 42, 0.38); }
  .card.work:hover { transform: translateY(-3px); }
}
.band.alt .card { background: var(--bg); }
.card h3 { margin-bottom: 8px; }
.card p { color: var(--muted); font-size: 0.98rem; }
.card .icon { width: 46px; height: 46px; border-radius: 14px; background: linear-gradient(150deg, var(--accent-soft), #d1fae5); box-shadow: inset 0 0 0 1px rgba(5, 150, 105, 0.16); color: var(--brand); display: grid; place-items: center; margin-bottom: 18px; }
.card .icon svg { width: 22px; height: 22px; }
.card ul { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.card li { position: relative; padding-left: 24px; font-size: 0.95rem; color: var(--ink); }
.card li::before { content: ""; position: absolute; left: 2px; top: 0.5em; width: 12px; height: 7px; border-left: 2px solid var(--accent); border-bottom: 2px solid var(--accent); transform: rotate(-45deg); }

/* The comparison. */
.table-scroll { margin-top: 36px; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); }
table.compare { width: 100%; min-width: 640px; border-collapse: collapse; font-size: 0.96rem; }
.compare th, .compare td { text-align: left; padding: 14px 18px; border-bottom: 1px solid var(--line); vertical-align: top; }
.compare thead th { font-size: 0.82rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); background: var(--surface-2); }
.compare thead th.us { color: var(--accent); }
.compare tbody th { font-weight: 650; width: 30%; }
.compare tr:last-child th, .compare tr:last-child td { border-bottom: 0; }
.compare td.us { background: var(--accent-soft); font-weight: 550; }
.compare td.them { color: var(--muted); }

/* Pricing. */
.plans { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 36px; }
@media (max-width: 760px) { .plans { grid-template-columns: minmax(0, 1fr); } }
.plan { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 28px; display: flex; flex-direction: column; min-width: 0; }
.plan.featured { border: 2px solid var(--brand); box-shadow: 0 24px 48px -28px rgba(5, 150, 105, 0.45); }
.plan .tag { align-self: flex-start; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 5px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); margin-bottom: 14px; }
.plan .price { margin-top: 14px; font-size: 2.5rem; line-height: 1.1; }
/* Prices in the display serif, figures lined up. */
.plan .price, .plan-extra .price, .card.service .from, .amount { font-family: var(--display); font-weight: 600; color: var(--ink); letter-spacing: -0.015em; font-variant-numeric: tabular-nums; font-synthesis: none; }
.plan .price small, .plan-extra .price small, .card.service .from span { font-family: var(--sans); }
.plan .price small { font-size: 1rem; font-weight: 600; color: var(--muted); letter-spacing: 0; }
.plan .setup { margin-top: 4px; color: var(--muted); font-size: 0.95rem; }
.plan-extra { margin-top: 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 28px; display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 24px 36px; align-items: center; }
.plan-extra > div { min-width: 0; }
.plan-extra .tag { display: inline-block; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 5px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); margin-bottom: 14px; }
.plan-extra h3 { text-wrap: balance; }
.plan-extra p { color: var(--muted); margin-top: 8px; }
.plan-extra ul { margin: 16px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.plan-extra li { position: relative; padding-left: 26px; font-size: 0.97rem; }
.plan-extra li::before { content: ""; position: absolute; left: 3px; top: 0.5em; width: 12px; height: 7px; border-left: 2px solid var(--accent); border-bottom: 2px solid var(--accent); transform: rotate(-45deg); }
.plan-extra .price { margin-top: 0; font-size: 1.6rem; font-weight: 800; letter-spacing: -0.02em; color: var(--ink); }
.plan-extra .setup { margin: 4px 0 16px; }
.plan-extra .price small { font-size: 0.9rem; font-weight: 600; color: var(--muted); letter-spacing: 0; }
.plan-extra-cta .plan-alt { display: block; margin-top: 10px; text-align: left; }
/* The price and its button, set in a panel of their own beside the details. */
.plan-extra-cta { align-self: start; display: flex; flex-direction: column; align-items: flex-start; padding: 26px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--line); }
@media (min-width: 761px) { .plan-extra-cta { position: sticky; top: 88px; } }
.plan-menu .plan-menu-why { margin-top: 18px; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink); }
.plan-menu .plan-menu-why + ul { margin-top: 10px; }
.plan-menu li strong { color: var(--ink); }
.plan-menu .plan-menu-note { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 0.95rem; }
@media (max-width: 760px) { .plan-extra { grid-template-columns: minmax(0, 1fr); } }
.plan .for { margin-top: 14px; color: var(--muted); font-size: 0.98rem; }
.plan ul { margin: 18px 0 24px; padding: 0; list-style: none; display: grid; gap: 10px; flex: 1; align-content: start; }
.plan li { position: relative; padding-left: 26px; font-size: 0.97rem; }
.plan li::before { content: ""; position: absolute; left: 3px; top: 0.5em; width: 12px; height: 7px; border-left: 2px solid var(--accent); border-bottom: 2px solid var(--accent); transform: rotate(-45deg); }
.fine { margin-top: 18px; font-size: 0.9rem; color: var(--muted); }
.snippet { margin-top: 28px; padding: 16px 18px; border-radius: 14px; background: var(--stage); color: var(--stage-ink); border: 1px solid var(--stage-line); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86rem; overflow-x: auto; white-space: pre; }

/* Steps. */
.steps { counter-reset: step; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin: 36px 0 0; padding: 0; list-style: none; }
@media (max-width: 1000px) { .steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .steps { grid-template-columns: minmax(0, 1fr); } }
.steps li { counter-increment: step; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 24px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
.steps li::before { content: counter(step, decimal-leading-zero); display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(150deg, var(--brand), var(--accent-strong)); color: #fff; box-shadow: 0 0 0 5px var(--accent-soft); font-family: var(--display); font-weight: 600; font-size: 0.95rem; font-variant-numeric: tabular-nums; font-synthesis: none; margin-bottom: 18px; }
.steps h3 { margin-bottom: 6px; }
.steps p { color: var(--muted); font-size: 0.96rem; }

/* Contact. */
.contact { background: radial-gradient(70% 130% at 100% 0%, color-mix(in srgb, var(--brand) 30%, transparent), transparent 62%), var(--stage); color: var(--bg); border-radius: 26px; padding: clamp(28px, 5vw, 56px); display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr); gap: 28px; align-items: center; }
.contact h2 { color: var(--bg); }
.contact p { margin-top: 12px; color: color-mix(in srgb, var(--bg) 78%, transparent); }
.contact .ways { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; font-size: 1.02rem; }
.contact .ways a { color: var(--bg); font-weight: 650; }
.contact .ways span { display: block; font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: color-mix(in srgb, var(--bg) 62%, transparent); }
.contact .btn-primary { background: var(--bg); color: var(--ink); }
.contact .btn-primary:hover { background: var(--accent-soft); color: var(--ink); }
@media (max-width: 760px) { .contact { grid-template-columns: minmax(0, 1fr); } }

/* ── Footer ───────────────────────────────────────────────────────── */
.site-footer { margin-top: clamp(56px, 8vw, 104px); background: var(--surface); border-top: 1px solid var(--line); font-size: 0.95rem; color: var(--muted); }
.footer-top { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 2.1fr); gap: 40px 56px; padding-block: clamp(44px, 6vw, 72px) 40px; }
@media (max-width: 960px) { .footer-top { grid-template-columns: minmax(0, 1fr); } }
.footer-brand p { margin-top: 14px; max-width: 24em; }
.footer-brand .btn { margin-top: 22px; min-height: 46px; font-size: 0.95rem; }
.footer-cols { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 30px 24px; }
@media (max-width: 640px) { .footer-cols { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.footer-h { font-size: 0.74rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink); }
.footer-cols ul { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.site-footer a { color: var(--body); text-decoration: none; }
.site-footer a:hover { color: var(--accent); }
.site-footer .brand { color: var(--ink); }
.site-footer .nowrap { white-space: nowrap; }
.site-footer .btn-primary, .site-footer .btn-primary:hover { color: var(--accent-ink); }
.footer-base { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 24px; padding-block: 20px 28px; border-top: 1px solid var(--line); font-size: 0.86rem; }
.footer-base a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--line); }

/* ── Documents (terms) ────────────────────────────────────────────── */
.doc { padding-block: clamp(36px, 6vw, 64px); }
.doc .wrap { max-width: 780px; }
.doc h1 { font-size: clamp(2rem, 4.4vw, 2.8rem); }
.doc .updated { margin-top: 10px; color: var(--muted); font-size: 0.95rem; }
.doc .toc { margin: 26px 0 0; padding: 18px 22px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); }
.doc .toc ol { margin: 8px 0 0; padding-left: 20px; display: grid; gap: 4px; }
.doc h2 { margin-top: 44px; font-size: 1.55rem; }
.doc h3 { margin-top: 26px; font-size: 1.1rem; }
.doc p, .doc ul, .doc ol { margin-top: 12px; }
.doc ul, .doc ol { padding-left: 22px; display: grid; gap: 6px; }
.doc p, .doc li { color: var(--ink); max-width: 68ch; }

/* ── Pay ──────────────────────────────────────────────────────────── */
.pay { padding-block: clamp(32px, 6vw, 64px); }
.pay .wrap { max-width: 640px; }
.pay h1 { font-size: clamp(1.9rem, 4.2vw, 2.5rem); }
.pay .lede { font-size: 1.05rem; }
.panel { margin-top: 26px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: clamp(20px, 4vw, 30px); box-shadow: var(--shadow); }
.panel + .panel { margin-top: 16px; box-shadow: none; }
.panel h2 { font-size: 1.2rem; letter-spacing: -0.01em; }
.field { display: grid; gap: 6px; margin-top: 16px; }
.field label { font-weight: 650; font-size: 0.95rem; }
.field input { width: 100%; min-height: 50px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font: inherit; }
.field input:focus-visible { outline-offset: 0; border-color: var(--accent); }
.field .hint { font-size: 0.87rem; color: var(--muted); }
.field select, .field textarea { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font: inherit; }
.field select { min-height: 50px; }
.field textarea { resize: vertical; min-height: 120px; line-height: 1.5; }
.field select:focus-visible, .field textarea:focus-visible { outline-offset: 0; border-color: var(--accent); }
.field [aria-invalid="true"] { border-color: var(--bad); }
.field-error { font-size: 0.87rem; color: var(--bad); font-weight: 550; }
.field .optional { font-weight: 400; color: var(--muted); font-size: 0.87rem; }
.field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
@media (max-width: 640px) { .field-row { grid-template-columns: minmax(0, 1fr); } }
.hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }

/* ── Start (book a consultation) ──────────────────────────────────── */
.start { padding-block: clamp(32px, 6vw, 64px); }
.start h1 { font-size: clamp(1.9rem, 4.2vw, 2.6rem); }
.start .lede { font-size: 1.05rem; }
.start-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.8fr); gap: clamp(24px, 4vw, 48px); align-items: start; }
@media (max-width: 900px) { .start-grid { grid-template-columns: minmax(0, 1fr); } }
.start-side { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 24px; position: sticky; top: 88px; }
@media (max-width: 900px) { .start-side { position: static; } }
.start-side h2 { font-size: 1.15rem; letter-spacing: -0.01em; }
.next { counter-reset: next; margin: 16px 0 0; padding: 0; list-style: none; display: grid; gap: 14px; }
.next li { counter-increment: next; position: relative; padding-left: 40px; font-size: 0.96rem; color: var(--muted); }
.next li strong { color: var(--ink); }
.next li::before { content: counter(next); position: absolute; left: 0; top: 0; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; font-weight: 800; font-size: 0.85rem; }
.start-alt { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); display: grid; gap: 10px; font-size: 0.95rem; color: var(--muted); }
.thanks { max-width: 640px; margin: 0 auto; text-align: left; padding-block: clamp(16px, 5vw, 56px); }
.thanks h1 { margin-top: 16px; }

/* Service cards: what it starts from, and the way to book it. */
.card.service { display: flex; flex-direction: column; }
.card.service ul { flex: 1; align-content: start; }
.card.service .from { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 1.45rem; color: var(--ink); }
.card.service .from span { display: block; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.card.service .btn { margin-top: 14px; min-height: 46px; padding: 0 14px; font-size: 0.93rem; text-align: center; white-space: nowrap; }
.plan-alt { margin-top: 12px; text-align: center; font-size: 0.92rem; color: var(--muted); }
.panel .btn { width: 100%; margin-top: 18px; }
.facts { margin: 18px 0 0; display: grid; gap: 0; }
.facts div { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; border-bottom: 1px solid var(--line); }
.facts div:last-child { border-bottom: 0; }
.facts dt { color: var(--muted); flex: none; }
.facts dd { margin: 0; text-align: right; font-weight: 600; overflow-wrap: anywhere; }
.amount { margin-top: 6px; font-size: 2.4rem; line-height: 1.1; }
.badge { display: inline-flex; align-items: center; gap: 6px; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 11px; border-radius: 999px; }
.badge.open { background: var(--warm-soft); color: var(--warm); }
.badge.paid { background: var(--ok-soft); color: var(--ok); }
.badge.void { background: var(--surface-2); color: var(--muted); }
.notice { margin-top: 18px; padding: 13px 16px; border-radius: 12px; font-size: 0.96rem; }
.notice.ok { background: var(--ok-soft); color: var(--ok); }
.notice.error { background: var(--bad-soft); color: var(--bad); }
.notice.info { background: var(--accent-soft); color: var(--ink); }
.notice.test { background: var(--warm-soft); color: var(--warm); font-weight: 600; }
.secure { display: flex; gap: 10px; align-items: flex-start; margin-top: 16px; font-size: 0.88rem; color: var(--muted); }
.secure svg { width: 18px; height: 18px; flex: none; margin-top: 2px; }
.pay .help { margin-top: 22px; font-size: 0.95rem; color: var(--muted); }

/* ── Blog ─────────────────────────────────────────────────────────── */
.section-head-row { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 24px; max-width: none; }
.post-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin-top: 30px; }
@media (max-width: 1000px) { .post-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .post-grid { grid-template-columns: minmax(0, 1fr); } }
.post-card { position: relative; display: flex; flex-direction: column; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; min-width: 0; transition: border-color .15s ease, transform .15s ease; }
.band.alt .post-card { background: var(--bg); }
.post-card:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); transform: translateY(-2px); }
.post-card h2, .post-card h3 { font-family: var(--display); font-weight: 600; font-size: 1.28rem; line-height: 1.25; letter-spacing: -0.012em; }
.post-card h2 a, .post-card h3 a { color: var(--ink); text-decoration: none; }
.post-card h2 a::after, .post-card h3 a::after { content: ""; position: absolute; inset: 0; border-radius: inherit; }
.post-card p { color: var(--muted); font-size: 0.97rem; }
.post-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-size: 0.85rem; color: var(--muted); }
.post-tag { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
.post-more { margin-top: auto; font-weight: 650; font-size: 0.93rem; color: var(--accent); text-decoration: none; }
.post-date { margin-top: auto; font-size: 0.85rem; }
.crumbs { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-bottom: 18px; font-size: 0.88rem; color: var(--muted); }
.crumbs a { color: var(--muted); }
.crumbs [aria-current] { color: var(--ink); max-width: 100%; overflow-wrap: anywhere; }
.blog-hero { padding-block: clamp(36px, 6vw, 72px) 0; }
.blog-hero h1 { margin-top: 12px; font-size: clamp(2.2rem, 4.6vw, 3.4rem); }
.blog-hero .lede { max-width: 44em; }
.post-head { padding-block: clamp(32px, 5vw, 64px) clamp(20px, 3vw, 32px); background: radial-gradient(50% 80% at 90% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%); }
.post-head .wrap { max-width: 1120px; }
@media (min-width: 1000px) { .post-head .wrap > * { margin-left: 266px; max-width: 760px; } }
.post-head h1 { margin-top: 14px; font-size: clamp(2.1rem, 4.4vw, 3.2rem); }
.post-head .lede { max-width: 40em; }
.post-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 36px; padding-block: 12px clamp(48px, 7vw, 88px); }
@media (min-width: 1000px) { .post-layout { grid-template-columns: 230px minmax(0, 1fr); max-width: 1120px; } }
.post-toc { align-self: start; font-size: 0.92rem; }
@media (min-width: 1000px) { .post-toc { position: sticky; top: 96px; } }
.post-toc > p { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.post-toc ol { margin: 10px 0 0; padding: 0 0 0 14px; border-left: 2px solid var(--line); list-style: none; display: grid; gap: 8px; }
.post-toc a { color: var(--ink); text-decoration: none; }
.post-toc a:hover { color: var(--accent); }
.prose { max-width: 68ch; font-size: 1.08rem; line-height: 1.75; min-width: 0; }
.prose > * + * { margin-top: 1.05em; }
.prose h2 { margin-top: 2em; font-size: clamp(1.5rem, 2.6vw, 1.85rem); line-height: 1.2; scroll-margin-top: 90px; }
.prose h3 { margin-top: 1.6em; font-size: 1.18rem; }
.prose ul, .prose ol { padding-left: 1.3em; display: grid; gap: 0.45em; }
.prose li::marker { color: var(--accent); }
.prose a { color: var(--accent); }
.prose strong { color: var(--ink); }
.post-cta { margin-top: 2.4em; padding: 26px; border-radius: var(--radius); background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--line)); }
.post-cta p { font-size: 1rem; }
.post-cta-title { font-family: var(--display); font-weight: 600; font-size: 1.3rem !important; color: var(--ink); }
.post-cta .cta-row { margin-top: 16px; }
.related-title { font-size: clamp(1.5rem, 2.8vw, 2rem); }

/* ── Motion ───────────────────────────────────────────────────────── */
/* Sections rise gently into place as they scroll into view. The script turns this on, so without it (or with reduced motion) everything simply shows. */
.reveal-on .reveal { opacity: 0; transform: translateY(18px); transition: opacity 0.7s cubic-bezier(0.2, 0.7, 0.2, 1), transform 0.7s cubic-bezier(0.2, 0.7, 0.2, 1); }
.reveal-on .reveal.in { opacity: 1; transform: none; }
.reveal-on .reveal.d1 { transition-delay: 0.07s; }
.reveal-on .reveal.d2 { transition-delay: 0.14s; }
.reveal-on .reveal.d3 { transition-delay: 0.21s; }

@media (prefers-reduced-motion: reduce) {
  .post-card, .card, .site-header, .nav a { transition: none; }
  .reveal-on .reveal { opacity: 1; transform: none; transition: none; }
  html { scroll-behavior: auto; }
  .btn { transition: none; }
}
`;

/** The site's small script: the phone menu, the header's lift, sections rising into view, and the buttons that open the Zaina chat. */
export const SITE_JS = String.raw`
(function () {
  var toggle = document.querySelector("[data-nav-toggle]");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (event) {
      if (event.target && event.target.closest && event.target.closest("a")) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }
  // The header lifts off the page once it scrolls.
  var siteHeader = document.querySelector(".site-header");
  if (siteHeader) {
    var lift = function () { siteHeader.classList.toggle("is-scrolled", window.scrollY > 8); };
    lift();
    window.addEventListener("scroll", lift, { passive: true });
  }
  // Sections rise into place as they come into view. Whatever is on screen, or already scrolled past, shows at
  // once, so nothing blinks and a fast fling never leaves a section hidden.
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!calm && window.requestAnimationFrame) {
    var targets = document.querySelectorAll("main .band .section-head, main .grid > *, main .plans > *, main .plan-extra, main .steps > li, main .post-grid > *, main .calc-inputs, main .calc-results, main .faq-list, main .contact");
    var pending = [];
    var parents = [];
    for (var t = 0; t < targets.length; t += 1) {
      var el = targets[t];
      if (el.getBoundingClientRect().top < window.innerHeight) continue;
      var step = 0;
      for (var o = 0; o < parents.length; o += 1) if (parents[o] === el.parentNode) step += 1;
      parents.push(el.parentNode);
      el.classList.add("reveal");
      if (step % 4) el.classList.add("d" + (step % 4));
      pending.push(el);
    }
    var queued = false;
    var check = function () {
      queued = false;
      var line = window.innerHeight * 0.94;
      for (var p = pending.length - 1; p >= 0; p -= 1) {
        if (pending[p].getBoundingClientRect().top < line) { pending[p].classList.add("in"); pending.splice(p, 1); }
      }
      if (!pending.length) { window.removeEventListener("scroll", queue); window.removeEventListener("resize", queue); }
    };
    var queue = function () { if (!queued) { queued = true; window.requestAnimationFrame(check); } };
    if (pending.length) {
      document.documentElement.classList.add("reveal-on");
      window.addEventListener("scroll", queue, { passive: true });
      window.addEventListener("resize", queue);
    }
  }
  // "Try Zaina" opens the chat; if the chat's script is still loading, it opens once it has.
  function openZaina(tries) {
    if (window.Zaina && typeof window.Zaina.open === "function") { window.Zaina.open(); return; }
    if (tries > 0) setTimeout(function () { openZaina(tries - 1); }, 250);
  }
  // "Ask Zaina" questions on the page: open the chat and ask it, as if the visitor typed it.
  function askZaina(text, tries) {
    if (window.Zaina && typeof window.Zaina.ask === "function") { window.Zaina.ask(text); return; }
    if (tries > 0) setTimeout(function () { askZaina(text, tries - 1); }, 250);
  }
  var asks = document.querySelectorAll("[data-ask-zaina]");
  for (var a = 0; a < asks.length; a += 1) {
    asks[a].addEventListener("click", function (event) { event.preventDefault(); askZaina(event.currentTarget.getAttribute("data-ask-zaina") || "", 40); });
  }
  var buttons = document.querySelectorAll("[data-open-zaina]");
  for (var i = 0; i < buttons.length; i += 1) {
    buttons[i].addEventListener("click", function (event) { event.preventDefault(); openZaina(40); });
  }
})();
`;

/** The glass layer: soft emerald and cyan light behind each section, frosted surfaces in front of it, smoked glass on the dark stages. Last in the file, so it sits over everything above. */
export const GLASS_CSS = String.raw`
/* ── Glass ────────────────────────────────────────────────────────── */
:root {
  --glass: linear-gradient(150deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.6));
  --glass-rim: rgba(255, 255, 255, 0.85);
  --glass-shade: inset 0 1px 0 #fff, 0 0 0 1px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04), 0 22px 46px -32px rgba(15, 23, 42, 0.34);
  --glass-lift: inset 0 1px 0 #fff, 0 0 0 1px rgba(5, 150, 105, 0.28), 0 1px 2px rgba(15, 23, 42, 0.04), 0 28px 56px -32px rgba(15, 23, 42, 0.4);
  --frost: saturate(1.6) blur(18px);
  --smoke: linear-gradient(160deg, rgba(30, 41, 59, 0.62), rgba(15, 23, 42, 0.46));
  --smoke-rim: rgba(255, 255, 255, 0.09);
  --stage-light: radial-gradient(55% 65% at 12% 0%, rgba(16, 185, 129, 0.24), transparent 70%), radial-gradient(50% 60% at 100% 100%, rgba(2, 132, 199, 0.22), transparent 70%);
}

/* The light behind the glass: two soft pools per section, mirrored from one section to the next. */
.band { position: relative; isolation: isolate; }
.band::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(42% 50% at 6% 16%, rgba(16, 185, 129, 0.17), transparent 70%), radial-gradient(38% 46% at 96% 86%, rgba(2, 132, 199, 0.12), transparent 70%); }
.band:nth-of-type(even)::before {
  background: radial-gradient(42% 50% at 94% 14%, rgba(16, 185, 129, 0.17), transparent 70%), radial-gradient(38% 46% at 4% 88%, rgba(2, 132, 199, 0.12), transparent 70%); }
.band.alt { background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.2)); border-block-color: rgba(15, 23, 42, 0.05); }
.reach { background: rgba(255, 255, 255, 0.55); border-block-color: rgba(15, 23, 42, 0.05); }

/* Frosted surfaces: translucent white, a bright rim on top, a fine edge and a soft shadow. */
.card, .band.alt .card, .plan, .plan-extra, .steps li, .faq-item, .band.alt .faq-item, .post-card, .band.alt .post-card,
.calc-inputs, .value-more, .table-scroll, .start-side, .panel, .doc .toc, .powered-list a, .hero-card, .chat-card, .meet-tag {
  background: var(--glass); border-color: var(--glass-rim); box-shadow: var(--glass-shade);
}
.plan.featured { border-color: var(--brand); box-shadow: inset 0 1px 0 #fff, 0 28px 56px -28px rgba(5, 150, 105, 0.5); background: linear-gradient(160deg, rgba(236, 253, 245, 0.95), rgba(255, 255, 255, 0.66) 45%); }
.faq-item[open] { border-color: var(--glass-rim); box-shadow: var(--glass-lift); }
@media (hover: hover) {
  .card:hover, .post-card:hover { border-color: var(--glass-rim); box-shadow: var(--glass-lift); }
}
/* Real blur only where there is detail behind the glass, so phones stay smooth. */
.hero-card, .chat-card, .meet-tag { -webkit-backdrop-filter: var(--frost); backdrop-filter: var(--frost); }
.hero-card { background: linear-gradient(165deg, rgba(236, 253, 245, 0.82), rgba(255, 255, 255, 0.55) 42%, rgba(255, 255, 255, 0.7)); box-shadow: inset 0 1px 0 #fff, 0 0 0 1px rgba(15, 23, 42, 0.06), 0 40px 80px -40px rgba(15, 23, 42, 0.45); }
.hero-card::before { background: linear-gradient(180deg, rgba(209, 250, 229, 0.7), transparent); }
.site-header { background: rgba(248, 250, 252, 0.6); -webkit-backdrop-filter: var(--frost); backdrop-filter: var(--frost); border-bottom-color: rgba(255, 255, 255, 0.7); }
.site-header.is-scrolled { background: rgba(255, 255, 255, 0.68); border-bottom-color: rgba(15, 23, 42, 0.06); }
@media (max-width: 900px) { .nav { background: rgba(255, 255, 255, 0.86); -webkit-backdrop-filter: var(--frost); backdrop-filter: var(--frost); } }
.btn-ghost, .picker-chip, .chips li, .demo-tabs button:not([aria-selected="true"]), .demo-controls button { background: rgba(255, 255, 255, 0.62); border-color: rgba(15, 23, 42, 0.08); box-shadow: inset 0 1px 0 #fff, 0 1px 2px rgba(15, 23, 42, 0.04); }
.btn-ghost:hover { background: rgba(236, 253, 245, 0.85); }
.site-footer { background: linear-gradient(180deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.92)); border-top-color: rgba(15, 23, 42, 0.06); }

/* Smoked glass on the dark stages, lit from two corners. */
.demo-stage { background: var(--stage-light), var(--stage); border-color: rgba(255, 255, 255, 0.06); }
.demo-panel { background: var(--smoke); border-color: var(--smoke-rim); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07); -webkit-backdrop-filter: var(--frost); backdrop-filter: var(--frost); }
.demo-screen { box-shadow: 0 30px 60px -30px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.5); border-color: transparent; }
.demo-row, .demo-record { border-color: var(--smoke-rim); background: rgba(255, 255, 255, 0.04); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05); }
.calc-results { background: var(--stage-light), var(--stage); border-color: rgba(255, 255, 255, 0.06); }
.calc-plans li { background: rgba(255, 255, 255, 0.06); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), inset 0 0 0 1px rgba(255, 255, 255, 0.06); }
.calc-plans li.us { background: rgba(16, 185, 129, 0.16); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 0 0 1px rgba(110, 231, 183, 0.25); }
.contact { background: radial-gradient(60% 120% at 100% 0%, rgba(16, 185, 129, 0.32), transparent 62%), radial-gradient(50% 90% at 0% 100%, rgba(2, 132, 199, 0.2), transparent 65%), var(--stage); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 40px 80px -48px rgba(15, 23, 42, 0.7); }
.snippet { background: var(--stage-light), var(--stage); }

/* Anyone who asks for less transparency gets solid surfaces. */
@media (prefers-reduced-transparency: reduce) {
  .card, .band.alt .card, .plan, .plan-extra, .steps li, .faq-item, .band.alt .faq-item, .post-card, .band.alt .post-card,
  .calc-inputs, .value-more, .table-scroll, .start-side, .panel, .doc .toc, .powered-list a, .hero-card, .chat-card, .meet-tag, .site-header, .nav { background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
  .demo-panel { background: var(--stage-card); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
`;

/** Everything the site's pages style themselves with, in one file, and its version (the address changes when it does, so a visitor never gets yesterday's look). */
export const SITE_STYLES = SITE_CSS + DEMO_CSS + HOME_CSS + GLASS_CSS;
export const SITE_SCRIPT = SITE_JS + DEMO_JS + HOME_JS;
export const SITE_ASSETS_VERSION = createHash("sha256").update(SITE_STYLES).update(SITE_SCRIPT).digest("hex").slice(0, 12);

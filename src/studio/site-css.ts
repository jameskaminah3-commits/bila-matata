// src/studio/site-css.ts
//
// The styles of bilamatata.co.ke's own pages (home, terms, pay), served at
// /site/site.css. One file, no outside fonts or frameworks; light and dark.

export const SITE_CSS = String.raw`
:root {
  color-scheme: light dark;
  --bg: #faf9f5;
  --surface: #ffffff;
  --surface-2: #f2f1eb;
  --ink: #0f1c1a;
  --muted: #55625f;
  --line: #e2e0d8;
  --accent: #0f766e;
  --accent-strong: #0b5c56;
  --accent-ink: #ffffff;
  --accent-soft: #e3f3f0;
  --warm: #b45309;
  --warm-soft: #fdf1e2;
  --ok: #15803d;
  --ok-soft: #e7f6ec;
  --bad: #b91c1c;
  --bad-soft: #fdecec;
  --shadow: 0 1px 2px rgba(15, 28, 26, 0.05), 0 12px 32px -18px rgba(15, 28, 26, 0.28);
  --radius: 16px;
  --wrap: 1120px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a1312;
    --surface: #101c1a;
    --surface-2: #152421;
    --ink: #ecf3f1;
    --muted: #9db0ab;
    --line: #223431;
    --accent: #2dd4bf;
    --accent-strong: #5eead4;
    --accent-ink: #04211e;
    --accent-soft: #0f2c28;
    --warm: #fbbf24;
    --warm-soft: #2a2110;
    --ok: #4ade80;
    --ok-soft: #10281a;
    --bad: #f87171;
    --bad-soft: #2c1414;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 16px 36px -20px rgba(0, 0, 0, 0.7);
  }
}
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 17px;
  line-height: 1.6;
}
img, svg { max-width: 100%; }
a { color: var(--accent); text-underline-offset: 3px; }
a:hover { color: var(--accent-strong); }
h1, h2, h3 { line-height: 1.15; letter-spacing: -0.02em; margin: 0; text-wrap: balance; }
h1 { font-size: clamp(2.3rem, 5.6vw, 3.9rem); font-weight: 800; }
h2 { font-size: clamp(1.7rem, 3.4vw, 2.4rem); font-weight: 750; }
h3 { font-size: 1.18rem; font-weight: 700; letter-spacing: -0.01em; }
p { margin: 0; }
.wrap { width: 100%; max-width: var(--wrap); margin: 0 auto; padding-inline: 20px; }
.skip { position: absolute; left: -999px; top: 8px; background: var(--surface); padding: 8px 12px; border-radius: 8px; z-index: 50; }
.skip:focus { left: 12px; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 6px; }

/* ── Header ───────────────────────────────────────────────────────── */
.site-header { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.site-header .wrap { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; font-weight: 800; letter-spacing: -0.02em; font-size: 1.12rem; }
.brand svg { width: 30px; height: 30px; flex: none; }
.logo-bg { fill: var(--accent); }
.logo-fg { fill: var(--accent-ink); }
.nav { display: flex; align-items: center; gap: 4px; }
.nav a { color: var(--ink); text-decoration: none; font-size: 0.95rem; font-weight: 550; padding: 8px 12px; border-radius: 999px; white-space: nowrap; }
.nav a:hover { background: var(--surface-2); }
.nav a.nav-cta { background: var(--ink); color: var(--bg); }
.nav a.nav-cta:hover { background: var(--accent-strong); color: var(--accent-ink); }
.nav-toggle { display: none; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink); font: inherit; font-size: 0.95rem; font-weight: 600; cursor: pointer; }
@media (max-width: 900px) {
  .nav-toggle { display: inline-flex; }
  .nav { display: none; position: absolute; left: 0; right: 0; top: 64px; flex-direction: column; align-items: stretch; gap: 2px; padding: 12px 20px 18px; background: var(--bg); border-bottom: 1px solid var(--line); box-shadow: var(--shadow); }
  .nav.open { display: flex; }
  .nav a { padding: 12px 14px; font-size: 1.02rem; }
  .nav a.nav-cta { text-align: center; margin-top: 6px; }
}

/* ── Buttons ──────────────────────────────────────────────────────── */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 50px; padding: 0 24px; border-radius: 999px; border: 1px solid transparent; font: inherit; font-weight: 650; font-size: 1rem; text-decoration: none; cursor: pointer; transition: transform 0.12s ease, background 0.12s ease; }
.btn:hover { transform: translateY(-1px); }
.btn-primary { background: var(--accent); color: var(--accent-ink); }
.btn-primary:hover { background: var(--accent-strong); color: var(--accent-ink); }
.btn-ghost { background: var(--surface); color: var(--ink); border-color: var(--line); }
.btn-ghost:hover { border-color: var(--accent); color: var(--ink); }
.btn svg { width: 20px; height: 20px; flex: none; }
.btn[disabled] { opacity: 0.6; cursor: not-allowed; transform: none; }

/* ── Hero ─────────────────────────────────────────────────────────── */
.hero { padding-block: clamp(48px, 8vw, 96px) clamp(40px, 6vw, 72px); }
.hero-solo { max-width: var(--wrap); }
.hero-solo > div { max-width: 50em; }
.hero-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); gap: clamp(28px, 5vw, 64px); align-items: center; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
.eyebrow::before { content: ""; width: 22px; height: 2px; background: currentColor; border-radius: 2px; }
.hero h1 { margin-top: 18px; }
.hero h1 em { font-style: normal; color: var(--accent); }
.lede { margin-top: 20px; font-size: clamp(1.05rem, 1.6vw, 1.22rem); color: var(--muted); max-width: 36em; }
.cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 30px; }
.hero-note { margin-top: 18px; font-size: 0.92rem; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 34px 0 0; padding: 0; list-style: none; }
.chips li { font-size: 0.86rem; font-weight: 600; padding: 7px 13px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--muted); }

/* The example chat beside the headline. */
.chat-card { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; box-shadow: var(--shadow); overflow: hidden; min-width: 0; }
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
.band { padding-block: clamp(48px, 7vw, 88px); }
.band.alt { background: var(--surface); border-block: 1px solid var(--line); }
.section-head { max-width: 46em; }
.section-head p { margin-top: 14px; color: var(--muted); font-size: 1.08rem; }
.grid { display: grid; gap: 18px; margin-top: 36px; }
.grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 1000px) { .grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .grid.two, .grid.four { grid-template-columns: minmax(0, 1fr); } }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; min-width: 0; }
.band.alt .card { background: var(--bg); }
.card h3 { margin-bottom: 8px; }
.card p { color: var(--muted); font-size: 0.98rem; }
.card .icon { width: 42px; height: 42px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; margin-bottom: 16px; }
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
.plan.featured { border-color: var(--accent); box-shadow: var(--shadow); }
.plan .tag { align-self: flex-start; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 5px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); margin-bottom: 14px; }
.plan .price { margin-top: 14px; font-size: 2.3rem; font-weight: 800; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; line-height: 1.1; }
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
@media (max-width: 760px) { .plan-extra { grid-template-columns: minmax(0, 1fr); } }
.plan .for { margin-top: 14px; color: var(--muted); font-size: 0.98rem; }
.plan ul { margin: 18px 0 24px; padding: 0; list-style: none; display: grid; gap: 10px; flex: 1; }
.plan li { position: relative; padding-left: 26px; font-size: 0.97rem; }
.plan li::before { content: ""; position: absolute; left: 3px; top: 0.5em; width: 12px; height: 7px; border-left: 2px solid var(--accent); border-bottom: 2px solid var(--accent); transform: rotate(-45deg); }
.fine { margin-top: 18px; font-size: 0.9rem; color: var(--muted); }
.snippet { margin-top: 28px; padding: 16px 18px; border-radius: 14px; background: var(--ink); color: var(--bg); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.86rem; overflow-x: auto; white-space: pre; }

/* Steps. */
.steps { counter-reset: step; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin: 36px 0 0; padding: 0; list-style: none; }
@media (max-width: 1000px) { .steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .steps { grid-template-columns: minmax(0, 1fr); } }
.steps li { counter-increment: step; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; }
.steps li::before { content: counter(step); display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--ink); color: var(--bg); font-weight: 800; font-size: 0.95rem; margin-bottom: 14px; }
.steps h3 { margin-bottom: 6px; }
.steps p { color: var(--muted); font-size: 0.96rem; }

/* Contact. */
.contact { background: var(--ink); color: var(--bg); border-radius: 26px; padding: clamp(28px, 5vw, 56px); display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr); gap: 28px; align-items: center; }
.contact h2 { color: var(--bg); }
.contact p { margin-top: 12px; color: color-mix(in srgb, var(--bg) 78%, transparent); }
.contact .ways { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; font-size: 1.02rem; }
.contact .ways a { color: var(--bg); font-weight: 650; }
.contact .ways span { display: block; font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: color-mix(in srgb, var(--bg) 62%, transparent); }
.contact .btn-primary { background: var(--bg); color: var(--ink); }
.contact .btn-primary:hover { background: var(--accent-soft); color: var(--ink); }
@media (max-width: 760px) { .contact { grid-template-columns: minmax(0, 1fr); } }

/* ── Footer ───────────────────────────────────────────────────────── */
.site-footer { border-top: 1px solid var(--line); padding-block: 32px 44px; margin-top: clamp(48px, 7vw, 88px); font-size: 0.93rem; color: var(--muted); }
.site-footer .wrap { display: flex; flex-wrap: wrap; gap: 14px 28px; justify-content: space-between; align-items: baseline; }
.site-footer p { max-width: 44em; }
.site-footer nav { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.site-footer a { color: var(--ink); }

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
.card.service .from { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 1.3rem; font-weight: 800; letter-spacing: -0.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
.card.service .from span { display: block; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.card.service .btn { margin-top: 14px; min-height: 46px; padding: 0 16px; font-size: 0.95rem; text-align: center; }
.plan-alt { margin-top: 12px; text-align: center; font-size: 0.92rem; color: var(--muted); }
.panel .btn { width: 100%; margin-top: 18px; }
.facts { margin: 18px 0 0; display: grid; gap: 0; }
.facts div { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; border-bottom: 1px solid var(--line); }
.facts div:last-child { border-bottom: 0; }
.facts dt { color: var(--muted); flex: none; }
.facts dd { margin: 0; text-align: right; font-weight: 600; overflow-wrap: anywhere; }
.amount { margin-top: 6px; font-size: 2.4rem; font-weight: 800; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; line-height: 1.1; }
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

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .btn { transition: none; }
}
`;

/** The home page's small script: the phone menu, and the buttons that open the Zaina chat. */
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
  // "Try Zaina" opens the chat; if the chat's script is still loading, it opens once it has.
  function openZaina(tries) {
    if (window.Zaina && typeof window.Zaina.open === "function") { window.Zaina.open(); return; }
    if (tries > 0) setTimeout(function () { openZaina(tries - 1); }, 250);
  }
  var buttons = document.querySelectorAll("[data-open-zaina]");
  for (var i = 0; i < buttons.length; i += 1) {
    buttons[i].addEventListener("click", function (event) { event.preventDefault(); openZaina(40); });
  }
})();
`;

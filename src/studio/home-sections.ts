// src/studio/home-sections.ts
//
// The home page's sections that sell Zaina by what the business gets out of
// it: who she is (a team member, with a face), the hospitality sample, what
// each plan pays for, and what she could be worth to a particular business,
// worked out on that business's own numbers (arithmetic, not a promise).
//
// Pure HTML builders, with the styles and the small script that make them
// move: the hero's lines, the industry buttons, the calculator and the bar
// that follows a phone's screen. Everything is in the HTML first; the script
// only adds to it.

import { formatMoney, STUDIO, STUDIO_SUGGESTIONS, whatsappLink } from "./brand.ts";
import FAQ from "../../knowledge/bilamatata/frequently-asked-questions.json" with { type: "json" };
import type { FeaturedBusiness } from "./featured.ts";

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string
));

type Icons = Record<string, string>;

// ── Who Zaina is ─────────────────────────────────────────────────────────

/** The lines she says in the hero, one business at a time (examples). */
const HERO_LINES = [
  { role: "Guest experience host", at: "Palm Cove Stays", text: "Hi, I'm Zaina, the guest experience host at Palm Cove Stays. Looking for a room this weekend?" },
  { role: "Client care host", at: "Amani Hair Studio", text: "Hi, I'm Zaina from Amani Hair Studio. Saturday has 10:00 am and 2:30 pm free. Which suits you?" },
  { role: "Reservations host", at: "Tamarind Grill", text: "Hi, I'm Zaina at Tamarind Grill. Table for six tomorrow? I have 7:00 pm and 8:30 pm." },
];

export const INDUSTRIES = [
  { id: "hotel", label: "Hotel or stay", scene: "hotel" },
  { id: "salon", label: "Salon or clinic", scene: "salon" },
  { id: "restaurant", label: "Restaurant", scene: "restaurant" },
  { id: "shop", label: "Shop or services", scene: "shop" },
] as const;
export type IndustryId = (typeof INDUSTRIES)[number]["id"];

export function renderHeroCard(): string {
  return `<aside class="hero-card" aria-label="Meet Zaina">
        <div class="hero-face">
          <img src="/site/zaina.svg" alt="Zaina, a smiling member of your team" width="176" height="176" fetchpriority="high">
          <span class="online"><i aria-hidden="true"></i>On shift now</span>
        </div>
        <p class="hero-name"><strong>Zaina</strong> <span data-hero-role>${esc(HERO_LINES[0].role)}</span></p>
        <p class="hero-at muted-text" data-hero-at>${esc(HERO_LINES[0].at)} (example)</p>
        <div class="hero-lines" data-hero-lines aria-live="off">
          ${HERO_LINES.map((line, index) => `<p class="bubble zaina" data-hero-line data-role="${esc(line.role)}" data-at="${esc(line.at)}"${index === 0 ? "" : " hidden"}>${esc(line.text)}</p>`).join("\n          ")}
        </div>
        <div class="hero-ask">
          <p class="hero-ask-label"><i aria-hidden="true"></i>Live on this page: ask me about Bila Matata</p>
          <div class="hero-ask-chips">
            ${STUDIO_SUGGESTIONS.slice(0, 3).map((question) => `<button type="button" class="hero-ask-chip" data-ask-zaina="${esc(question)}">${esc(question)}</button>`).join("\n            ")}
          </div>
        </div>
      </aside>`;
}

export function renderIndustryPicker(): string {
  return `<div class="picker" role="group" aria-label="Show me how it works for">
        <span class="picker-label">Show me how it works for a</span>
        ${INDUSTRIES.map((industry) => `<a class="picker-chip" href="#demo" data-industry-pick="${industry.id}">${esc(industry.label)}</a>`).join("\n        ")}
      </div>`;
}

export function renderMeetZaina(icons: Icons): string {
  const traits: Array<[string, string, string]> = [
    [icons.spark, "Greets every customer like your best host", "Warm, quick and by name, at midnight as much as at noon."],
    [icons.lock, "Knows your business by heart, and never guesses", "Your rooms, rates, hours and house rules. If it isn't in your information, she says so and asks your team."],
    [icons.people, "Works as part of your team", "She says “we” and “our”, brings in a person for what needs one, and hands the whole chat over."],
    [icons.moon, "Never takes a night off", "Weekends, Sundays and 2 am: the enquiry gets an answer while the others are still asleep."],
  ];
  return `<section class="band alt" id="meet" aria-labelledby="meet-title">
  <div class="wrap meet">
    <div class="meet-portrait">
      <div class="meet-ring"><img src="/site/zaina.svg" alt="Zaina" width="320" height="320" loading="lazy"></div>
      <div class="meet-tag meet-tag-a">${icons.chat}<span>Replies in seconds</span></div>
      <div class="meet-tag meet-tag-b">${icons.calendar}<span>Checks your calendar</span></div>
    </div>
    <div>
      <p class="eyebrow">Meet Zaina</p>
      <h2 id="meet-title">The newest member of your team, from day one</h2>
      <p class="lede">When Zaina starts at your business she gets a role on your team, learns your information, and takes her first guest the same day. Your customers meet a friendly, capable team member, not a menu.</p>
      <ul class="trait-list">
        ${traits.map(([icon, title, text]) => `<li><span class="icon" aria-hidden="true">${icon}</span><div><h3>${esc(title)}</h3><p>${esc(text)}</p></div></li>`).join("\n        ")}
      </ul>
      <p class="fine">Zaina is a digital team member, and she says so honestly if a customer sincerely asks. She never pretends to be a person.</p>
      <div class="cta-row"><a class="btn btn-primary" href="#zaina" data-open-zaina>${icons.chat}Say hello to Zaina</a><a class="btn btn-ghost" href="#demo">See her at work</a></div>
    </div>
  </div>
</section>`;
}

// ── Hospitality ──────────────────────────────────────────────────────────

export function renderHospitality(icons: Icons): string {
  const features: Array<[string, string, string]> = [
    [icons.calendar, "Real availability for the guest's dates", "She checks your own bookings and the calendars you connect (any calendar with an iCal link) before she says a room is free."],
    [icons.chart, "Prices the stay from your rates", "Nightly rates, seasons, weekends, extra guests and fees: the total comes from your own rules, to the shilling."],
    [icons.inbox, "Holds the room and sends your payment link", "She holds the room and sends your guest your own M-Pesa or card payment link. The money goes straight to you: Zaina never collects or holds it."],
    [icons.spark, "Never a dead end when you're full", "Sold out on their dates? She offers the nearest room or dates you actually have, so the guest books with you anyway."],
    [icons.doc, "Answers the questions that fill your inbox", "Check-in time, parking, breakfast, pets, directions: answered from your information, every time, in English or Swahili."],
    [icons.people, "Hands over for the personal touch", "Weddings, groups and special requests go to your team with the whole chat, and your team can take over any conversation."],
  ];
  return `<section class="band" id="hospitality" aria-labelledby="hospitality-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">For hotels, lodges, villas and stays</p>
      <h2 id="hospitality-title">Turn every guest enquiry into a confirmed booking</h2>
      <p>Guests message several places at once and book with the one that answers first and answers well. Zaina is your guest experience host, awake every night, who gets the stay booked and paid for while your team is off the clock.</p>
    </div>
    <div class="grid three">
      ${features.map(([icon, title, text]) => `<article class="card"><div class="icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join("\n      ")}
    </div>
    <div class="cta-row">
      <a class="btn btn-primary" href="#demo" data-industry-pick="hotel">See a hotel booking, step by step</a>
      <a class="btn btn-ghost" href="/start?service=zaina_full">Get Zaina for my property</a>
    </div>
    <p class="fine">Prices, rooms and names in the demonstration are examples. Availability, totals and bookings come with the Full Booking &amp; Quote Engine.</p>
  </div>
</section>`;
}

// ── What each coin buys ──────────────────────────────────────────────────

type Cell = true | false | string;
const VALUE_ROWS: Array<{ feature: string; gain: string; starter: Cell; full: Cell }> = [
  { feature: "Replies in seconds, day and night", gain: "The guest who messages at midnight books with you, not the next place that answers.", starter: true, full: true },
  { feature: "Answers only from your own information", gain: "No wrong rate or policy ever goes out in your name.", starter: true, full: true },
  { feature: "Leads captured and handed over", gain: "Your team starts with the name, the number and exactly what they want.", starter: true, full: true },
  { feature: "Your team takes over any chat", gain: "Step in for a VIP or a tricky question without losing the thread.", starter: true, full: true },
  { feature: "Notification emails, with takeover links and transcripts", gain: "The owner, reception and a manager each hear about it, wherever they are.", starter: "Up to 2", full: "Up to 5" },
  { feature: "Your own branded QR code, page and business cards", gain: "No website? Customers scan the code on your counter or your card and reach you in seconds, wherever you've chosen.", starter: true, full: true },
  { feature: "Your brand: logo, colours and welcome line", gain: "The chat, your page and your payment page look like your business, not ours.", starter: true, full: true },
  { feature: "Dashboard: chat history, leads and reports", gain: "See every conversation, what was asked and what it led to.", starter: true, full: true },
  { feature: "Help and support from our team", gain: "A real person answers when you're stuck.", starter: true, full: true },
  { feature: "Live availability from your calendars", gain: "No double bookings, and no “let me check and get back to you”.", starter: false, full: true },
  { feature: "Exact totals from your rates", gain: "Dates, guests and fees worked out for you, so staff never do the sums.", starter: false, full: true },
  { feature: "Bookings, with your own M-Pesa or card payment link", gain: "The sale closes while you sleep. Customers pay you directly: Zaina never holds your money.", starter: false, full: true },
  { feature: "Calendar sync and booking alerts", gain: "Your calendars and Zaina always agree, and your team knows at once.", starter: false, full: true },
];

export function renderValueTable(plans: { starter: { monthlyMinor: number; setupMinor: number }; full: { monthlyMinor: number; setupMinor: number } }): string {
  const mark = (cell: Cell) => cell === true ? '<span class="tick" role="img" aria-label="Included">✓</span>' : cell === false ? '<span class="dash" role="img" aria-label="Not included">–</span>' : `<span class="amount-cell">${esc(cell)}</span>`;
  return `<section class="band alt" id="value" aria-labelledby="value-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">What you get for your money</p>
      <h2 id="value-title">Every feature has a job: here is what it does for you</h2>
      <p>No filler. Each line is something Zaina does that either wins you a customer, saves your team's time or protects your reputation. Starter answers and captures. Full goes on to close the sale.</p>
    </div>
    <details class="value-more">
    <summary><span>Compare every feature, plan by plan</span><small>${VALUE_ROWS.length + 1} lines, Starter beside Full</small></summary>
    <div class="table-scroll">
      <table class="compare value-table">
        <thead>
          <tr><th scope="col">What Zaina does</th><th scope="col">What's in it for you</th><th scope="col" class="plan-col">Starter<small>${esc(formatMoney(plans.starter.monthlyMinor, "KES"))} a month</small></th><th scope="col" class="plan-col us">Full<small>${esc(formatMoney(plans.full.monthlyMinor, "KES"))} a month</small></th></tr>
        </thead>
        <tbody>
          ${VALUE_ROWS.map((row) => `<tr><th scope="row">${esc(row.feature)}</th><td>${esc(row.gain)}</td><td class="plan-col">${mark(row.starter)}</td><td class="plan-col us">${mark(row.full)}</td></tr>`).join("\n          ")}
          <tr class="setup-row"><th scope="row">Set up by our team, once</th><td>We load your information, tune her to your voice and install her on your website. You don't build anything.</td><td class="plan-col">${esc(formatMoney(plans.starter.setupMinor, "KES"))}</td><td class="plan-col us">${esc(formatMoney(plans.full.setupMinor, "KES"))}</td></tr>
        </tbody>
      </table>
    </div>
    </details>
    <div class="cta-row"><a class="btn btn-primary" href="#worth">Work out what she's worth to you</a><a class="btn btn-ghost" href="#pricing">See the plans</a></div>
  </div>
</section>`;
}

// ── What she could be worth to you ───────────────────────────────────────

export type CalcInputs = { enquiries: number; latePct: number; winPct: number; valueKes: number };
export const CALC_PRESETS: Record<IndustryId, CalcInputs & { what: string }> = {
  hotel: { enquiries: 120, latePct: 30, winPct: 25, valueKes: 30_000, what: "a stay" },
  salon: { enquiries: 200, latePct: 30, winPct: 30, valueKes: 3_500, what: "an appointment" },
  restaurant: { enquiries: 150, latePct: 30, winPct: 30, valueKes: 8_000, what: "a table booking" },
  shop: { enquiries: 100, latePct: 30, winPct: 20, valueKes: 12_000, what: "a sale" },
};

/** The arithmetic on a business's own numbers: nothing here is a promise. */
export function calculate(input: CalcInputs, planMinor: { starter: number; full: number }) {
  const extra = Math.round(input.enquiries * (input.latePct / 100) * (input.winPct / 100));
  const revenue = extra * input.valueKes;
  const starter = planMinor.starter / 100;
  const full = planMinor.full / 100;
  return {
    extra,
    revenue,
    starterBookings: Math.max(1, Math.ceil(starter / Math.max(1, input.valueKes))),
    fullBookings: Math.max(1, Math.ceil(full / Math.max(1, input.valueKes))),
    starterTimes: starter ? revenue / starter : 0,
    fullTimes: full ? revenue / full : 0,
  };
}

const kes = (amount: number) => `KES ${Math.round(amount).toLocaleString("en-KE")}`;
const times = (value: number) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10).toString();

export function renderCalculator(plans: { starter: number; full: number }): string {
  const preset = CALC_PRESETS.hotel;
  const result = calculate(preset, plans);
  const slider = (id: string, label: string, hint: string, value: number, min: number, max: number, step: number, unit: string) => `<div class="calc-field">
          <label for="${id}"><span>${esc(label)}</span><output for="${id}" data-out="${id}">${value}${unit}</output></label>
          <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-calc="${id}" data-unit="${esc(unit)}">
          <span class="hint">${esc(hint)}</span>
        </div>`;
  return `<section class="band" id="worth" aria-labelledby="worth-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Is it worth it for me?</p>
      <h2 id="worth-title">Work out what Zaina could be worth to your business</h2>
      <p>Move the sliders to your own numbers. The sums are simple on purpose, so you can check them yourself.</p>
    </div>
    <div class="calc" data-calc-root data-starter="${plans.starter}" data-full="${plans.full}">
      <div class="calc-inputs">
        <div class="calc-presets" role="group" aria-label="Start from an example">
          <span>Start from an example:</span>
          ${INDUSTRIES.map((industry) => `<button type="button" data-calc-preset="${industry.id}" aria-pressed="${industry.id === "hotel" ? "true" : "false"}">${esc(industry.label)}</button>`).join("\n          ")}
        </div>
        ${slider("calc-enquiries", "Enquiries you get each month", "On your website, WhatsApp, phone and social media.", preset.enquiries, 10, 1000, 10, "")}
        ${slider("calc-late", "How many arrive when nobody can answer quickly?", "Nights, weekends, busy hours and days off.", preset.latePct, 0, 100, 5, "%")}
        ${slider("calc-win", "How many of those would have booked if answered at once?", "Be honest: your own estimate is the best one.", preset.winPct, 0, 100, 5, "%")}
        <div class="calc-field">
          <label for="calc-value"><span>What is one booking or sale worth?</span></label>
          <div class="money-input"><span>KES</span><input id="calc-value" type="number" inputmode="numeric" min="100" max="10000000" step="100" value="${preset.valueKes}" data-calc="calc-value"></div>
          <span class="hint" data-calc-what>For example: ${esc(preset.what)} at ${esc(kes(preset.valueKes))}.</span>
        </div>
      </div>
      <div class="calc-results" aria-live="polite">
        <p class="calc-label">Your estimate</p>
        <p class="calc-big"><strong data-out-extra>${result.extra}</strong> more bookings a month</p>
        <p class="calc-sub">about <strong data-out-revenue>${esc(kes(result.revenue))}</strong> more income each month</p>
        <ul class="calc-plans">
          <li><span><strong>Starter</strong> ${esc(kes(plans.starter / 100))} a month</span><span>pays for itself after <strong data-out-starter-bookings>${result.starterBookings} booking${result.starterBookings === 1 ? "" : "s"}</strong></span></li>
          <li class="us"><span><strong>Full</strong> ${esc(kes(plans.full / 100))} a month</span><span>pays for itself after <strong data-out-full-bookings>${result.fullBookings} booking${result.fullBookings === 1 ? "" : "s"}</strong></span></li>
        </ul>
        <p class="calc-times">That income would be <strong data-out-full-times>${times(result.fullTimes)}×</strong> the price of Full.</p>
        <p class="fine">This is arithmetic on the numbers you chose, not a promise of results. With Starter, those enquiries become leads your team closes; with Full, Zaina closes the booking herself.</p>
        <a class="btn btn-primary" href="/start?service=zaina_full">Get Zaina for my business</a>
      </div>
    </div>
  </div>
</section>`;
}

/** How many bookings of a given worth a plan's monthly price is (for the plan cards). */
export const breakEvenBookings = (monthlyMinor: number, valueKes: number) => Math.max(1, Math.ceil(monthlyMinor / 100 / Math.max(1, valueKes)));

export function renderStickyCta(): string {
  return `<div class="sticky-cta" data-sticky-cta aria-label="Quick actions">
  <a class="btn btn-primary" href="#zaina" data-open-zaina>Chat with Zaina</a>
  <a class="btn btn-ghost" href="/start?service=zaina_full">Get Zaina</a>
</div>`;
}

export const HOME_WHATSAPP = whatsappLink(`Hello ${STUDIO.name}, I'd like to see Zaina working for my business.`);

// ── Styles ───────────────────────────────────────────────────────────────

export const HOME_CSS = String.raw`
/* ── Hero card: Zaina on shift ────────────────────────────────────── */
.hero-grid { align-items: center; }
.hero-card { background: var(--surface); border: 1px solid var(--line); border-radius: 28px; box-shadow: var(--shadow); padding: 28px 24px 24px; display: grid; justify-items: center; text-align: center; gap: 6px; min-width: 0; position: relative; overflow: hidden; }
.hero-card::before { content: ""; position: absolute; inset: 0 0 auto; height: 120px; background: linear-gradient(180deg, var(--accent-soft), transparent); pointer-events: none; }
.hero-face { position: relative; width: 176px; height: 176px; }
.hero-face img { width: 100%; height: 100%; border-radius: 50%; display: block; border: 5px solid var(--surface); box-shadow: 0 10px 30px -10px rgba(5, 150, 105, 0.35); animation: zaina-breathe 5s ease-in-out infinite; }
.online { position: absolute; left: 50%; bottom: -10px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); font-size: 0.78rem; font-weight: 700; color: var(--ok); white-space: nowrap; box-shadow: 0 4px 12px -6px rgba(0,0,0,.3); }
.online i { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); animation: zaina-pulse 2s ease-in-out infinite; }
.hero-name { margin-top: 14px; font-size: 1.15rem; }
.hero-name span { color: var(--accent); font-weight: 600; font-size: 0.95rem; }
.muted-text { color: var(--muted); font-size: 0.86rem; margin-top: -4px; }
.hero-lines { width: 100%; margin-top: 10px; min-height: 92px; display: grid; align-items: start; text-align: left; }
.hero-lines .bubble { max-width: 100%; align-self: start; }
.hero-lines .bubble:not([hidden]) { animation: demo-in 0.4s ease both; }
@keyframes zaina-breathe { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes zaina-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.8); } }
.hero-card .bubble.zaina { background: var(--surface-2); padding: 12px 14px; border-radius: 16px; border-bottom-left-radius: 5px; font-size: 0.95rem; line-height: 1.45; }

/* Industry buttons */
.picker { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 26px; }
.picker-label { font-size: 0.9rem; font-weight: 650; color: var(--muted); margin-right: 4px; }
.picker-chip { display: inline-flex; align-items: center; min-height: 42px; padding: 0 16px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); text-decoration: none; font-weight: 600; font-size: 0.93rem; transition: transform .12s ease, border-color .12s ease, background .12s ease; }
.picker-chip:hover { border-color: var(--accent); background: var(--accent-soft); transform: translateY(-1px); color: var(--ink); }
.picker-chip.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }

/* ── Meet Zaina ───────────────────────────────────────────────────── */
.meet { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: clamp(28px, 5vw, 72px); align-items: center; }
@media (max-width: 860px) { .meet { grid-template-columns: minmax(0, 1fr); } }
.meet-portrait { position: relative; justify-self: center; width: min(100%, 360px); aspect-ratio: 1; }
.meet-ring { width: 100%; height: 100%; border-radius: 50%; padding: 10px; background: conic-gradient(from 200deg, var(--brand), #34d399, var(--cyan), var(--brand)); box-shadow: 0 24px 60px -24px rgba(5, 150, 105, .35); }
.meet-ring img { width: 100%; height: 100%; display: block; border-radius: 50%; border: 6px solid var(--surface); background: var(--surface); }
.meet-tag { position: absolute; display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 14px; background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow); font-size: 0.86rem; font-weight: 650; animation: zaina-breathe 6s ease-in-out infinite; }
.meet-tag svg { width: 18px; height: 18px; color: var(--accent); flex: none; }
.meet-tag-a { left: -4%; top: 12%; }
.meet-tag-b { right: -4%; bottom: 12%; animation-delay: 1.5s; }
@media (max-width: 480px) { .meet-tag-a { left: 0; } .meet-tag-b { right: 0; } }
.trait-list { list-style: none; margin: 24px 0 0; padding: 0; display: grid; gap: 16px; }
.trait-list li { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 14px; align-items: start; }
.trait-list .icon { width: 42px; height: 42px; border-radius: 12px; background: var(--accent-soft); color: var(--brand); display: grid; place-items: center; }
.trait-list .icon svg { width: 22px; height: 22px; }
.trait-list h3 { font-size: 1.05rem; margin-bottom: 2px; }
.trait-list p { color: var(--muted); font-size: 0.97rem; }

/* ── Three-column grid, value table, calculator ───────────────────── */
.grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 1000px) { .grid.three { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .grid.three { grid-template-columns: minmax(0, 1fr); } }
.value-table { min-width: 720px; }
.value-table th[scope="row"] { width: 28%; }
.value-table .plan-col { text-align: center; width: 12%; white-space: nowrap; }
.value-table thead .plan-col small { display: block; font-size: 0.74rem; letter-spacing: 0; text-transform: none; font-weight: 600; margin-top: 2px; color: var(--muted); }
.value-table .tick { color: var(--ok); font-weight: 800; font-size: 1.1rem; }
.value-table .dash { color: var(--muted); }
.value-table .amount-cell { font-weight: 700; font-size: 0.9rem; }
.value-table tbody td.us { background: var(--accent-soft); }
.value-table .setup-row th, .value-table .setup-row td { background: var(--surface-2); font-weight: 600; }

.calc { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: clamp(20px, 4vw, 48px); margin-top: 36px; align-items: start; }
@media (max-width: 900px) { .calc { grid-template-columns: minmax(0, 1fr); } }
.calc-inputs, .calc-results { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: clamp(18px, 3vw, 30px); min-width: 0; }
.calc-results { background: var(--stage); color: var(--stage-ink); border-color: var(--stage-line); position: sticky; top: 88px; }
@media (max-width: 900px) { .calc-results { position: static; } }
.calc-presets { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
.calc-presets span { font-size: 0.88rem; font-weight: 650; color: var(--muted); margin-right: 4px; }
.calc-presets button { min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font: inherit; font-size: 0.88rem; font-weight: 600; cursor: pointer; }
.calc-presets button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.calc-field { display: grid; gap: 8px; margin-top: 22px; }
.calc-field label { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; font-weight: 650; font-size: 0.97rem; }
.calc-field output { font-weight: 800; font-size: 1.15rem; color: var(--accent); font-variant-numeric: tabular-nums; white-space: nowrap; }
.calc-field .hint { font-size: 0.85rem; color: var(--muted); }
.calc-field input[type="range"] { width: 100%; height: 36px; accent-color: var(--accent); cursor: pointer; }
.money-input { display: flex; align-items: center; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); overflow: hidden; max-width: 260px; }
.money-input span { padding: 0 12px; color: var(--muted); font-weight: 700; }
.money-input input { border: 0; background: transparent; color: var(--ink); font: inherit; font-weight: 700; min-height: 48px; width: 100%; padding: 0 12px 0 0; }
.money-input input:focus-visible { outline: none; }
.money-input:focus-within { border-color: var(--accent); }
.calc-label { font-size: 0.76rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; opacity: .7; }
.calc-big { margin-top: 10px; font-size: 1.15rem; }
.calc-big strong { font-size: clamp(2.6rem, 6vw, 3.6rem); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; line-height: 1; color: var(--mint); margin-right: 6px; }
.calc-sub { margin-top: 6px; font-size: 1.05rem; opacity: .9; }
.calc-sub strong { font-variant-numeric: tabular-nums; }
.calc-plans { list-style: none; margin: 20px 0 0; padding: 0; display: grid; gap: 8px; }
.calc-plans li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 14px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.08); font-size: 0.93rem; }
.calc-plans li.us { background: rgba(16, 185, 129, .16); }
.calc-times { margin-top: 14px; font-size: 0.95rem; }
.calc-results .fine { color: inherit; opacity: .72; }
.calc-results .btn { margin-top: 18px; width: 100%; background: var(--bg); color: var(--ink); }
.calc-results .btn:hover { background: var(--accent-soft); color: var(--ink); }
.plan .breakeven { margin-top: 10px; padding: 8px 12px; border-radius: 10px; background: var(--accent-soft); color: var(--ink); font-size: 0.88rem; }

/* ── The bar that follows a phone's screen ────────────────────────── */
.sticky-cta { display: none; }
@media (max-width: 760px) {
  .sticky-cta { display: flex; gap: 8px; position: fixed; left: 0; right: 0; bottom: 0; z-index: 15; padding: 10px 92px calc(10px + env(safe-area-inset-bottom, 0px)) 14px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px); border-top: 1px solid var(--line); transform: translateY(110%); transition: transform .25s ease; }
  .sticky-cta.show { transform: none; }
  .sticky-cta .btn { min-height: 46px; padding: 0 10px; font-size: 0.88rem; flex: 1; white-space: nowrap; }
  .site-footer { padding-bottom: 96px; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-face img, .online i, .meet-tag { animation: none; }
  .picker-chip, .sticky-cta { transition: none; }
}

/* ── Live on this page: one tap asks the real Zaina ─────────────────── */
.hero-ask { width: 100%; margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--line); text-align: left; }
.hero-ask-label { display: flex; align-items: center; gap: 8px; font-size: 0.76rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
.hero-ask-label i { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 18%, transparent); flex: none; }
.hero-ask-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.hero-ask-chip { min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); background: var(--accent-soft); color: var(--ink); font: inherit; font-size: 0.88rem; font-weight: 600; cursor: pointer; text-align: left; transition: border-color .15s ease, transform .15s ease; }
.hero-ask-chip:hover { border-color: var(--accent); transform: translateY(-1px); }
.hero-ask-chip::after { content: " →"; color: var(--accent); }

/* ── Where Zaina works: a quiet band of facts under the hero ────────── */
.reach { border-block: 1px solid var(--line); background: var(--surface); }
.reach-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1.25fr) minmax(0, 0.9fr); gap: 20px 40px; padding-block: 26px; }
.reach-block { min-width: 0; }
.reach-label { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.reach-channels { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, max-content); gap: 8px 22px; }
@media (max-width: 420px) { .reach-channels { grid-template-columns: minmax(0, 1fr); } }
.reach-channels li { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.95rem; }
.reach-channels svg { width: 20px; height: 20px; color: var(--accent); flex: none; }
.reach-kinds { margin-top: 10px; font-weight: 600; font-size: 0.95rem; line-height: 1.7; }
.reach-kinds span { white-space: nowrap; }
.reach-kinds i { font-style: normal; color: var(--brand); margin: 0 8px; }
.reach-note { margin-top: 10px; font-size: 0.95rem; color: var(--ink); }
@media (max-width: 960px) { .reach-grid { grid-template-columns: minmax(0, 1fr); gap: 18px; padding-block: 22px; } }

/* ── The long feature table, folded until asked for ─────────────────── */
.value-more { margin-top: 30px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); }
.value-more > summary { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; padding: 18px 22px; cursor: pointer; list-style: none; font-weight: 700; font-size: 1.05rem; }
.value-more > summary::-webkit-details-marker { display: none; }
.value-more > summary span::before { content: "+"; display: inline-grid; place-items: center; width: 26px; height: 26px; margin-right: 12px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); font-weight: 700; }
.value-more[open] > summary span::before { content: "−"; }
.value-more > summary small { font-size: 0.85rem; font-weight: 550; color: var(--muted); }
.value-more .table-scroll { margin: 0; border: 0; border-top: 1px solid var(--line); border-radius: 0 0 var(--radius) var(--radius); }

/* ── Questions ──────────────────────────────────────────────────────── */
.faq-grid { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: 28px 56px; align-items: start; }
.faq-grid .section-head { position: sticky; top: 96px; }
@media (max-width: 900px) { .faq-grid { grid-template-columns: minmax(0, 1fr); } .faq-grid .section-head { position: static; } }
.faq-list { display: grid; gap: 10px; }
.faq-item { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
.faq-item[open] { border-color: color-mix(in srgb, var(--brand) 35%, var(--line)); box-shadow: 0 18px 36px -28px rgba(15, 23, 42, 0.35); }
.faq-item > summary:hover { color: var(--accent); }
.faq-item > summary { position: relative; padding: 16px 52px 16px 20px; cursor: pointer; list-style: none; font-weight: 650; font-size: 1.02rem; }
.faq-item > summary::-webkit-details-marker { display: none; }
.faq-item > summary::after { content: ""; position: absolute; right: 22px; top: 50%; width: 9px; height: 9px; border-right: 2px solid var(--accent); border-bottom: 2px solid var(--accent); transform: translateY(-70%) rotate(45deg); transition: transform .15s ease; }
.faq-item[open] > summary::after { transform: translateY(-30%) rotate(-135deg); }
.faq-item > p { padding: 0 20px 18px; color: var(--muted); }
.faq-item[open] { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); }
@media (prefers-reduced-motion: reduce) { .hero-ask-chip, .faq-item > summary::after { transition: none; } }

/* ── Selected work: set like the service cards ──────────────────────── */
/* Each project: its own logo, large on a bright stage, over a slow glow in the client's own colours. */
.work-grid { gap: 22px; }
@media (min-width: 641px) and (max-width: 1200px) { .work-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.card.work { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.work-stage { position: relative; isolation: isolate; display: grid; place-items: center; aspect-ratio: 16 / 8; overflow: hidden; background: #fff; border-bottom: 1px solid rgba(15, 23, 42, 0.06); --tint-a: rgba(5, 150, 105, 0.2); --tint-b: rgba(2, 132, 199, 0.14); }
.work-happyfine { --tint-a: rgba(21, 128, 61, 0.24); --tint-b: rgba(234, 179, 8, 0.22); }
.work-channah { --tint-a: rgba(219, 39, 119, 0.18); --tint-b: rgba(180, 120, 72, 0.18); }
.work-ewama { --tint-a: rgba(202, 138, 4, 0.2); --tint-b: rgba(120, 82, 45, 0.16); }
.work-tembea { --tint-a: rgba(20, 184, 166, 0.22); --tint-b: rgba(249, 115, 22, 0.16); }
.work-stage::before { content: ""; position: absolute; inset: -35%; z-index: -2; background: radial-gradient(34% 40% at 32% 38%, var(--tint-a), transparent 70%), radial-gradient(32% 38% at 70% 64%, var(--tint-b), transparent 70%); animation: work-glow 14s ease-in-out infinite alternate; }
.work-grid > :nth-child(2) .work-stage::before { animation-duration: 17s; animation-direction: alternate-reverse; }
.work-grid > :nth-child(3) .work-stage::before { animation-duration: 15s; }
.work-grid > :nth-child(4) .work-stage::before { animation-duration: 18s; animation-direction: alternate-reverse; }
@keyframes work-glow { from { transform: translate(-6%, -4%) rotate(0deg); } to { transform: translate(6%, 4%) rotate(10deg); } }
.work-stage::after { content: ""; position: absolute; inset: 0; z-index: -1; background-image: radial-gradient(rgba(15, 23, 42, 0.08) 1px, transparent 1.3px); background-size: 18px 18px; -webkit-mask-image: radial-gradient(60% 70% at 50% 50%, #000, transparent 75%); mask-image: radial-gradient(60% 70% at 50% 50%, #000, transparent 75%); }
.work-logo { max-height: 54%; max-width: 58%; width: auto; height: auto; object-fit: contain; filter: drop-shadow(0 16px 24px rgba(15, 23, 42, 0.16)); transition: transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1); }
.work-live { position: absolute; left: 14px; top: 14px; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: rgba(255, 255, 255, 0.78); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); border: 1px solid rgba(15, 23, 42, 0.08); color: var(--ink); font-size: 0.74rem; font-weight: 700; letter-spacing: 0.04em; }
.work-live i { position: relative; width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
.work-live i::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid #10b981; animation: work-pulse 2.2s ease-out infinite; }
@keyframes work-pulse { from { transform: scale(0.5); opacity: 0.9; } to { transform: scale(1.6); opacity: 0; } }
.work-open { position: absolute; right: 14px; bottom: 14px; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px; background: var(--ink); color: #fff; font-size: 0.84rem; font-weight: 650; opacity: 0; transform: translateY(6px); transition: opacity 0.25s ease, transform 0.25s ease; }
@media (hover: hover) {
  .card.work:hover .work-open { opacity: 1; transform: none; }
  .card.work:hover .work-logo { transform: scale(1.06) translateY(-3px); }
}
.work-body { display: flex; flex-direction: column; flex: 1; padding: 22px 24px; }
@media (max-width: 640px) { .work-stage { aspect-ratio: 16 / 11; } .work-logo { max-height: 48%; max-width: 62%; transform: translateY(8px); } }
@media (prefers-reduced-motion: reduce) { .work-stage::before, .work-live i::after { animation: none; } .work-logo { transition: none; } }
.work-tag { margin: 0 0 8px; font-size: 0.72rem !important; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.card.work p:not(.work-tag) { flex: 1; }
.work-link { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 6px; font-weight: 650; font-size: 0.88rem; color: var(--accent); text-decoration: none; min-width: 0; }
.work-link .work-host { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.work-link:hover { color: var(--accent-strong); text-decoration: underline; }
.work-link svg { flex: none; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.powered { margin-top: 36px; padding-top: 26px; border-top: 1px solid var(--line); }
.powered-label { font-size: 0.74rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.powered-list { list-style: none; margin: 14px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.powered-list a { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); text-decoration: none; min-width: 0; }
.powered-list a:hover { border-color: var(--accent); }
.powered-list img, .powered-mark { width: 40px; height: 40px; border-radius: 10px; flex: none; object-fit: contain; background: var(--surface); }
.powered-mark { display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 0.85rem; }
.powered-list span { display: grid; min-width: 0; }
.powered-list strong { font-size: 0.95rem; overflow-wrap: anywhere; }
.powered-list small { font-size: 0.82rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.band.alt .faq-item { background: var(--bg); }
`;

// ── Script ───────────────────────────────────────────────────────────────

export const HOME_JS = String.raw`
(function () {
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The hero: Zaina greets a different kind of business in turn.
  var lines = Array.prototype.slice.call(document.querySelectorAll("[data-hero-line]"));
  var roleEl = document.querySelector("[data-hero-role]");
  var atEl = document.querySelector("[data-hero-at]");
  if (lines.length > 1 && !calm) {
    var current = 0;
    setInterval(function () {
      if (document.hidden) return;
      lines[current].hidden = true;
      current = (current + 1) % lines.length;
      lines[current].hidden = false;
      if (roleEl) roleEl.textContent = lines[current].getAttribute("data-role");
      if (atEl) atEl.textContent = lines[current].getAttribute("data-at") + " (example)";
    }, 5200);
  }

  // The calculator: arithmetic on the visitor's own numbers.
  var root = document.querySelector("[data-calc-root]");
  var PRESETS = { hotel: [120, 30, 25, 30000, "a stay"], salon: [200, 30, 30, 3500, "an appointment"], restaurant: [150, 30, 30, 8000, "a table booking"], shop: [100, 30, 20, 12000, "a sale"] };
  var fmt = function (n) { return "KES " + Math.round(n).toLocaleString("en-KE"); };
  var field = function (id) { return root ? root.querySelector("#" + id) : null; };
  function recalc() {
    if (!root) return;
    var enquiries = Number(field("calc-enquiries").value), late = Number(field("calc-late").value), win = Number(field("calc-win").value);
    var value = Math.max(100, Number(field("calc-value").value) || 0);
    var starter = Number(root.getAttribute("data-starter")) / 100, full = Number(root.getAttribute("data-full")) / 100;
    var extra = Math.round(enquiries * (late / 100) * (win / 100));
    var revenue = extra * value;
    ["calc-enquiries", "calc-late", "calc-win"].forEach(function (id) {
      var output = root.querySelector('[data-out="' + id + '"]'), input = field(id);
      if (output) output.textContent = input.value + (input.getAttribute("data-unit") || "");
    });
    var set = function (selector, text) { var el = root.querySelector(selector); if (el) el.textContent = text; };
    var plural = function (n) { return n === 1 ? "" : "s"; };
    var sb = Math.max(1, Math.ceil(starter / value)), fb = Math.max(1, Math.ceil(full / value));
    set("[data-out-extra]", String(extra));
    set("[data-out-revenue]", fmt(revenue));
    set("[data-out-starter-bookings]", sb + " booking" + plural(sb));
    set("[data-out-full-bookings]", fb + " booking" + plural(fb));
    var times = full ? revenue / full : 0;
    set("[data-out-full-times]", (times >= 10 ? Math.round(times) : Math.round(times * 10) / 10) + "×");
    // The plan cards say the same thing, for the same worth.
    Array.prototype.forEach.call(document.querySelectorAll("[data-breakeven]"), function (el) {
      var price = Number(el.getAttribute("data-breakeven")) / 100, n = Math.max(1, Math.ceil(price / value));
      var strong = el.querySelector("strong"), worth = el.querySelector("[data-breakeven-value]");
      if (strong) strong.textContent = n + " booking" + plural(n);
      if (worth) worth.textContent = fmt(value);
    });
  }
  if (root) {
    // The bookings are counted in words ("1 booking"): the page's starting text has only the number.
    root.addEventListener("input", recalc);
    Array.prototype.forEach.call(root.querySelectorAll("[data-calc-preset]"), function (button) {
      button.addEventListener("click", function () { applyPreset(button.getAttribute("data-calc-preset")); });
    });
  }
  function applyPreset(id) {
    var p = PRESETS[id];
    if (!root || !p) return;
    field("calc-enquiries").value = p[0]; field("calc-late").value = p[1]; field("calc-win").value = p[2]; field("calc-value").value = p[3];
    Array.prototype.forEach.call(root.querySelectorAll("[data-calc-preset]"), function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-calc-preset") === id ? "true" : "false"); });
    var what = root.querySelector("[data-calc-what]");
    if (what) what.textContent = "For example: " + p[4] + " at " + fmt(p[3]) + ".";
    recalc();
  }

  // The industry buttons: show that business's conversation, and its numbers.
  var SCENES = { hotel: "hotel", salon: "salon", restaurant: "restaurant", shop: "shop" };
  Array.prototype.forEach.call(document.querySelectorAll("[data-industry-pick]"), function (link) {
    link.addEventListener("click", function (event) {
      var id = link.getAttribute("data-industry-pick");
      var tab = document.querySelector('[data-demo-tab="' + SCENES[id] + '"]');
      var demo = document.getElementById("demo");
      if (!tab || !demo) return;
      event.preventDefault();
      tab.click();
      applyPreset(id);
      Array.prototype.forEach.call(document.querySelectorAll(".picker-chip"), function (chip) { chip.classList.toggle("on", chip.getAttribute("data-industry-pick") === id); });
      demo.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    });
  });

  // The bar on a phone: once the first screen has gone, until the contact section.
  var bar = document.querySelector("[data-sticky-cta]");
  if (bar && "IntersectionObserver" in window) {
    var hero = document.querySelector(".hero"), contact = document.getElementById("contact");
    var pastHero = false, atContact = false;
    var update = function () { bar.classList.toggle("show", pastHero && !atContact); };
    if (hero) new IntersectionObserver(function (e) { pastHero = !e[0].isIntersecting; update(); }).observe(hero);
    if (contact) new IntersectionObserver(function (e) { atContact = e[0].isIntersecting; update(); }, { threshold: 0.1 }).observe(contact);
  }
})();
`;

/** The FAQ the home page shows: the same answers Zaina gives (knowledge/bilamatata), so the page and the chat never disagree. */
export const HOME_FAQ_QUESTIONS = [
  "Do I need a website to use Zaina?",
  "Do you work in my town?",
  "How does set-up work if I'm far away from you?",
  "Does Zaina make things up or invent prices?",
  "Where does my customers' money go?",
  "Can my staff take over a conversation?",
  "What is the Menu plan?",
  "What languages does Zaina speak?",
  "Can I cancel Zaina?",
];
export const homeFaq = (): Array<{ question: string; answer: string }> =>
  HOME_FAQ_QUESTIONS.map((question) => (FAQ as Array<{ question: string; answer: string }>).find((entry) => entry.question === question)).filter((entry): entry is { question: string; answer: string } => Boolean(entry));

const REACH_ICONS = {
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="15" rx="2.5"/><path d="M3 8.5h18"/><circle cx="6" cy="6.3" r=".5" fill="currentColor"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 7.8 19.4L3 21z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2L9 9.5z"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
};

/** Under the hero: where Zaina works, for whom, and that it's anywhere. Plain facts, no logos we don't have. */
export function renderReach(): string {
  const channels: Array<[keyof typeof REACH_ICONS, string]> = [["web", "Your website"], ["whatsapp", "WhatsApp"], ["qr", "A QR code on the table"], ["search", "Google and shared links"]];
  const kinds = ["Hotels and lodges", "Restaurants and bars", "Salons and spas", "Clinics", "Shops", "Schools", "Property", "Professional firms"];
  return `<section class="reach" aria-label="Where Zaina works">
  <div class="wrap reach-grid">
    <div class="reach-block">
      <p class="reach-label">Everywhere your customers are</p>
      <ul class="reach-channels">${channels.map(([icon, label]) => `<li>${REACH_ICONS[icon]}<span>${esc(label)}</span></li>`).join("")}</ul>
    </div>
    <div class="reach-block">
      <p class="reach-label">For every business that gets enquiries</p>
      <p class="reach-kinds">${kinds.map((kind) => `<span>${esc(kind)}</span>`).join(' <i aria-hidden="true">·</i> ')}</p>
    </div>
    <div class="reach-block">
      <p class="reach-label">Across Kenya and beyond</p>
      <p class="reach-note">Set up remotely, in any county or country, in English or Swahili.</p>
    </div>
  </div>
</section>`;
}

/** Questions asked often, answered exactly as Zaina answers them; anything else, ask her. */
export function renderFaq(): string {
  return `<section class="band alt" id="faq" aria-labelledby="faq-title">
  <div class="wrap faq-grid">
    <div class="section-head">
      <p class="eyebrow">Questions</p>
      <h2 id="faq-title">Asked often, answered plainly</h2>
      <p>The same answers Zaina gives. Anything else, ask her: she's on this page now.</p>
      <div class="cta-row"><a class="btn btn-primary" href="#faq" data-open-zaina>Ask Zaina</a><a class="btn btn-ghost" href="${esc(whatsappLink("Hello Bila Matata, I have a question."))}" rel="noopener">WhatsApp us</a></div>
    </div>
    <div class="faq-list">
      ${homeFaq().map((entry) => `<details class="faq-item"><summary>${esc(entry.question)}</summary><p>${esc(entry.answer)}</p></details>`).join("\n      ")}
    </div>
  </div>
</section>`;
}

/** Live work the studio designed and built: real sites, each a click away, each shown by its own logo (assets/work/<slug>-logo.webp). */
export const STUDIO_WORK = [
  {
    slug: "happyfine",
    name: "Happyfine Wholesalers",
    url: "https://happyfinewholesalers.co.ke",
    tag: "Wholesale & Retail E-Commerce · Kenya",
    summary: "Full-featured online wholesale storefront offering bulk and single-unit pricing across household and commercial goods in Kenya, engineered for fast mobile browsing and streamlined ordering.",
  },
  {
    slug: "channah",
    name: "Channah Cake House",
    url: "https://channahcakes.co.ke",
    tag: "Bakery & Custom Orders · Mombasa",
    summary: "Branded showcase and custom order website for a Mombasa cake house, highlighting signature cakes, celebration galleries, and direct customer inquiry flows.",
  },
  {
    slug: "ewama",
    name: "EWAMA Properties Ltd",
    url: "https://ewamaproperties.com",
    tag: "Real Estate & Property · Kenya",
    summary: "High-trust corporate real estate website (\u201cFoundation of Trust\u201d) designed to present property listings, build buyer credibility, and capture qualified investor and tenant leads.",
  },
  {
    slug: "tembea",
    name: "Tembea Bila Matata",
    url: "https://tembeabilamatata.com",
    tag: "Travel, Stays & Local Concierge · Kenyan Coast",
    summary: "Multi-vendor coastal hospitality and travel platform connecting guests with verified Nyali and Diani stays, SGR transfers, car hire, and local experiences.",
  },
];

const monogram = (name: string) => name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
const ARROW = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';

/**
 * "Selected work built by our studio": the live projects, set like the
 * service cards; under them, only when the studio has turned some on in
 * /admin, the businesses that run on Zaina.
 */
export function renderWork(featured: FeaturedBusiness[] = []): string {
  const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");
  const powered = featured.length
    ? `<div class="powered">
      <p class="powered-label">Businesses powered by Zaina</p>
      <ul class="powered-list">
        ${featured.map((business) => `<li><a href="${esc(business.url)}" target="_blank" rel="noopener">${business.logoUrl ? `<img src="${esc(business.logoUrl)}" alt="" width="40" height="40" loading="lazy">` : `<span class="powered-mark" aria-hidden="true">${esc(monogram(business.name))}</span>`}<span><strong>${esc(business.name)}</strong>${business.tagline ? `<small>${esc(business.tagline)}</small>` : ""}</span></a></li>`).join("\n        ")}
      </ul>
    </div>`
    : "";
  return `<section class="band alt" id="work" aria-labelledby="work-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Our work</p>
      <h2 id="work-title">Selected work built by our studio</h2>
      <p>Live websites and platforms we designed and built for businesses in Kenya. Open any of them: they're working sites, not mock-ups.</p>
    </div>
    <div class="grid two work-grid">
      ${STUDIO_WORK.map((project) => `<article class="card work">
        <a class="work-stage work-${project.slug}" href="${esc(project.url)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">
          <span class="work-live"><i></i>Live website</span>
          <img class="work-logo" src="/site/work/${project.slug}-logo.webp" alt="" loading="lazy" decoding="async">
          <span class="work-open">Open the site ${ARROW}</span>
        </a>
        <div class="work-body">
          <p class="work-tag">${esc(project.tag).replace(/-/g, "\u2011")}</p>
          <h3>${esc(project.name)}</h3>
          <p>${esc(project.summary)}</p>
          <a class="work-link" href="${esc(project.url)}" target="_blank" rel="noopener"><span class="work-host">${esc(host(project.url))}</span>${ARROW}<span class="visually-hidden"> (opens ${esc(project.name)} in a new tab)</span></a>
        </div>
      </article>`).join("\n      ")}
    </div>
    ${powered}
  </div>
</section>`;
}

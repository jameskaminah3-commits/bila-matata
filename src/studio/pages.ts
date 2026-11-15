// src/studio/pages.ts
//
// bilamatata.com's own pages, as HTML: the home page and the terms. The
// pages are plain documents (everything is in the HTML a crawler reads); the
// only scripts are /site/site.js (the phone menu and the "Try Zaina" buttons)
// and the studio's own Zaina chat, the same one-line embed any client uses.

import { formatMoney, STUDIO, whatsappLink } from "./brand.ts";
import { renderDemo } from "./demo.ts";
import { breakEvenBookings, CALC_PRESETS, renderCalculator, renderHeroCard, renderHospitality, renderIndustryPicker, renderMeetZaina, renderStickyCta, renderValueTable } from "./home-sections.ts";
import { STUDIO_SERVICES, type StudioServiceId } from "./services.ts";

export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string
));

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect class="logo-bg" width="32" height="32" rx="9"/><path class="logo-fg" d="M9 9.5h14a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-6.2L12 25.3v-3.8H9A2.5 2.5 0 0 1 6.500 19v-7A2.5 2.500 0 0 1 9 9.500Z"/><path class="logo-bg" d="M11 13.250h10v1.600H11zm0 3.400h6.500v1.600H11z"/></svg>`;

const ICONS = {
  whatsapp: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.600 15.100L2 22l5-1.300A10 10 0 1 0 12 2Zm0 18.200a8.200 8.200 0 0 1-4.200-1.150l-.300-.180-2.950.780.790-2.880-.200-.300A8.200 8.200 0 1 1 12 20.200Zm4.500-6.140c-.250-.120-1.460-.720-1.680-.800-.230-.080-.390-.120-.560.120-.160.250-.640.800-.780.970-.140.160-.290.180-.530.060a6.700 6.700 0 0 1-1.980-1.220 7.400 7.400 0 0 1-1.370-1.700c-.140-.250 0-.380.110-.500.110-.110.250-.290.370-.430.120-.140.160-.250.250-.410.080-.160.040-.310-.020-.430-.060-.120-.560-1.340-.760-1.840-.200-.480-.410-.420-.560-.420h-.480a.920.920 0 0 0-.660.310 2.800 2.800 0 0 0-.870 2.070c0 1.220.890 2.400 1.010 2.560.120.160 1.750 2.670 4.230 3.740.590.260 1.050.410 1.410.520.590.190 1.130.160 1.560.100.480-.070 1.460-.600 1.670-1.170.200-.580.200-1.070.140-1.170-.060-.110-.220-.170-.470-.290Z"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.800 7L4 20l1.100-4.600A8 8 0 1 1 21 12Z"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500Z"/></svg>`,
  inbox: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h5l1.500 3h5L16 13h5"/><path d="M5.500 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5Z"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>`,
  people: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.500"/><path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.500a6.500 6.500 0 0 1 3.500 5.500"/></svg>`,
  code: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.500 5l-3 14"/></svg>`,
  flow: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="6" rx="1.500"/><rect x="14" y="15" width="7" height="6" rx="1.500"/><path d="M6.500 9v4a3 3 0 0 0 3 3H14"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/></svg>`,
  doc: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>`,
  spark: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900ZM19 16l.800 2.200L22 19l-2.200.800L19 22l-.800-2.200L16 19l2.200-.800Z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
};

export type SitePage = {
  /** The site's own address, without a trailing slash: for canonical links. Null when it isn't known. */
  baseUrl: string | null;
};

const PROJECT_MESSAGE = "Hello Bila Matata, I'd like to start a project. Here's what I need:";
const ZAINA_MESSAGE = "Hello Bila Matata, I'd like Zaina AI for my business.";

function head(options: { title: string; description: string; path: string; baseUrl: string | null; index?: boolean; extra?: string; image?: string }): string {
  const canonical = options.baseUrl ? `${options.baseUrl}${options.path}` : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
${options.index === false ? '<meta name="robots" content="noindex">' : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta property="og:site_name" content="${esc(STUDIO.name)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ""}
${options.baseUrl ? `<meta property="og:image" content="${esc(options.baseUrl)}${esc(options.image ?? "/site/og.png")}">\n<meta name="twitter:card" content="summary_large_image">` : ""}
<meta name="theme-color" content="#0f766e">
<link rel="icon" href="/site/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site/site.css">
${options.extra ?? ""}
</head>`;
}

function header(current: "home" | "terms" | "pay" | "start"): string {
  const home = current === "home" ? "" : "/";
  return `<a class="skip" href="#main">Skip to the content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/" aria-label="${esc(STUDIO.name)}: home">${LOGO}<span>${esc(STUDIO.name)}</span></a>
    <button class="nav-toggle" type="button" data-nav-toggle aria-controls="site-nav" aria-expanded="false">Menu</button>
    <nav class="nav" id="site-nav" aria-label="Main">
      <a href="${home}#zaina">Zaina AI</a>
      <a href="${home}#services">Services</a>
      <a href="${home}#pricing">Pricing</a>
      <a href="/app/">Client Login</a>
      <a href="/pay"${current === "pay" ? ' aria-current="page"' : ""}>Pay Invoice</a>
      <a class="nav-cta" href="${home}#contact">Contact</a>
    </nav>
  </div>
</header>`;
}

function footer(): string {
  return `<footer class="site-footer">
  <div class="wrap">
    <p>Serving businesses across Kenya and globally · WhatsApp/Call: <a href="${esc(whatsappLink("Hello Bila Matata,"))}" rel="noopener">${esc(STUDIO.phoneDisplay)}</a> · Email: <a href="mailto:${esc(STUDIO.email)}">${esc(STUDIO.email)}</a></p>
    <nav aria-label="Footer">
      <a href="/terms">Terms and privacy</a>
      <a href="/pay">Pay an invoice</a>
      <a href="/app/">Client login</a>
    </nav>
  </div>
</footer>`;
}

/** The studio's own Zaina, embedded the way every client embeds theirs. */
const ZAINA_EMBED = `<script src="/zaina.js" data-business="${STUDIO.businessId}" async></script>`;

// ── The home page ────────────────────────────────────────────────────────

const PLANS = [
  {
    name: "Starter Sales Concierge",
    monthlyMinor: 670_000,
    setupMinor: 1_000_000,
    for: "Every enquiry answered and every lead captured, without adding to your team.",
    features: [
      "Answers customers day and night, only from your own catalogue, price list and policies",
      "Understands what each customer needs and recommends what suits them",
      "Never invents a price: every quote comes straight from your price list",
      "Captures each lead's name, number and what they want",
      "Suggests the extras and upgrades you really offer, at your listed prices, without being pushy",
      "Alerts your team on their phones and hands over the whole conversation, ready to close",
      "Up to 2 notification emails, each with a takeover link and, if you like, the conversation written out",
      "Chat on your website with one line of code, or no website at all: your own page, branded QR code and business cards to print",
      "Your logo, colours and welcome line on the chat and your page",
      "Dashboard with every chat, lead and report, and help from our team",
    ],
    featured: false,
  },
  {
    name: "Full Booking & Quote Engine",
    monthlyMinor: 1_100_000,
    setupMinor: 2_000_000,
    for: "For businesses that sell by appointment, reservation or quote: Zaina finishes the sale.",
    features: [
      "Everything in Starter",
      "Checks your up-to-date calendar before she offers a time",
      "Works out exact totals from your own rates: dates, number of people and fees included",
      "Helps each customer find the right option, then books it from start to finish",
      "Sends your own M-Pesa or card payment link 24/7: customers pay you directly",
      "Up to 5 notification emails, with takeover links and conversation transcripts",
      "Calendar sync and booking notices for your team",
    ],
    featured: true,
  },
];

const OUTCOMES = [
  { icon: ICONS.moon, title: "Stop losing the customers who message after hours", text: "Zaina replies in seconds, at midnight and on Sunday. The customer who would have gone to whoever answered first stays with you." },
  { icon: ICONS.spark, title: "Smart enough to sell, not just reply", text: "Zaina works out what each customer is really after, asks the one question that matters, recommends the option that suits them from what you actually sell, and always offers the next step: a time, a quote or a call from your team." },
  { icon: ICONS.lock, title: "Answers you can stand behind: nothing invented", text: "Zaina doesn't guess. Everything she says comes directly from your business: your catalogue, your policies and your price list. She never makes up a price, and if an answer isn't in your information she says so and brings in your team." },
  { icon: ICONS.calendar, title: "From \"do you have…?\" to booked", text: "She helps each customer find what suits them, checks your up-to-date calendar, quotes the exact price, creates the booking and sends your own M-Pesa or card payment link, so the deposit is paid straight to you." },
  { icon: ICONS.inbox, title: "Wake up to leads that are ready to close", text: "Every serious enquiry arrives with a name, a number and exactly what the customer wants, so your team's first message is the offer, not twenty questions." },
  { icon: ICONS.people, title: "Your team does the work only people can do", text: "Repeat questions stop landing on your staff. When a customer needs a person, Zaina hands over the whole conversation and your team picks up where she left off." },
];

// The comparison is with what business owners already use and dislike: auto-replies and basic chatbots.
// No other company is named on the page. Every Zaina claim here is something she really does (Full plan
// for availability, totals, booking and checkout: the note under the table says so).
const COMPARISON: Array<[string, string, string]> = [
  ["Live availability", "Reply \"We'll check and get back to you\", and impatient buyers go to whoever answers first", "Checks your up-to-date calendar the moment a customer asks, and offers only the times or dates that are really free"],
  ["Accurate price quotes", "Send a static price list or guess, so your staff still have to step in and work out the total", "Works out the exact total from your own rates for the dates, the number of people and your fees. Never a guessed figure"],
  ["Answers you can trust", "Guess, or answer from general knowledge that isn't about your business", "Answers only from your own information. If something isn't there, she says so and brings in your team"],
  ["Recommendations and extras", "Only answer what was asked, and leave money on the table", "Recommends what suits each customer and suggests the extras and upgrades you really offer, at your listed prices"],
  ["Booking and checkout", "Stop at chatting: your staff still create the order and chase the payment", "Creates the booking and sends your own M-Pesa or card payment link, 24/7 while you sleep. Customers pay you directly"],
  ["Hand-off to your team", "Trap frustrated customers in a loop, or dump messy chats on your phone", "Passes complex or VIP requests to your team with the whole conversation and the customer's details, ready to close"],
];

const SERVICE_ICONS: Record<StudioServiceId, string> = { software: ICONS.code, automation: ICONS.flow, data: ICONS.chart, research: ICONS.doc };

export function renderHome(page: SitePage): string {
  const title = "Bila Matata | AI Sales Concierge, Software, Data & Research Studio in Mombasa";
  const description = "Zaina AI answers your customers day and night from your own prices and calendar, captures leads and takes bookings. Plus custom websites and apps, AI automation, data analysis and research, from a studio in Mombasa, Kenya.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: STUDIO.name,
    description,
    ...(page.baseUrl ? { url: page.baseUrl } : {}),
    telephone: STUDIO.phone,
    email: STUDIO.email,
    address: { "@type": "PostalAddress", addressLocality: "Mombasa", addressCountry: "KE" },
    areaServed: ["Kenya", "Worldwide"],
    makesOffer: PLANS.map((plan) => ({
      "@type": "Offer",
      name: `Zaina AI: ${plan.name}`,
      price: plan.monthlyMinor / 100,
      priceCurrency: "KES",
      description: plan.for,
    })),
  };
  const projectLink = esc(whatsappLink(PROJECT_MESSAGE));
  return `${head({
    title,
    description,
    path: "/",
    baseUrl: page.baseUrl,
    extra: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`,
  })}
<body>
${header("home")}
<main id="main">

<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">AI · Software · Data · Research, from Mombasa</p>
      <h1>Run Your Business <em>Without the Hassle.</em></h1>
      <p class="lede">24/7 AI sales &amp; booking concierges, custom web &amp; mobile apps, AI automation, and data-backed research that help businesses capture more leads and scale effortlessly.</p>
      <div class="cta-row">
        <a class="btn btn-primary" href="#zaina" data-open-zaina>${ICONS.chat}Try Zaina AI Live</a>
        <a class="btn btn-ghost" href="${projectLink}" rel="noopener">${ICONS.whatsapp}Start a Project on WhatsApp</a>
      </div>
      ${renderIndustryPicker()}
      <p class="hero-note">Meet Zaina, the team member we set up for your business: she answers every enquiry in seconds, and books the sale while you sleep.</p>
      <ul class="chips" aria-label="At a glance">
        <li>Replies in seconds, day and night</li>
        <li>Answers only from your business</li>
        <li>No invented prices</li>
        <li>English and Swahili</li>
        <li>Website and WhatsApp</li>
      </ul>
    </div>
    ${renderHeroCard()}
  </div>
</section>

${renderDemo()}

${renderMeetZaina(ICONS)}

${renderHospitality(ICONS)}

<section class="band alt" id="zaina" aria-labelledby="zaina-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Zaina AI</p>
      <h2 id="zaina-title">Your 24/7 AI sales closer and booking engine</h2>
      <p>Customers buy from the business that answers first and answers well. Zaina replies the moment an enquiry arrives on your website or WhatsApp, understands what the customer actually needs, and answers using only what your business gives her: your catalogue, your price list and your up-to-date calendar. She helps each customer find the right option, then turns the conversation into a lead or a paid booking.</p>
    </div>
    <div class="grid two">
      ${OUTCOMES.map((item) => `<article class="card"><div class="icon">${item.icon}</div><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></article>`).join("\n      ")}
    </div>
    <div class="cta-row">
      <a class="btn btn-primary" href="#zaina" data-open-zaina>${ICONS.chat}Chat with Zaina now</a>
      <a class="btn btn-ghost" href="#pricing">See pricing</a>
    </div>
  </div>
</section>

<section class="band" id="compare" aria-labelledby="compare-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Why Zaina</p>
      <h2 id="compare-title">Not just another chatbot: Zaina actually closes bookings</h2>
      <p>Auto-responders and generic chatbots leave customers waiting for someone to check availability and work out the price. Zaina is a sales engine wired into your own rates, calendar and checkout, so she answers, quotes and books on the spot.</p>
    </div>
    <div class="table-scroll">
      <table class="compare">
        <thead><tr><th scope="col">What your customers need</th><th scope="col">Basic auto-responders &amp; generic bots</th><th scope="col" class="us">Zaina AI, built for revenue</th></tr></thead>
        <tbody>
          ${COMPARISON.map(([what, generic, zaina]) => `<tr><th scope="row">${esc(what)}</th><td class="them">${esc(generic)}</td><td class="us">${esc(zaina)}</td></tr>`).join("\n          ")}
        </tbody>
      </table>
    </div>
    <p class="fine">Live availability, exact booking totals, booking and checkout come with the Full Booking &amp; Quote Engine. The Starter plan answers from your catalogue and price list and hands every lead to your team. <a href="#pricing">Compare the plans</a>.</p>
  </div>
</section>

${renderValueTable({ starter: PLANS[0], full: PLANS[1] })}

${renderCalculator({ starter: PLANS[0].monthlyMinor, full: PLANS[1].monthlyMinor })}

<section class="band alt" id="pricing" aria-labelledby="pricing-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Pricing</p>
      <h2 id="pricing-title">Simple monthly pricing for Zaina AI</h2>
      <p>One set-up fee, one monthly price. The Starter plan costs about KES 220 a day: compare that with what one missed customer is worth to your business.</p>
    </div>
    <div class="plans">
      ${PLANS.map((plan) => `<article class="plan${plan.featured ? " featured" : ""}">
        ${plan.featured ? '<span class="tag">Finishes the sale</span>' : '<span class="tag">Start here</span>'}
        <h3>${esc(plan.name)}</h3>
        <p class="price">${esc(formatMoney(plan.monthlyMinor, "KES"))} <small>/ month</small></p>
        <p class="setup">+ ${esc(formatMoney(plan.setupMinor, "KES"))} one-off set-up</p>
        <p class="breakeven" data-breakeven="${plan.monthlyMinor}">Covered by just <strong>${breakEvenBookings(plan.monthlyMinor, CALC_PRESETS.hotel.valueKes)} booking${breakEvenBookings(plan.monthlyMinor, CALC_PRESETS.hotel.valueKes) === 1 ? "" : "s"}</strong> worth <span data-breakeven-value>${esc(formatMoney(CALC_PRESETS.hotel.valueKes * 100, "KES"))}</span>. <a href="#worth">Use your own numbers</a></p>
        <p class="for">${esc(plan.for)}</p>
        <ul>${plan.features.map((feature) => `<li>${esc(feature)}</li>`).join("")}</ul>
        <a class="btn ${plan.featured ? "btn-primary" : "btn-ghost"}" href="/start?service=${plan.featured ? "zaina_full" : "zaina_starter"}">Get ${esc(plan.name.split(" ")[0])} for my business</a>
        <a class="plan-alt" href="${esc(whatsappLink(`${ZAINA_MESSAGE} I'm interested in the ${plan.name} plan.`))}" rel="noopener">or ask on WhatsApp</a>
      </article>`).join("\n      ")}
    </div>
    <article class="plan-extra" aria-labelledby="system-title">
      <div>
        <span class="tag">Already have your own system?</span>
        <h3 id="system-title">Zaina inside your own shop or booking system</h3>
        <p>If you already sell online or take bookings in a system of your own, Zaina connects to it, so every answer is live and nothing is typed twice.</p>
        <ul>
          <li>Prices, stock and free dates come straight from your system</li>
          <li>"Where's my order?" answered privately, only to the customer it belongs to</li>
          <li>Ready to buy? Customers go to your own checkout, and the money goes to you</li>
          <li>New leads and bookings arrive in your system as they happen</li>
        </ul>
      </div>
      <div class="plan-extra-cta">
        <p class="price">Quoted for your system</p>
        <p class="setup">Added to either plan, after a free look at what you use today</p>
        <a class="btn btn-primary" href="/start?service=zaina_system">Ask about connecting my system</a>
      </div>
    </article>
    <p class="fine">Prices are in Kenya shillings. Set-up is paid once and covers loading your catalogue and prices, tuning Zaina's answers with you, and installation. Monthly plans are billed in advance and you can cancel at any time; see the <a href="/terms">terms</a>. Already a client? <a href="/app/">Sign in</a> or <a href="/pay">pay an invoice</a>.</p>
    <div class="snippet" role="img" aria-label="The one line of code that adds Zaina to a website">&lt;script src="${esc(page.baseUrl ?? "https://bilamatata.com")}/zaina.js" data-business="your-business" async&gt;&lt;/script&gt;</div>
    <p class="fine">That one line adds Zaina to any website: WordPress, Shopify, Wix or custom-built.</p>
  </div>
</section>

<section class="band" id="services" aria-labelledby="services-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">Services</p>
      <h2 id="services-title">Beyond Zaina: what the studio builds for you</h2>
      <p>The same team that builds Zaina takes on custom work. Every project starts with a free consultation and a fixed written quote, so you know the price before you pay anything.</p>
    </div>
    <div class="grid four">
      ${STUDIO_SERVICES.map((service) => `<article class="card service"><div class="icon">${SERVICE_ICONS[service.id]}</div><h3>${esc(service.title)}</h3><p>${esc(service.text)}</p><ul>${service.points.map((point) => `<li>${esc(point)}</li>`).join("")}</ul><p class="from"><span>From</span> ${esc(formatMoney(service.fromMinor, "KES"))}</p><a class="btn btn-primary" href="/start?service=${service.id}">Book a free consultation</a></article>`).join("\n      ")}
    </div>
  </div>
</section>

<section class="band alt" id="how" aria-labelledby="how-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">How it works</p>
      <h2 id="how-title">From first message to delivery</h2>
    </div>
    <ol class="steps">
      <li><h3>Tell us what you need</h3><p>Message us on WhatsApp or ask Zaina on this page. A short call if it helps.</p></li>
      <li><h3>Get a written quote</h3><p>Scope, price and delivery date in writing, before you pay anything.</p></li>
      <li><h3>Pay the deposit to start</h3><p>50% to begin project work, paid securely by M-Pesa or card on our <a href="/pay">payment page</a>.</p></li>
      <li><h3>Review and go live</h3><p>You review the work, we make the agreed changes, and the balance is due on delivery.</p></li>
    </ol>
  </div>
</section>

<section class="band" id="contact" aria-labelledby="contact-title">
  <div class="wrap">
    <div class="contact">
      <div>
        <h2 id="contact-title">Tell us what's slowing your business down</h2>
        <p>We reply on WhatsApp during working hours, Monday to Saturday. Zaina answers on this page at any hour and passes your details to the team.</p>
        <div class="cta-row">
          <a class="btn btn-primary" href="${projectLink}" rel="noopener">${ICONS.whatsapp}Start a Project on WhatsApp</a>
        </div>
      </div>
      <ul class="ways">
        <li><span>WhatsApp or call</span><a href="tel:${esc(STUDIO.phone)}">${esc(STUDIO.phoneDisplay)}</a></li>
        <li><span>Email</span><a href="mailto:${esc(STUDIO.email)}">${esc(STUDIO.email)}</a></li>
        <li><span>Studio</span>${esc(STUDIO.city)}</li>
      </ul>
    </div>
  </div>
</section>

</main>
${footer()}
${renderStickyCta()}
<script src="/site/site.js" defer></script>
${ZAINA_EMBED}
</body>
</html>`;
}

// ── Terms ────────────────────────────────────────────────────────────────

/** The day the terms were last changed, as the page shows it. */
export const TERMS_UPDATED = "13 November 2026";

export function renderTerms(page: SitePage): string {
  const mail = `<a href="mailto:${esc(STUDIO.email)}">${esc(STUDIO.email)}</a>`;
  return `${head({
    title: "Terms of Service and Privacy | Bila Matata",
    description: "How Bila Matata works with clients: project deposits and delivery, Zaina AI subscriptions, payments and refunds, and how personal data is handled under Kenya's Data Protection Act.",
    path: "/terms",
    baseUrl: page.baseUrl,
  })}
<body>
${header("terms")}
<main id="main" class="doc">
  <div class="wrap">
    <h1>Terms of Service and Privacy</h1>
    <p class="updated">Last updated: ${esc(TERMS_UPDATED)}</p>
    <p>These terms apply when you use bilamatata.com, buy a service from ${esc(STUDIO.name)} ("we", "us"), or subscribe to Zaina AI. ${esc(STUDIO.name)} is an AI, software development, data analysis and research studio based in ${esc(STUDIO.city)}. A written quote or agreement we both accept adds to these terms and, where the two differ, the quote or agreement applies.</p>

    <nav class="toc" aria-label="On this page">
      <strong>On this page</strong>
      <ol>
        <li><a href="#projects">Project work</a></li>
        <li><a href="#zaina-terms">Zaina AI subscriptions</a></li>
        <li><a href="#payments">Payments and refunds</a></li>
        <li><a href="#privacy">Privacy and data protection</a></li>
        <li><a href="#general">General terms</a></li>
        <li><a href="#contact-us">Contact</a></li>
      </ol>
    </nav>

    <h2 id="projects">1. Project work</h2>
    <p>This section covers websites and mobile apps, AI automation and workflow systems, data analysis and business intelligence, and research and professional writing.</p>
    <h3>Quotes and scope</h3>
    <ul>
      <li>Every project starts with a written quote that sets out what we will deliver, the price and the expected delivery date. A quote is valid for 30 days unless it says otherwise.</li>
      <li>Work outside the quote (new features, extra pages, a wider research question) is quoted separately before we start it.</li>
    </ul>
    <h3>Deposit and balance</h3>
    <ul>
      <li>We start work once a deposit of 50% of the quoted price is paid.</li>
      <li>The remaining 50% is due on delivery, before final files, source code, logins or reports are handed over or a system goes live.</li>
      <li>Larger projects may be split into milestones with their own payments; the quote says so where that applies.</li>
    </ul>
    <h3>Working together</h3>
    <ul>
      <li>Delivery dates depend on you giving us the content, access and feedback we ask for in good time. If we are kept waiting, the date moves by the same time.</li>
      <li>Each quote includes the rounds of revisions it states (two rounds where it doesn't say). Further changes are charged at the rate in the quote.</li>
      <li>After delivery you have 7 days to tell us about anything that doesn't match the quote, and we fix it at no charge. After that the work is treated as accepted.</li>
    </ul>
    <h3>Ownership</h3>
    <ul>
      <li>Once the project is paid in full, the work we created for you is yours. Until then it remains ours.</li>
      <li>We keep the rights to our own tools, code libraries and methods that existed before your project or that are not specific to it, and you get a licence to use them as part of what we delivered.</li>
      <li>Third-party items (fonts, stock images, plugins, hosting, app-store accounts) come under their own licences and fees, which the quote lists where we know them.</li>
      <li>We may mention that we worked with you and show the public parts of the work, unless you ask us not to.</li>
    </ul>
    <h3>Research and writing</h3>
    <ul>
      <li>We report what the evidence shows and cite our sources. We can't promise that research will reach a particular conclusion, or that a proposal or application will be approved or funded.</li>
      <li>You are responsible for how you use and present the documents we prepare, including any rules of the institution or funder you submit them to.</li>
    </ul>

    <h2 id="zaina-terms">2. Zaina AI subscriptions</h2>
    <h3>Plans and billing</h3>
    <ul>
      <li>Zaina AI is sold as a monthly plan plus a one-off set-up fee. Current prices are on our <a href="/#pricing">pricing section</a>; your plan and price are confirmed in your dashboard and on your invoices.</li>
      <li>The set-up fee is due before set-up begins. The monthly fee is billed in advance for each month.</li>
      <li>If an invoice is not paid by its due date, we remind you. If it is still unpaid after the grace period shown on the invoice, your Zaina is paused until it is paid. Your data is kept during the pause.</li>
      <li>We may change prices with at least 30 days' notice. A change never applies to a month you have already paid for.</li>
    </ul>
    <h3>Cancelling</h3>
    <ul>
      <li>You can cancel at any time from your dashboard or by writing to us. Your plan runs to the end of the month you have paid for and then stops; there is no cancellation fee.</li>
      <li>After a plan ends you can ask for an export of your conversations and leads within 30 days. After that we delete them as described under <a href="#privacy">Privacy</a>.</li>
    </ul>
    <h3>How Zaina answers</h3>
    <ul>
      <li>Zaina answers your customers only from the information your business provides: your catalogue, price list, opening hours, policies and calendar. She quotes prices only from your price list and checks availability against your up-to-date calendar.</li>
      <li>Where an answer isn't in your information, Zaina says so and hands the conversation to your team rather than guess.</li>
      <li>Her answers are only as accurate as the information she is given. You are responsible for keeping your catalogue, prices and calendar correct and up to date. If you ever see an answer that isn't right, tell us and we will correct it.</li>
      <li>We do not promise a particular number of leads, bookings or sales.</li>
      <li>Each plan includes a fair-use allowance of AI conversations a day. If your business regularly needs more, we will agree a plan that fits before anything changes.</li>
      <li>We aim to keep Zaina available at all times but do not guarantee uninterrupted service. Planned maintenance is announced in advance where we can.</li>
    </ul>
    <h3>Your customers' payments</h3>
    <ul>
      <li>Zaina never collects or holds your customers' money. When a deposit or payment is due, she sends your customer your own payment link, and the money is paid into your own payment account (the M-Pesa or card payment account you connect), not ours. You are the seller, and refunds and disputes for those payments are between you and your customer.</li>
      <li>Your payment provider's fees and rules apply to those payments.</li>
    </ul>
    <h3>Acceptable use</h3>
    <ul>
      <li>You may not use Zaina to break the law, to mislead customers, to send unsolicited bulk messages, or to sell anything your payment provider or WhatsApp does not allow.</li>
      <li>If you connect Zaina to WhatsApp, WhatsApp's business terms and policies also apply to you.</li>
      <li>We may pause an account that puts the service or other clients at risk, and we will tell you why.</li>
    </ul>

    <h2 id="payments">3. Payments and refunds</h2>
    <ul>
      <li>Invoices are paid on our <a href="/pay">payment page</a> by M-Pesa or card. You pay on a licensed payment provider's secure page; we never see or store your card number or M-Pesa PIN. Zaina AI monthly invoices can also be paid from your dashboard.</li>
      <li>Prices are in Kenya shillings unless an invoice says otherwise, and include the taxes shown on the invoice.</li>
      <li>You receive a receipt by email for each payment.</li>
    </ul>
    <h3>Refunds</h3>
    <ul>
      <li><strong>Paid twice or charged the wrong amount:</strong> we refund the difference in full.</li>
      <li><strong>Project deposits:</strong> if you cancel before we start work, we refund the deposit in full. Once work has started, the deposit covers the work done up to that point: we refund any part that exceeds the value of that work, and hand over what has been completed.</li>
      <li><strong>If we can't deliver:</strong> if we are unable to deliver what the quote sets out, we refund what you paid for the part not delivered.</li>
      <li><strong>Zaina set-up fees:</strong> refundable in full before set-up begins; not refundable once your Zaina has been set up and shown to you.</li>
      <li><strong>Zaina monthly fees:</strong> not refunded for part of a month, except where the service was unavailable for a significant part of it through our fault, in which case we credit the days lost.</li>
      <li>To ask for a refund, write to ${mail} with your invoice reference. Approved refunds are returned to the M-Pesa number or card that paid, usually within 10 working days.</li>
    </ul>
    <p>Nothing in these terms limits rights you have under Kenyan consumer protection law.</p>

    <h2 id="privacy">4. Privacy and data protection</h2>
    <p>We handle personal data in line with Kenya's Data Protection Act, 2019 and its regulations.</p>
    <h3>What we collect, and why</h3>
    <ul>
      <li><strong>When you contact us or become a client:</strong> your name, business name, phone number, email address and what you tell us about your project, so we can quote, deliver and support the work.</li>
      <li><strong>When you chat with Zaina on this website:</strong> the messages you send, and any name or contact details you choose to give, so we can answer you and follow up on your enquiry.</li>
      <li><strong>When you pay us:</strong> the invoice, amount, date, payment reference and the email address for your receipt. Card and M-Pesa details are handled by our payment provider and are not stored by us.</li>
      <li><strong>When you sign in to your dashboard:</strong> your email address, a protected (hashed) password and a sign-in cookie that keeps you signed in.</li>
    </ul>
    <p>We use this data to provide the service you asked for, to meet our contract with you, to keep the accounting records the law requires, and to keep the service secure. We do not sell personal data and we do not use advertising trackers on this website.</p>
    <h3>Zaina clients: your customers' data</h3>
    <ul>
      <li>When your customers chat with your Zaina, you decide why and how their data is used: you are the data controller, and we process it on your behalf and only on your instructions.</li>
      <li>Each business's conversations, leads and bookings are kept separate from every other business's.</li>
      <li>Conversations are deleted automatically after the retention period set for your business (90 days unless we agree another period with you).</li>
      <li>You are responsible for telling your customers how you use their data, for example in your own privacy notice.</li>
    </ul>
    <h3>Who helps us provide the service</h3>
    <p>We share data only with the providers needed to run the service, each under its own data protection terms: our hosting and database providers; Google, whose AI model generates Zaina's replies; our payment providers, for card and M-Pesa payments; Meta, if WhatsApp is connected; and our email provider for receipts and alerts. Some of these providers process data outside Kenya; where they do, we rely on the safeguards the Act requires for transfers. You can ask us for the current list of providers at any time.</p>
    <h3>How long we keep data</h3>
    <ul>
      <li>Chat conversations: for the retention period above, then deleted.</li>
      <li>Project files and correspondence: for the life of the project and up to two years after, unless you ask us to delete them sooner.</li>
      <li>Invoices and payment records: for as long as tax and accounting law requires.</li>
    </ul>
    <h3>Your rights</h3>
    <p>You can ask us what personal data we hold about you, ask for a copy, ask us to correct or delete it, or object to how we use it. Write to ${mail} and we will answer within the time the Act allows. If you are a customer of a business that uses Zaina, please contact that business first; we will help it respond. You also have the right to complain to the Office of the Data Protection Commissioner (odpc.go.ke).</p>
    <h3>Security</h3>
    <p>Data is encrypted in transit, passwords and payment keys are stored in protected form, and access is limited to the people who need it. No system is perfectly secure; if a breach affects your data, we will tell you and the regulator as the Act requires.</p>

    <h2 id="general">5. General terms</h2>
    <ul>
      <li><strong>Confidentiality:</strong> we keep your business information confidential and use it only to deliver your work. This continues after the work ends.</li>
      <li><strong>Liability:</strong> we take care in our work, but to the extent the law allows we are not liable for indirect losses or lost profits, and our total liability for a service is limited to the amount you paid us for that service in the 12 months before the claim.</li>
      <li><strong>Events outside our control:</strong> neither of us is responsible for delays caused by events we could not reasonably prevent, such as power, network or third-party platform outages.</li>
      <li><strong>Changes to these terms:</strong> we may update these terms and will change the date at the top when we do. For clients with an active plan or project, changes that affect you are sent by email at least 14 days before they apply.</li>
      <li><strong>Law:</strong> these terms are governed by the laws of Kenya. We will first try to settle any dispute by talking to you; if that fails, the courts of Kenya have jurisdiction.</li>
    </ul>

    <h2 id="contact-us">6. Contact</h2>
    <p>${esc(STUDIO.name)}, ${esc(STUDIO.city)}. WhatsApp or call <a href="tel:${esc(STUDIO.phone)}">${esc(STUDIO.phoneDisplay)}</a>, or email ${mail}.</p>
  </div>
</main>
${footer()}
<script src="/site/site.js" defer></script>
</body>
</html>`;
}

/** The parts every studio page shares, for the payment pages. */
export const siteParts = { head, header, footer, ICONS };

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0f766e"/><path fill="#fff" d="M9 9.500h14a2.500 2.500 0 0 1 2.500 2.500v7a2.500 2.500 0 0 1-2.500 2.500h-6.200L12 25.300v-3.800H9A2.500 2.500 0 0 1 6.500 19v-7A2.500 2.500 0 0 1 9 9.500Z"/><path fill="#0f766e" d="M11 13.250h10v1.600H11zm0 3.400h6.500v1.600H11z"/></svg>`;

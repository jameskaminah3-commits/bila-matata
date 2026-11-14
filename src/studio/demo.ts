// src/studio/demo.ts
//
// The home page's demonstration: one conversation, seen from both sides at
// once. On the left, the customer's phone; on the right, the business's
// side (what Zaina does behind the reply, the alert on the owner's phone,
// and the record in the dashboard). It plays by itself, can be paused and
// replayed, and switches between kinds of business.
//
// It is a demonstration with example businesses, and says so. Everything
// in it is something Zaina does: she answers from the business's own
// information, quotes its price list, checks its calendar, books, sends
// the checkout, takes leads and hands over to a person. The real Zaina is
// the chat button on the same page.
//
// The page is complete without script: every step is in the HTML. The
// script (DEMO_JS) hides the steps and plays them back in order.

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string
));

type Tone = "ok" | "warn" | "info";
type Step =
  | { pane: "chat"; from: "customer" | "zaina" | "staff"; text: string; who?: string; pay?: string }
  | { pane: "chat"; from: "note"; text: string }
  | { pane: "work"; text: string }
  | { pane: "alert"; title: string; text: string }
  | { pane: "status"; text: string; tone: Tone }
  | { pane: "record"; kind: string; title: string; status: string; tone: Tone; lines: Array<[string, string]>; foot?: string };

type Scene = {
  id: string;
  tab: string;
  plan: "Starter" | "Full" | "Every";
  business: string;
  what: string;
  customer: string;
  time: string;
  result: string;
  steps: Step[];
};

const SCENES: Scene[] = [
  {
    id: "salon",
    tab: "Salon booking",
    plan: "Full",
    business: "Amani Hair Studio",
    what: "A late-night enquiry becomes a paid booking",
    customer: "Wanjiru",
    time: "Saturday, 11:42 pm",
    result: "Booked and paid while the owner slept. Staff time spent: none.",
    steps: [
      { pane: "status", text: "Zaina is answering", tone: "info" },
      { pane: "chat", from: "customer", text: "Hi, do you have a slot for knotless braids this Saturday?" },
      { pane: "work", text: "Found “Knotless braids” in your services: KSh 3,500, about 4 hours" },
      { pane: "work", text: "Checked your calendar for Saturday: 10:00 am and 2:30 pm are free" },
      { pane: "chat", from: "zaina", text: "Hi! Yes, Saturday has 10:00 am and 2:30 pm free. Knotless braids are KSh 3,500 and take about 4 hours. Which time suits you?" },
      { pane: "chat", from: "customer", text: "10 am. Do you also do a wash before?" },
      { pane: "work", text: "Found the extra on your price list: Wash & treatment, KSh 500" },
      { pane: "chat", from: "zaina", text: "We do: a wash & treatment is KSh 500, and you can add it on the day. Shall I book 10:00 am for you? I just need your name and number." },
      { pane: "chat", from: "customer", text: "Yes please. Wanjiru, 0700 000 123" },
      { pane: "work", text: "Created the booking and held 10:00 am for 30 minutes" },
      { pane: "work", text: "Sent the checkout for your KSh 1,000 deposit" },
      { pane: "chat", from: "zaina", text: "Done, Wanjiru. Saturday 10:00 am is held for you. Pay the deposit to confirm it:", pay: "Pay KSh 1,000 · M-Pesa or card" },
      { pane: "chat", from: "note", text: "Wanjiru paid KSh 1,000 by M-Pesa" },
      { pane: "status", text: "Booked", tone: "ok" },
      { pane: "alert", title: "New booking confirmed", text: "Wanjiru · Sat 10:00 am · Knotless braids · KSh 1,000 deposit paid" },
      { pane: "chat", from: "zaina", text: "Payment received. You're confirmed for Saturday at 10:00 am. See you then!" },
      {
        pane: "record", kind: "Booking", title: "Knotless braids · Sat 10:00 am", status: "Confirmed", tone: "ok",
        lines: [["Customer", "Wanjiru · 0700 000 123"], ["Total", "KSh 3,500"], ["Deposit", "KSh 1,000 paid by M-Pesa"], ["Balance", "KSh 2,500 on the day"]],
        foot: "Paid into your own account. It's in your bookings and on your calendar.",
      },
    ],
  },
  {
    id: "restaurant",
    tab: "Restaurant table",
    plan: "Full",
    business: "Tamarind Grill",
    what: "A group table, with a menu question answered on the way",
    customer: "Kevin",
    time: "Thursday, 3:15 pm",
    result: "A table for six booked in under a minute, during the lunch rush.",
    steps: [
      { pane: "status", text: "Zaina is answering", tone: "info" },
      { pane: "chat", from: "customer", text: "Table for 6 tomorrow evening? Two of us are vegetarian." },
      { pane: "work", text: "Checked tomorrow's tables for 6: 7:00 pm and 8:30 pm are free" },
      { pane: "work", text: "Searched your menu: 5 vegetarian mains, listed in your information" },
      { pane: "chat", from: "zaina", text: "Yes! For six tomorrow we have 7:00 pm or 8:30 pm. And the menu has five vegetarian mains, including the coconut bean curry and grilled halloumi. Which time shall I hold?" },
      { pane: "chat", from: "customer", text: "7pm. It's a birthday, can we bring a cake?" },
      { pane: "work", text: "Found your policy: own cakes welcome, no cakeage fee" },
      { pane: "chat", from: "zaina", text: "Of course, cakes are welcome and there's no fee. May I have a name and number for the booking?" },
      { pane: "chat", from: "customer", text: "Kevin 0700 000 456" },
      { pane: "work", text: "Created the booking: 6 people, Friday 7:00 pm, note “birthday, bringing a cake”" },
      { pane: "status", text: "Booked", tone: "ok" },
      { pane: "chat", from: "zaina", text: "You're booked, Kevin: a table for six on Friday at 7:00 pm. I've told the team it's a birthday. See you tomorrow!" },
      { pane: "alert", title: "New booking confirmed", text: "Kevin · Fri 7:00 pm · Table for 6 · birthday, bringing a cake" },
      {
        pane: "record", kind: "Booking", title: "Table for 6 · Fri 7:00 pm", status: "Confirmed", tone: "ok",
        lines: [["Customer", "Kevin · 0700 000 456"], ["Guests", "6 (2 vegetarian)"], ["Note", "Birthday, bringing a cake"]],
        foot: "In your bookings and on your calendar.",
      },
    ],
  },
  {
    id: "shop",
    tab: "Shop enquiry",
    plan: "Starter",
    business: "Pwani Furniture",
    what: "A price question becomes a lead your team can close",
    customer: "Brian",
    time: "Sunday, 8:05 am",
    result: "A ready-to-close lead on a Sunday morning, with everything your team needs to call back.",
    steps: [
      { pane: "status", text: "Zaina is answering", tone: "info" },
      { pane: "chat", from: "customer", text: "How much is the 6-seater dining table? Do you deliver to Nyali?" },
      { pane: "work", text: "Found it on your price list: 6-seater dining table, KSh 48,000" },
      { pane: "work", text: "Searched your information: delivery within Mombasa, KSh 1,500" },
      { pane: "chat", from: "zaina", text: "The 6-seater dining table is KSh 48,000, and yes, we deliver to Nyali for KSh 1,500. It comes in mahogany or mvule finish. Would you like our team to call you to arrange it?" },
      { pane: "chat", from: "customer", text: "Mahogany. Can I pay in two instalments?" },
      { pane: "work", text: "Searched your information: nothing about instalments. Not guessing." },
      { pane: "chat", from: "zaina", text: "I don't have the instalment terms, so I won't guess. Our team can confirm that when they call. What name and number should they use?" },
      { pane: "chat", from: "customer", text: "Brian, 0700 000 789. Call after 10." },
      { pane: "work", text: "Saved the lead with what he wants and when to call" },
      { pane: "status", text: "Lead captured", tone: "ok" },
      { pane: "chat", from: "zaina", text: "Thank you, Brian. The team will call you after 10 about the mahogany table, delivery to Nyali and instalments." },
      { pane: "alert", title: "New lead", text: "Brian wants: 6-seater dining table (mahogany), delivery to Nyali" },
      {
        pane: "record", kind: "Lead", title: "Brian · 0700 000 789", status: "New", tone: "warn",
        lines: [["Wants", "6-seater dining table, mahogany"], ["Delivery", "Nyali"], ["Asked", "Can he pay in two instalments?"], ["Call", "After 10 am"]],
        foot: "One tap to call or WhatsApp him from your dashboard.",
      },
    ],
  },
  {
    id: "takeover",
    tab: "A person takes over",
    plan: "Every",
    business: "Baraka Dental Clinic",
    what: "When a customer needs a person, your team steps in with the whole chat",
    customer: "Aisha",
    time: "Tuesday, 10:20 am",
    result: "No dead end: Zaina knew what she didn't know, and your team closed it.",
    steps: [
      { pane: "status", text: "Zaina is answering", tone: "info" },
      { pane: "chat", from: "customer", text: "Hi, how much is teeth whitening?" },
      { pane: "work", text: "Found it on your price list: Teeth whitening, KSh 12,000" },
      { pane: "chat", from: "zaina", text: "Hello! Teeth whitening is KSh 12,000, and it takes about an hour. Would you like to come in this week?" },
      { pane: "chat", from: "customer", text: "I have very sensitive teeth. Is it safe for me? I'd like to talk to someone." },
      { pane: "work", text: "A clinical question, and she asked for a person: handing over" },
      { pane: "status", text: "Waiting for your team", tone: "warn" },
      { pane: "alert", title: "A customer is waiting", text: "Aisha asks if whitening is safe for sensitive teeth, and wants a person" },
      { pane: "chat", from: "zaina", text: "That's one for our dental team, not for me to guess. I'm bringing someone in now, one moment." },
      { pane: "work", text: "Mary opened the chat in the dashboard and took over" },
      { pane: "status", text: "Mary is chatting", tone: "info" },
      { pane: "chat", from: "staff", who: "Mary · Baraka Dental", text: "Hi Aisha, Mary here from the clinic. I can see your question. For sensitive teeth the dentist uses a gentler gel and checks you first. Shall I book you a 15-minute check on Thursday?" },
      { pane: "chat", from: "customer", text: "Yes, Thursday afternoon works." },
      { pane: "chat", from: "staff", who: "Mary · Baraka Dental", text: "Booked for Thursday 2:00 pm. See you then, Aisha!" },
      { pane: "work", text: "Mary closed the chat when it was done" },
      { pane: "status", text: "Closed by Mary", tone: "ok" },
      {
        pane: "record", kind: "Conversation", title: "Aisha · website chat", status: "Handled by Mary", tone: "ok",
        lines: [["Asked", "Whitening price; safe for sensitive teeth?"], ["Zaina", "Quoted KSh 12,000, then handed over"], ["Mary", "Booked a check for Thu 2:00 pm"]],
        foot: "The whole chat stays in your history.",
      },
    ],
  },
];

const BELL = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.500 7 2.500 7h-17S6 15 6 9ZM10 20a2 2 0 0 0 4 0"/></svg>`;
const TICK = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.500" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.500 4.500 4.500L19 7.500"/></svg>`;

/** How long a step stays before the next, by what there is to read (milliseconds). */
const waitFor = (step: Step): number => {
  if (step.pane === "work") return 1100;
  if (step.pane === "status") return 350;
  if (step.pane === "alert") return 1700;
  if (step.pane === "record") return 2600;
  return Math.min(3400, 1100 + step.text.length * 22);
};

function renderScene(scene: Scene, first: boolean): string {
  const chat: string[] = [];
  const work: string[] = [];
  const alerts: string[] = [];
  const records: string[] = [];
  const statuses: Array<{ at: number; step: Extract<Step, { pane: "status" }> }> = [];
  scene.steps.forEach((step, at) => {
    const mark = `data-at="${at}" data-wait="${waitFor(step)}"`;
    if (step.pane === "chat" && step.from === "note") {
      chat.push(`<p class="demo-note" ${mark}>${TICK}${esc(step.text)}</p>`);
    } else if (step.pane === "chat") {
      const who = step.from === "staff" ? `<small class="demo-who">${esc(step.who ?? "The team")}</small>` : "";
      const pay = "pay" in step && step.pay ? `<span class="demo-pay">${esc(step.pay)}</span>` : "";
      chat.push(`<p class="bubble ${step.from === "customer" ? "them" : step.from === "staff" ? "staff" : "zaina"}" ${mark} data-typing="${step.from === "customer" ? "" : step.from}">${who}${esc(step.text)}${pay}</p>`);
    } else if (step.pane === "work") {
      work.push(`<li ${mark}>${TICK}<span>${esc(step.text)}</span></li>`);
    } else if (step.pane === "alert") {
      alerts.push(`<div class="demo-alert" ${mark} role="status"><span class="demo-bell">${BELL}</span><div><strong>${esc(step.title)}</strong><span>${esc(step.text)}</span></div></div>`);
    } else if (step.pane === "status") {
      statuses.push({ at, step });
    } else {
      records.push(`<div class="demo-record" ${mark}>
            <div class="demo-record-head"><span class="demo-kind">${esc(step.kind)}</span><span class="demo-chip ${step.tone}">${esc(step.status)}</span></div>
            <strong>${esc(step.title)}</strong>
            <dl>${step.lines.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>
            ${step.foot ? `<p>${esc(step.foot)}</p>` : ""}
          </div>`);
    }
  });
  // Without script the conversation's last status shows; the script shows each in its turn.
  const chips = statuses.map(({ at, step }, index) => {
    const until = statuses[index + 1]?.at;
    return `<span class="demo-chip ${step.tone}" data-at="${at}" data-wait="${waitFor(step)}"${until !== undefined ? ` data-until="${until}" hidden` : ""}>${esc(step.text)}</span>`;
  }).join("");
  return `<div class="demo-scene" id="demo-${scene.id}" data-scene="${scene.id}" data-steps="${scene.steps.length}" role="tabpanel" aria-labelledby="demo-tab-${scene.id}"${first ? "" : " data-later"}>
      <p class="demo-what"><span class="demo-plan">${esc(scene.plan)} plan</span>${esc(scene.what)}</p>
      <div class="demo-stage">
        <figure class="demo-phone" aria-label="What the customer sees">
          <figcaption>What your customer sees</figcaption>
          <div class="demo-screen">
            <div class="chat-head"><span class="chat-dot" aria-hidden="true">${esc(scene.business[0])}</span><div><strong>${esc(scene.business)}</strong><span>Zaina · ${esc(scene.time)}</span></div></div>
            <div class="demo-chat" data-scroll>
              ${chat.join("\n              ")}
            </div>
            <div class="demo-input" aria-hidden="true"><span>Type a message…</span></div>
          </div>
        </figure>
        <figure class="demo-desk" aria-label="What the business sees">
          <figcaption>What you see</figcaption>
          <div class="demo-panel" data-scroll>
            <div class="demo-row">
              <span class="chat-dot" aria-hidden="true">${esc(scene.customer[0])}</span>
              <div><strong>${esc(scene.customer)}</strong><span>Website chat · in your inbox</span></div>
              <span class="demo-status">${chips}</span>
            </div>
            <div class="demo-block">
              <h4>What Zaina is doing</h4>
              <ul class="demo-work">
                ${work.join("\n                ")}
              </ul>
            </div>
            <div class="demo-block">
              <h4>On your phone</h4>
              ${alerts.join("\n              ")}
            </div>
            <div class="demo-block">
              <h4>In your dashboard</h4>
              ${records.join("\n              ")}
            </div>
            <p class="demo-result" data-at="${scene.steps.length - 1}" data-wait="0">${esc(scene.result)}</p>
          </div>
        </figure>
      </div>
    </div>`;
}

/** The demonstration section of the home page. */
export function renderDemo(): string {
  return `<section class="demo band alt" id="demo" aria-labelledby="demo-title">
  <div class="wrap">
    <div class="section-head">
      <p class="eyebrow">See it work</p>
      <h2 id="demo-title">One conversation, both sides</h2>
      <p>Watch a real kind of conversation play out: what your customer sees on their phone, and what happens on your side at the same moment. Pick a business like yours.</p>
    </div>
    <div class="demo-bar">
      <div class="demo-tabs" role="tablist" aria-label="Kind of business">
        ${SCENES.map((scene, index) => `<button type="button" role="tab" id="demo-tab-${scene.id}" aria-controls="demo-${scene.id}" aria-selected="${index === 0 ? "true" : "false"}" data-demo-tab="${scene.id}">${esc(scene.tab)}</button>`).join("\n        ")}
      </div>
      <div class="demo-controls" data-demo-controls hidden>
        <button type="button" data-demo-play aria-label="Pause">Pause</button>
        <button type="button" data-demo-replay>Replay</button>
      </div>
    </div>
    <div class="demo-progress" aria-hidden="true"><span data-demo-progress></span></div>
    ${SCENES.map((scene, index) => renderScene(scene, index === 0)).join("\n    ")}
    <p class="fine demo-fine">A demonstration with example businesses: the names, prices and times are examples. Want the real thing? <a href="#zaina" data-open-zaina>Chat with our own Zaina now</a>, or <a href="/start?service=zaina_full">get her for your business</a>.</p>
  </div>
</section>`;
}

export const DEMO_SCENES = SCENES.map((scene) => ({ id: scene.id, plan: scene.plan, steps: scene.steps.length }));

export const DEMO_CSS = String.raw`
/* ── The two-sided demonstration ──────────────────────────────────── */
.demo-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-top: 30px; }
.demo-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.demo-tabs button, .demo-controls button { min-height: 42px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); font: inherit; font-size: 0.93rem; font-weight: 600; cursor: pointer; }
.demo-tabs button[aria-selected="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.demo-controls { display: flex; gap: 8px; }
.demo-controls button { background: transparent; color: var(--muted); }
.demo-progress { margin-top: 14px; height: 3px; border-radius: 3px; background: var(--line); overflow: hidden; }
.demo-progress span { display: block; height: 100%; width: 100%; background: var(--accent); transform-origin: left center; transform: scaleX(1); transition: transform 0.4s ease; }
.demo-scene { margin-top: 18px; }
.demo-scene + .demo-scene { margin-top: 44px; }
.demo-what { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-weight: 650; font-size: 1.05rem; }
.demo-plan { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.demo-stage { display: grid; grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr); gap: clamp(16px, 3vw, 32px); margin-top: 16px; align-items: stretch; }
@media (max-width: 860px) { .demo-stage { grid-template-columns: minmax(0, 1fr); } }
.demo-stage figure { margin: 0; min-width: 0; display: flex; flex-direction: column; }
.demo-stage figcaption { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
.demo-screen, .demo-panel { background: var(--bg); border: 1px solid var(--line); border-radius: 22px; box-shadow: var(--shadow); min-width: 0; }
.demo-screen { display: flex; flex-direction: column; overflow: hidden; flex: 1; }
.demo-chat { display: flex; flex-direction: column; gap: 10px; padding: 16px; height: 430px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.demo-chat .bubble { max-width: 88%; }
.demo-chat .bubble.zaina { background: var(--surface-2); }
.demo-chat .bubble.staff { align-self: flex-start; background: var(--warm-soft); border-bottom-left-radius: 5px; }
.demo-who { display: block; font-size: 0.74rem; font-weight: 700; color: var(--warm); margin: 0 0 3px; opacity: 1; }
.demo-pay { display: block; margin-top: 8px; padding: 9px 12px; border-radius: 10px; background: var(--accent); color: var(--accent-ink); font-weight: 700; font-size: 0.88rem; text-align: center; }
.demo-note { align-self: center; display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 600; color: var(--ok); background: var(--ok-soft); padding: 5px 12px; border-radius: 999px; }
.demo-note svg, .demo-work svg { width: 14px; height: 14px; flex: none; }
.demo-input { margin: 0 12px 12px; padding: 11px 14px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 0.88rem; }
.demo-typing { align-self: flex-start; display: inline-flex; gap: 4px; padding: 12px 14px; border-radius: 16px; background: var(--surface-2); }
.demo-typing.staff { background: var(--warm-soft); }
.demo-typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: demo-dot 1s infinite ease-in-out; }
.demo-typing i:nth-child(2) { animation-delay: 0.15s; }
.demo-typing i:nth-child(3) { animation-delay: 0.3s; }
@keyframes demo-dot { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
.demo-panel { padding: 16px; display: flex; flex-direction: column; gap: 16px; height: 520px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; flex: 1; }
@media (max-width: 860px) { .demo-panel { height: auto; max-height: 560px; } .demo-chat { height: 380px; } }
.demo-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: var(--surface); border: 1px solid var(--line); }
.demo-row > div { flex: 1; min-width: 0; }
.demo-row strong { display: block; font-size: 0.95rem; line-height: 1.2; }
.demo-row > div span { font-size: 0.78rem; color: var(--muted); }
.demo-chip { display: inline-flex; align-items: center; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.demo-chip.ok { background: var(--ok-soft); color: var(--ok); }
.demo-chip.warn { background: var(--warm-soft); color: var(--warm); }
.demo-chip.info { background: var(--accent-soft); color: var(--accent); }
.demo-block h4 { margin: 0 0 8px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.demo-work { margin: 0; padding: 0; list-style: none; display: grid; gap: 7px; }
.demo-work li { display: flex; gap: 8px; align-items: flex-start; font-size: 0.88rem; color: var(--ink); }
.demo-work svg { margin-top: 4px; color: var(--accent); }
.demo-alert { display: flex; gap: 10px; align-items: flex-start; padding: 11px 13px; border-radius: 14px; background: var(--ink); color: var(--bg); }
.demo-alert + .demo-alert { margin-top: 8px; }
.demo-bell { width: 30px; height: 30px; border-radius: 9px; background: color-mix(in srgb, var(--bg) 16%, transparent); display: grid; place-items: center; flex: none; }
.demo-bell svg { width: 16px; height: 16px; }
.demo-alert strong { display: block; font-size: 0.86rem; }
.demo-alert div span { font-size: 0.82rem; opacity: 0.82; }
.demo-record { padding: 13px 14px; border-radius: 14px; background: var(--surface); border: 1px solid var(--line); }
.demo-record-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.demo-kind { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.demo-record > strong { font-size: 0.98rem; }
.demo-record dl { margin: 8px 0 0; display: grid; gap: 4px; }
.demo-record dl div { display: flex; gap: 10px; font-size: 0.85rem; }
.demo-record dt { color: var(--muted); flex: none; width: 5.500em; }
.demo-record dd { margin: 0; min-width: 0; }
.demo-record p { margin-top: 8px; font-size: 0.82rem; color: var(--muted); }
.demo-result { font-size: 0.9rem; font-weight: 650; color: var(--accent); padding-top: 12px; border-top: 1px dashed var(--line); margin-top: auto; }
.demo-fine { margin-top: 22px; }
.demo [data-at].demo-in { animation: demo-in 0.32s ease both; }
@keyframes demo-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .demo [data-at].demo-in, .demo-typing i { animation: none; }
  .demo-progress span { transition: none; }
}
`;

export const DEMO_JS = String.raw`
(function () {
  var root = document.getElementById("demo");
  if (!root) return;
  var scenes = Array.prototype.slice.call(root.querySelectorAll(".demo-scene"));
  var tabs = Array.prototype.slice.call(root.querySelectorAll("[data-demo-tab]"));
  var controls = root.querySelector("[data-demo-controls]");
  var playButton = root.querySelector("[data-demo-play]");
  var replayButton = root.querySelector("[data-demo-replay]");
  var progress = root.querySelector("[data-demo-progress]");
  if (!scenes.length || !controls) return;
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var active = scenes[0];
  var at = -1;          // the last step shown
  var playing = false;
  var visible = false;
  var timer = null;
  var typing = null;

  function steps(scene) { return Array.prototype.slice.call(scene.querySelectorAll("[data-at]")); }
  function total(scene) { return Number(scene.getAttribute("data-steps")) || 0; }
  function clearTyping() { if (typing && typing.parentNode) typing.parentNode.removeChild(typing); typing = null; }

  // Shows everything up to a step (and each status only until the next one replaces it).
  function show(scene, upTo, animate) {
    steps(scene).forEach(function (el) {
      var n = Number(el.getAttribute("data-at"));
      var until = el.getAttribute("data-until");
      var on = n <= upTo && (until === null || upTo < Number(until));
      if (on && el.hidden && animate && n === upTo) el.classList.add("demo-in"); else if (!on) el.classList.remove("demo-in");
      el.hidden = !on;
    });
    Array.prototype.forEach.call(scene.querySelectorAll("[data-scroll]"), function (box) { box.scrollTop = box.scrollHeight; });
    if (progress) progress.style.transform = "scaleX(" + (total(scene) ? Math.max(0, upTo + 1) / total(scene) : 1) + ")";
  }

  function setPlaying(on) {
    playing = on;
    playButton.textContent = on ? "Pause" : (at >= total(active) - 1 ? "Play again" : "Play");
    playButton.setAttribute("aria-label", playButton.textContent);
    if (!on) { clearTimeout(timer); timer = null; clearTyping(); }
  }

  function next() {
    timer = null;
    if (!playing || !visible) return;
    if (at >= total(active) - 1) { setPlaying(false); return; }
    var upcoming = active.querySelector('[data-at="' + (at + 1) + '"]');
    var who = upcoming ? upcoming.getAttribute("data-typing") : null;
    var reveal = function () {
      clearTyping();
      at += 1;
      show(active, at, true);
      var wait = upcoming ? Number(upcoming.getAttribute("data-wait")) || 900 : 900;
      timer = setTimeout(next, wait);
    };
    // Zaina and the team "type" before their message appears.
    if (who && !calm) {
      var chat = active.querySelector(".demo-chat");
      typing = document.createElement("span");
      typing.className = "demo-typing" + (who === "staff" ? " staff" : "");
      typing.setAttribute("aria-hidden", "true");
      typing.appendChild(document.createElement("i")); typing.appendChild(document.createElement("i")); typing.appendChild(document.createElement("i"));
      chat.appendChild(typing);
      chat.scrollTop = chat.scrollHeight;
      timer = setTimeout(reveal, 850);
    } else reveal();
  }

  function start(scene, fromStart) {
    clearTimeout(timer); timer = null; clearTyping();
    active = scene;
    scenes.forEach(function (other) { other.hidden = other !== scene; });
    tabs.forEach(function (tab) { tab.setAttribute("aria-selected", tab.getAttribute("data-demo-tab") === scene.getAttribute("data-scene") ? "true" : "false"); });
    if (fromStart) at = -1;
    show(scene, at, false);
    // With reduced motion nothing plays by itself: the whole conversation is shown, and Play steps through it.
    if (calm && fromStart && !playing) { at = total(scene) - 1; show(scene, at, false); setPlaying(false); return; }
    setPlaying(true);
    if (visible) timer = setTimeout(next, 500);
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var scene = root.querySelector('.demo-scene[data-scene="' + tab.getAttribute("data-demo-tab") + '"]');
      if (!scene) return;
      playing = !calm;
      start(scene, true);
    });
  });
  playButton.addEventListener("click", function () {
    if (playing) { setPlaying(false); return; }
    if (at >= total(active) - 1) at = -1;
    playing = true;
    show(active, at, false);
    setPlaying(true);
    timer = setTimeout(next, 300);
  });
  replayButton.addEventListener("click", function () { playing = true; start(active, true); });

  controls.hidden = false;
  start(active, true);
  // It plays while it is on screen, and waits while it isn't.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && playing && !timer) timer = setTimeout(next, 400);
      if (!visible) { clearTimeout(timer); timer = null; clearTyping(); }
    }, { threshold: 0.25 }).observe(root);
  } else { visible = true; if (playing) timer = setTimeout(next, 400); }
})();
`;

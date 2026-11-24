// Zaina's place on a team (her role, her voice, her face), the notification
// emails a business can add, and the home page's calculator.

import assert from "node:assert/strict";
import test from "node:test";
import { ZAINA_FACE_DATA_URI, ZAINA_FACE_SVG } from "../../src/brand/zaina-face.ts";
import { CONCIERGE_GUIDANCE } from "../../src/engine/concierge.ts";
import { defaultGreeting, personaLine, personaRole } from "../../src/engine/persona.ts";
import { recipientEmail, type RecipientAlert } from "../../src/notifications/dispatch.ts";
import { TIER_NOTIFICATION_EMAILS, validateRecipient, type Recipient } from "../../src/notifications/store.ts";
import { breakEvenBookings, calculate, CALC_PRESETS, INDUSTRIES } from "../../src/studio/home-sections.ts";

test("Zaina joins the team with a role that fits the business, and the business can rename it", () => {
  assert.equal(personaRole({ businessType: "guesthouse" }, null), "guest experience host");
  assert.equal(personaRole({ businessType: "salon" }, undefined), "client care host");
  assert.equal(personaRole({ businessType: "restaurant" }, {}), "reservations host");
  assert.equal(personaRole({ businessType: "general" }, { personaRole: "   " }), "customer care host", "a blank role falls back");
  assert.equal(personaRole({ businessType: "guesthouse" }, { personaRole: "  Front Desk Host " }), "front desk host");
  assert.equal(
    personaLine("Zaina", "guest experience host", "Palm Cove Stays"),
    "You are Zaina, the guest experience host on the Palm Cove Stays team: a member of the team, not an outside assistant. You speak for Palm Cove Stays as one of its people",
  );
  assert.equal(defaultGreeting("Zaina", "client care host", "Amani Hair Studio"), "Hi, I'm Zaina, the client care host at Amani Hair Studio. How can I help you today?");
});

test("she speaks as one of the team, never as a generic bot, and never claims to be a person", () => {
  assert.match(CONCIERGE_GUIDANCE, /member of this business's team, not a generic assistant/);
  assert.match(CONCIERGE_GUIDANCE, /say "we" and "our"/);
  assert.match(CONCIERGE_GUIDANCE, /Never describe yourself as "just a bot", "an AI language model" or "a generic assistant"/);
  assert.match(CONCIERGE_GUIDANCE, /never claim to be a human, and you never deny being an AI/);
  assert.match(CONCIERGE_GUIDANCE, /If someone sincerely asks whether you are a person or a bot, answer honestly/);
  // The persona changes how she sounds, not where facts come from.
  assert.match(CONCIERGE_GUIDANCE, /Every fact, price, time and policy still comes only from the tools/);
});

test("she has a face: one picture, the same everywhere it is used", () => {
  assert.match(ZAINA_FACE_SVG, /^<svg[^>]+viewBox=/);
  assert.doesNotMatch(ZAINA_FACE_SVG, /<script|\son[a-z]+=|href=|url\(\s*["']?https?:|<image/i, "nothing in the picture can run or load anything");
  assert.ok(ZAINA_FACE_DATA_URI.startsWith("data:image/svg+xml"));
  assert.ok(Buffer.byteLength(ZAINA_FACE_SVG) < 20_000, "small enough to ship with the widget");
});

test("a notification address is checked, normalised, and must get something", () => {
  assert.deepEqual(validateRecipient({ email: "  Reception@Palm-Cove.example.com ", label: "  Front   desk ", transcripts: true }), {
    ok: true,
    value: { email: "reception@palm-cove.example.com", label: "Front desk", notifyAlerts: true, sendTranscripts: true },
  });
  assert.deepEqual(validateRecipient({ email: "owner@example.com" }), { ok: true, value: { email: "owner@example.com", label: null, notifyAlerts: true, sendTranscripts: false } });
  for (const email of ["", "nobody", "a@b", "two words@example.com", 5, undefined]) assert.equal(validateRecipient({ email }).ok, false, String(email));
  assert.equal(validateRecipient({ email: "a@example.com", alerts: false }).ok, false, "alerts off and no transcripts means nothing to send");
  assert.equal(validateRecipient({ email: "a@example.com", alerts: false, transcripts: true }).ok, true);
  assert.equal(validateRecipient({ email: "a@example.com", label: "x".repeat(200) }).ok && (validateRecipient({ email: "a@example.com", label: "x".repeat(200) }) as any).value.label.length, 60);
});

test("each plan allows its own number of notification emails", () => {
  assert.deepEqual(TIER_NOTIFICATION_EMAILS, { menu: 1, starter: 2, full: 5 });
  assert.ok(TIER_NOTIFICATION_EMAILS.full > TIER_NOTIFICATION_EMAILS.starter, "the bigger plan allows more");
});

const person = (over: Partial<Recipient> = {}): Recipient => ({ id: "r1", email: "reception@example.com", label: null, notifyAlerts: true, sendTranscripts: false, createdAt: new Date(), ...over });
const alert = (over: Partial<RecipientAlert> = {}): RecipientAlert => ({ title: "A guest wants a person", body: "Grace asked for someone on the team.", sessionId: "s1", takeover: true, ...over });

test("what an address receives follows what it chose: the alert with a takeover link, the conversation, or both", () => {
  const link = "https://app.example.com/app/#/conversations/s1";
  const conversation = "Grace: Is the garden suite free?\nZaina: It is taken 24–27 December.";
  const alertOnly = recipientEmail(person(), { business: "Palm Cove Stays", alert: alert(), link, conversation });
  assert.equal(alertOnly.subject, "[Palm Cove Stays] A guest wants a person");
  assert.match(alertOnly.text, /Grace asked for someone on the team\./);
  assert.match(alertOnly.text, /Take over this chat: https:\/\/app\.example\.com/);
  assert.doesNotMatch(alertOnly.text, /Is the garden suite free/, "no transcript unless the address asked for it");
  assert.match(alertOnly.text, /reception@example\.com to its notification emails/);

  const both = recipientEmail(person({ sendTranscripts: true }), { business: "Palm Cove Stays", alert: alert(), link, conversation });
  assert.match(both.text, /Take over this chat/);
  assert.match(both.text, /The conversation[\s\S]*Is the garden suite free\?[\s\S]*It is taken 24–27 December\./);

  const transcriptsOnly = recipientEmail(person({ notifyAlerts: false, sendTranscripts: true }), { business: "Palm Cove Stays", alert: alert({ title: "Chat finished", takeover: false }), link, conversation });
  assert.doesNotMatch(transcriptsOnly.text, /Take over this chat|Open the chat/, "a transcript-only address gets no action links");
  assert.match(transcriptsOnly.text, /Is the garden suite free\?/);
});

test("the calculator is arithmetic on the visitor's numbers, and the plan cards use the same sums", () => {
  const plans = { starter: 670_000, full: 1_100_000 };
  // 500 enquiries, 30% arrive out of hours, 30% of those would have booked, KES 3,500 each.
  const salon = calculate({ enquiries: 500, latePct: 30, winPct: 30, valueKes: 3_500 }, plans);
  assert.equal(salon.extra, 45);
  assert.equal(salon.revenue, 157_500);
  assert.equal(salon.starterBookings, 2);
  assert.equal(salon.fullBookings, 4);
  assert.equal(Math.round(salon.fullTimes * 10) / 10, 14.3);
  assert.equal(breakEvenBookings(670_000, 3_500), 2);
  assert.equal(breakEvenBookings(1_100_000, 30_000), 1);
  // Nothing divides by zero or goes negative.
  const empty = calculate({ enquiries: 0, latePct: 0, winPct: 0, valueKes: 0 }, plans);
  assert.equal(empty.extra, 0);
  assert.equal(empty.revenue, 0);
  assert.ok(empty.starterBookings >= 1 && Number.isFinite(empty.starterTimes));
  // Each industry button has a starting example, and the picker offers exactly those.
  assert.deepEqual(INDUSTRIES.map((item) => item.id).sort(), Object.keys(CALC_PRESETS).sort());
  assert.equal(calculate(CALC_PRESETS.hotel, plans).extra, 9, "the hotel example: 120 x 30% x 25%");
});

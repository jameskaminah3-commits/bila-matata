import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingModules, capabilitiesFromType, capabilitiesOf, cleanCapabilities, usualCapabilities } from "../../src/capabilities/catalog.ts";
import { checkDraft, numbersIn, openQuestions, quoteIn } from "../../src/onboarding/describe.ts";
import { slotWords } from "../../src/connectors/platform/index.ts";

test("a business works as it always has until it chooses what it offers", () => {
  assert.deepEqual(capabilitiesFromType("guesthouse"), ["rooms"]);
  assert.deepEqual(capabilitiesFromType("salon"), ["appointments"]);
  assert.deepEqual(capabilitiesFromType("restaurant"), ["tables"]);
  assert.deepEqual(capabilitiesFromType("general"), []);
  assert.deepEqual(capabilitiesOf({ businessType: "guesthouse" }, null), ["rooms"]);
  // A hotel that also has a restaurant, a spa and transfers, in catalog order.
  assert.deepEqual(capabilitiesOf({ businessType: "guesthouse" }, { capabilities: { enabled: ["transfers", "appointments", "tables", "rooms"], updatedAt: "" } }), ["rooms", "tables", "appointments", "transfers"]);
  // A hotel is mainly rooms; its restaurant, spa or transfers are offered, never assumed.
  assert.deepEqual(usualCapabilities("stays"), ["rooms"]);
  assert.deepEqual(usualCapabilities("other"), []);
});

test("what's booked here follows the capabilities and the plan", () => {
  const hotel = ["rooms", "tables", "appointments", "transfers"] as const;
  assert.deepEqual(bookingModules({ businessType: "guesthouse", tier: "full" }, [...hotel]), { rooms: true, slotKinds: ["service", "table"] });
  assert.deepEqual(bookingModules({ businessType: "general", tier: "full" }, ["appointments"]), { rooms: false, slotKinds: ["service"] });
  // Starter: nothing is booked here; Zaina takes requests.
  assert.deepEqual(bookingModules({ businessType: "guesthouse", tier: "starter" }, [...hotel]), { rooms: false, slotKinds: [] });
  // A business on its own system books through it.
  assert.deepEqual(bookingModules({ businessType: "custom", tier: "full" }, ["rooms"]), { rooms: false, slotKinds: [] });
  assert.equal(slotWords(["service", "table"]), "appointments and table reservations");
});

test("capabilities sent by staff are checked", () => {
  assert.deepEqual(cleanCapabilities(["transfers", "rooms"]), { ok: true, value: ["rooms", "transfers"] });
  assert.equal(cleanCapabilities(["rooms", "casino"]).ok, false);
  assert.equal(cleanCapabilities("rooms").ok, false);
});

const OWNER = "We offer three types of rooms. Standard rooms accommodate two guests. Breakfast is included. Airport transfers are available at an additional cost. Reservations require a 30% deposit.";

test("a draft keeps only what the owner's words say", () => {
  const { draft, dropped } = checkDraft({
    capabilities: [{ key: "rooms", quote: "We offer three types of rooms" }, { key: "transfers", quote: "Airport transfers are available at an additional cost" }, { key: "tables", quote: "We have a lovely restaurant" }],
    rooms: [
      // The model guessed a price and a number of rooms: neither is in the quote.
      { name: "Standard room", sleeps: 2, rooms: 3, price_per_night: 8000, quote: "Standard rooms accommodate two guests." },
      // A room type the owner never named.
      { name: "Deluxe room", sleeps: 3, quote: "Deluxe rooms sleep three" },
    ],
    extras: [{ name: "Airport transfer", price: 3500, capability: "transfers", quote: "Airport transfers are available at an additional cost" }],
    deposit: { type: "percent", percent: 30, quote: "Reservations require a 30% deposit." },
    // A usual policy the owner didn't write.
    cancellation: { text: "Free cancellation up to 48 hours before arrival", quote: "Free cancellation up to 48 hours before arrival" },
    check_in: { time: "14:00", quote: "Reservations require a 30% deposit." },
    facts: [{ text: "Breakfast is included in the rate.", quote: "Breakfast is included." }, { text: "Free Wi-Fi", quote: "Free Wi-Fi everywhere" }],
  }, OWNER);
  assert.deepEqual(draft.capabilities.map((entry) => entry.key), ["rooms", "transfers"]);
  assert.deepEqual(draft.rooms, [{ name: "Standard room", sleeps: 2, rooms: null, price_per_night: null, quote: "Standard rooms accommodate two guests." }]);
  assert.deepEqual(draft.extras, [{ name: "Airport transfer", price: null, unit: null, capability: "transfers", quote: "Airport transfers are available at an additional cost" }]);
  assert.deepEqual(draft.deposit, { type: "percent", percent: 30, amount: null, quote: "Reservations require a 30% deposit." });
  assert.equal(draft.cancellation, null);
  assert.equal(draft.check_in, null);
  // Facts are the owner's own sentences.
  assert.deepEqual(draft.facts, [{ text: "Breakfast is included.", quote: "Breakfast is included." }]);
  assert.equal(dropped, 5);
});

test("a deposit is only the kind the owner's words say", () => {
  const full = checkDraft({ deposit: { type: "full", quote: "Guests pay in full before we confirm" } }, "Guests pay in full before we confirm.");
  assert.equal(full.draft.deposit?.type, "full");
  const guessed = checkDraft({ deposit: { type: "full", quote: "Reservations require a 30% deposit." } }, OWNER);
  assert.equal(guessed.draft.deposit, null);
  const wrongPercent = checkDraft({ deposit: { type: "percent", percent: 50, quote: "Reservations require a 30% deposit." } }, OWNER);
  assert.equal(wrongPercent.draft.deposit, null);
});

test("what's missing becomes a question, never a guess", () => {
  const { draft } = checkDraft({
    rooms: [{ name: "Standard room", sleeps: 2, quote: "Standard rooms accommodate two guests." }],
    extras: [{ name: "Airport transfer", capability: "transfers", quote: "Airport transfers are available at an additional cost" }],
    deposit: { type: "percent", percent: 30, quote: "Reservations require a 30% deposit." },
  }, OWNER);
  const questions = openQuestions(draft, { hasDeposit: false, hasCancellation: false, paysOnline: false, payAtVenue: false, checkIn: "14:00", checkOut: "10:00" });
  assert.deepEqual(questions, [
    "How many Standard rooms do you have?",
    "What does one Standard room cost a night?",
    "What does Airport transfer cost? Until you add it, Zaina says the team will confirm the price.",
    "What happens if a customer cancels: is anything refunded, and up to when?",
    "How do customers pay you: an M-Pesa till or paybill, card, or in person? Add it under Settings → Bookings and payments.",
    "Zaina tells guests check-in is from 14:00 and check-out by 10:00. If that's not right, change it under Settings → Bookings and payments.",
  ]);
});

test("quotes and numbers are read the way owners write them", () => {
  assert.equal(quoteIn("standard rooms  accommodate two guests", OWNER), true);
  assert.equal(quoteIn("rooms", OWNER), false, "too short to be a quote");
  assert.deepEqual(numbersIn("KSh 3,500 per car, or 4k for a van; two guests, 30%"), [3500, 4, 30, 4000, 2]);
});

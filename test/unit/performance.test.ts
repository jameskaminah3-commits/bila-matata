// The monthly Business Performance Report's rules (src/reports/performance.ts),
// without a database: months in the business's time, when the email is due,
// and an email that never mixes verified money with what's only expected.

import assert from "node:assert/strict";
import test from "node:test";
import { monthOf, previousMonth, reportDue, reportEmail, totals, type PerformanceReport } from "../../src/reports/performance.ts";

test("months are the business's own: 23:30 UTC on 31 Oct is already November in Nairobi", () => {
  assert.equal(monthOf(new Date("2026-10-31T23:30:00Z"), "Africa/Nairobi"), "2026-11");
  assert.equal(monthOf(new Date("2026-10-31T23:30:00Z"), "UTC"), "2026-10");
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.equal(previousMonth("2026-11"), "2026-10");
});

test("the report is due from 07:00 on the 1st to the 7th, for a business that was there last month", () => {
  const joined = new Date("2026-01-10T09:00:00Z");
  assert.equal(reportDue(new Date("2026-12-01T03:00:00Z"), "Africa/Nairobi", joined), null, "06:00 in Nairobi: not yet");
  assert.equal(reportDue(new Date("2026-12-01T04:30:00Z"), "Africa/Nairobi", joined), "2026-11");
  assert.equal(reportDue(new Date("2026-12-06T10:00:00Z"), "Africa/Nairobi", joined), "2026-11", "late, after an outage");
  assert.equal(reportDue(new Date("2026-12-09T10:00:00Z"), "Africa/Nairobi", joined), null);
  assert.equal(reportDue(new Date("2026-12-02T10:00:00Z"), "Africa/Nairobi", new Date("2026-12-01T10:00:00Z")), null, "joined this month");
});

test("amounts add up per currency, never across currencies", () => {
  assert.deepEqual(totals([{ currency: "KES", minor: 50000 }, { currency: "USD", minor: 2500 }, { currency: "KES", minor: "12000" }]).map((entry) => entry.display), ["KSh 620", "$25"]);
  assert.deepEqual(totals([]), []);
});

test("the email keeps verified revenue and expected amounts apart, and never counts chats as money", () => {
  const money = (minor: number) => totals([{ currency: "KES", minor }]);
  const none = { count: 0, value: [] };
  const report: PerformanceReport = {
    month: "2026-10", from: "", to: "", partial: false,
    customers: { contacted: 40, identified: 30, unidentified: 10, new: 22, returning: 8 },
    paying: { customers: 6, payments: 7, share: 15 },
    revenue: {
      verified: { total: money(1_200_000), byProvider: money(900_000), byTeam: money(300_000), throughChats: money(1_000_000), fromYourBookings: money(200_000) },
      expected: { payOnDeliveryDelivered: { count: 3, value: money(90_000) }, dueAtTheProperty: none, requestsMarkedWon: 2 },
    },
    interest: [{ name: "Family banda", kind: "room", asked: 9, bought: 2 }],
    notConverted: [],
    lost: { lapsedOrders: { count: 2, value: money(60_000) }, lapsedBookings: none, declined: none, unansweredHandoffs: 1, requestsNotFollowedUp: 3, unansweredQuestions: 4, browsedAndLeft: 12 },
    questions: [{ question: "Do you allow pets?", chats: 5, zainaCouldntAnswer: true }],
    timeSaved: { minutes: 300, chatsWithoutTeam: 35, bookingsAndOrders: 20, automaticUpdates: 60, assumptions: { minutesPerChat: 4, minutesPerBookingOrOrder: 5, minutesPerUpdate: 1 } },
    lastMonth: { contacted: 31, payingCustomers: 4, verified: money(800_000) },
  };
  const email = reportEmail(report, "Lakehouse Lodge", "https://bilamatata.com/app/#/b/lakehouse/reports/2026-10");
  assert.equal(email.subject, "October 2026 with Zaina: 40 people, KSh 12,000 verified");
  assert.match(email.text, /VERIFIED revenue \(payments that settled\): KSh 12,000\n  confirmed by Paystack or M-Pesa: KSh 9,000\n  recorded by your team \(M-Pesa codes, cash, bank\): KSh 3,000/);
  assert.match(email.text, /EXPECTED, not verified \(nobody has confirmed the money\):\n  pay-on-delivery orders marked delivered: 3 \(KSh 900\)/);
  assert.match(email.text, /Paying customers: 6 \(15% of those who got in touch\)/);
  assert.match(email.text, /"Do you allow pets\?" \(Zaina couldn't answer: teach her\)/);
  assert.match(email.text, /Time saved \(estimate\): about 5 hours/);
});

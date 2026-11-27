// src/studio/plans.ts
//
// What bilamatata.com sells, with its prices: Zaina's two plans and the Menu
// plan. The studio's own price list (seeded by migrations 0016, 0017 and
// 0045) says the same, so the Zaina on the site quotes exactly what the page
// shows; a test checks they agree.

/** The Menu plan: the branded menu page alone, for restaurants, bars and hotels. Shown beside Zaina's plans, not as one of them. */
export const MENU_PLAN = {
  name: "Menu",
  monthlyMinor: 490_000,
  setupMinor: 500_000,
  for: "A branded QR menu for restaurants, bars and hotels, kept up to date by your team.",
};

export const PLANS = [
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

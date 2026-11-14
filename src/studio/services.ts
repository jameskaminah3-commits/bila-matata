// src/studio/services.ts
//
// What the studio sells besides Zaina, with each service's starting price
// (the same figures as its price list, migration 0017, which its own Zaina
// quotes from), and what a visitor can ask to start on /start.

export const STUDIO_SERVICES = [
  {
    id: "software",
    title: "Website & Mobile App Development",
    fromMinor: 2_500_000,
    text: "A site or app that brings in enquiries and takes payments, not just one that looks good.",
    points: ["Business websites and online shops", "Customer and staff apps for Android and iPhone", "M-Pesa and card payments built in"],
  },
  {
    id: "automation",
    title: "AI Automation & Workflow Systems",
    fromMinor: 1_500_000,
    text: "The copying, chasing and re-typing your team does every day, done for them.",
    points: ["Enquiries routed and answered automatically", "Invoices, reminders and follow-ups that send themselves", "Your tools connected: forms, sheets, WhatsApp, email"],
  },
  {
    id: "data",
    title: "Data Analysis & Business Intelligence",
    fromMinor: 1_000_000,
    text: "Know what sells, what it costs you and where the money leaks, from the data you already have.",
    points: ["Dashboards your whole team can read", "Sales, stock and customer analysis", "Clean-up of messy spreadsheets and records"],
  },
  {
    id: "research",
    title: "Strategic Research & Professional Writing",
    fromMinor: 500_000,
    text: "Decisions and documents backed by evidence, written so the reader says yes.",
    points: ["Market and feasibility research", "Business plans, proposals and grant applications", "Reports, company profiles and policy documents"],
  },
] as const;

export type StudioServiceId = (typeof STUDIO_SERVICES)[number]["id"];

/** What someone can ask to start: a Zaina plan, a service, or something else. */
export const REQUEST_TOPICS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "zaina_starter", label: "Zaina AI: Starter Sales Concierge" },
  { id: "zaina_full", label: "Zaina AI: Full Booking & Quote Engine" },
  ...STUDIO_SERVICES.map((service) => ({ id: service.id as string, label: service.title as string })),
  { id: "other", label: "Something else" },
];

export const requestTopic = (id: unknown) => REQUEST_TOPICS.find((topic) => topic.id === id) ?? null;

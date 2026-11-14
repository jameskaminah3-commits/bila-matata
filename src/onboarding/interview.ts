// src/onboarding/interview.ts
//
// The setup interview: the questions a website rarely answers, asked the way
// the Bila Matata team asks them on a call with a new client (or the owner
// answers them alone, in the dashboard). Some questions are for every
// business; the rest depend on its industry. The answers are written up as
// one knowledge document, which Zaina searches like any other, and replaced
// every time the interview is saved.
//
// Prices don't go here: they belong in the price list (amounts written in
// knowledge are hidden from Zaina).

import type { Industry } from "../engine/playbooks.ts";

export type Question = { id: string; section: string; question: string; hint?: string; long?: boolean; industries?: Industry[] };

export const QUESTIONS: Question[] = [
  // Everyone
  { id: "about", section: "Your business", question: "In two or three sentences, what do you do and who for?", long: true },
  { id: "location", section: "Your business", question: "Where are you, and how do people find you?", hint: "Area, street, landmarks, parking, a Google Maps link.", long: true },
  { id: "hours", section: "Your business", question: "When are you open?", hint: "Days and times, public holidays, and when Zaina should say a person will reply." },
  { id: "contact", section: "Your business", question: "How do customers reach a person, and how fast do you usually reply?" },
  { id: "payments", section: "Money (no prices here)", question: "How do customers pay you?", hint: "M-Pesa (paybill or till), card, cash, bank. Prices go in your price list." },
  { id: "deposit", section: "Money (no prices here)", question: "Do you ask for a deposit, and what happens if someone cancels?", long: true },
  { id: "not_offered", section: "What you don't do", question: "What do people often ask for that you don't offer?", hint: "So Zaina says so straight away, and offers what you do have.", long: true },
  { id: "languages", section: "Your business", question: "Which languages does your team speak with customers?" },
  { id: "faqs", section: "Common questions", question: "The three questions customers ask most, with your answers.", long: true },
  { id: "handover", section: "Your team", question: "What should always go to a person, never to Zaina?", hint: "Complaints, VIPs, large orders, anything sensitive.", long: true },
  // Stays
  { id: "checkin", section: "Stays", question: "Check-in and check-out times, and how early or late is possible?", industries: ["stays"] },
  { id: "house_rules", section: "Stays", question: "House rules: children, pets, visitors, smoking, noise, parties?", industries: ["stays"], long: true },
  { id: "meals", section: "Stays", question: "Meals: is breakfast included, can guests order meals, is there a kitchen?", industries: ["stays"], long: true },
  { id: "amenities", section: "Stays", question: "What's there for guests: Wi-Fi, pool, parking, beach access, generator, air conditioning?", industries: ["stays"], long: true },
  { id: "transfers", section: "Stays", question: "Can you arrange airport or SGR transfers, or recommend a driver?", industries: ["stays"] },
  { id: "nearby", section: "Stays", question: "What's nearby that guests ask about?", hint: "Beaches, restaurants, shops, hospitals, things to do.", industries: ["stays"], long: true },
  // Salon
  { id: "services_list", section: "Services", question: "Your main services, and roughly how long each takes?", hint: "Prices go in your price list.", industries: ["salon", "services", "clinic"], long: true },
  { id: "walk_ins", section: "Salon", question: "Do you take walk-ins, and what if a client is late?", industries: ["salon"] },
  { id: "products", section: "Salon", question: "Which products do you use or sell, and can clients bring their own hair or products?", industries: ["salon"], long: true },
  { id: "home_service", section: "Salon", question: "Do you do home or hotel visits?", industries: ["salon"] },
  // Restaurant
  { id: "cuisine", section: "Restaurant", question: "Your food in a sentence, and your signature dishes?", industries: ["restaurant"], long: true },
  { id: "dietary", section: "Restaurant", question: "Vegetarian, vegan, halal, gluten-free or allergy options?", industries: ["restaurant"], long: true },
  { id: "reservations", section: "Restaurant", question: "How do reservations work: largest table, how long a table is held, private events?", industries: ["restaurant"], long: true },
  { id: "delivery", section: "Restaurant", question: "Do you deliver or do takeaway, and where?", industries: ["restaurant", "shop"] },
  { id: "celebrations", section: "Restaurant", question: "Birthdays and celebrations: cakes, decorations, set menus?", industries: ["restaurant"] },
  // Clinic
  { id: "insurance", section: "Clinic", question: "Which insurers or schemes do you accept?", industries: ["clinic"], long: true },
  { id: "emergencies", section: "Clinic", question: "What should someone with an emergency do?", hint: "The number to call, and when to go straight to hospital.", industries: ["clinic"], long: true },
  { id: "preparation", section: "Clinic", question: "Anything patients should bring or do before a visit?", industries: ["clinic"], long: true },
  // Shop
  { id: "catalogue", section: "Shop", question: "What do you sell, and what's most popular?", industries: ["shop"], long: true },
  { id: "returns", section: "Shop", question: "Returns, exchanges and warranty?", industries: ["shop"], long: true },
  { id: "stock", section: "Shop", question: "How should Zaina handle 'do you have this in stock?' when she can't check?", industries: ["shop"] },
  { id: "wholesale", section: "Shop", question: "Do you sell in bulk or wholesale?", industries: ["shop"] },
  // Services
  { id: "areas", section: "Services", question: "Which areas do you cover, and is there a call-out charge?", industries: ["services"] },
  { id: "quotes", section: "Services", question: "What do you need to know to quote a job?", industries: ["services"], long: true },
];

export function questionsFor(industry: Industry): Question[] {
  return QUESTIONS.filter((question) => !question.industries || question.industries.includes(industry));
}

export type Answers = Record<string, string>;

/** Only answers to this industry's questions, trimmed, each up to 2,000 characters. */
export function cleanAnswers(industry: Industry, input: unknown): Answers {
  const allowed = new Set(questionsFor(industry).map((question) => question.id));
  const answers: Answers = {};
  if (!input || typeof input !== "object") return answers;
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (!allowed.has(id) || typeof value !== "string") continue;
    const text = value.replace(/\r\n?/g, "\n").trim().slice(0, 2000);
    if (text) answers[id] = text;
  }
  return answers;
}

/** The answers written up as a knowledge document, grouped by section. */
export function interviewDocument(businessName: string, industry: Industry, answers: Answers): string {
  const sections = new Map<string, string[]>();
  for (const question of questionsFor(industry)) {
    const answer = answers[question.id];
    if (!answer) continue;
    const lines = sections.get(question.section) ?? [];
    lines.push(`### ${question.question}\n\n${answer}`);
    sections.set(question.section, lines);
  }
  const body = [...sections.entries()].map(([section, lines]) => `## ${section}\n\n${lines.join("\n\n")}`).join("\n\n");
  return `# About ${businessName}, in our own words\n\nWhat the ${businessName} team told Zaina when setting her up.\n\n${body}`;
}

export const INTERVIEW_SOURCE_TITLE = "About us, in our own words (setup interview)";
export const ANSWERS_SOURCE_TITLE = "Answers from our team";

/** Adds (or replaces) one question's answer in the team's answers document. */
export function withAnswer(document: string | null, question: string, answer: string): string {
  const heading = `## ${question.trim().replace(/\s+/g, " ").replace(/^#+\s*/, "").slice(0, 300)}`;
  const entries = (document ?? "").split(/\n(?=## )/).map((entry) => entry.trim()).filter((entry) => entry.startsWith("## "));
  const kept = entries.filter((entry) => entry.split("\n")[0].toLowerCase() !== heading.toLowerCase());
  kept.push(`${heading}\n\n${answer.trim()}`);
  return `# ${ANSWERS_SOURCE_TITLE}\n\nQuestions customers asked that the team answered, so Zaina can answer them next time.\n\n${kept.join("\n\n")}`;
}

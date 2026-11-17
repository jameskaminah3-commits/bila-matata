// src/onboarding/describe-routes.ts
//
// Setting up by describing the business (describe.ts), for its team:
//
//   POST /v1/staff/businesses/:businessId/setup/describe   manager
//       { text } → { draft, dropped, questions, currency }   nothing is saved
//   POST /v1/staff/businesses/:businessId/setup/apply      manager
//       { draft } → { saved, skipped, questions }
//
// The owner reviews the draft first: they untick what's wrong and fill in
// what's missing. What they approve is saved through the same checks as the
// rest of the dashboard (rooms, services, the price list, booking rules,
// capabilities, knowledge); anything still incomplete is left out and said.

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import { createOffering, validateOffering } from "../booking/offerings.ts";
import { checkDepositRule, getBookingSettings, paymentOptionsOf, saveBookingSettings, validatePolicyPatch } from "../booking/settings.ts";
import { CAPABILITIES, capabilitiesOf, capabilityKeys, type Capability } from "../capabilities/catalog.ts";
import type { Business } from "../db/schema.ts";
import type { EngineOptions } from "../engine/agent.ts";
import { rateLimited } from "../gateway/rate-limit.ts";
import { knowledgeSourceByTitle, saveKnowledgeSource } from "../knowledge/store.ts";
import { createPriceItem, validatePriceItem } from "../prices/price-list.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import {
  checkDraft,
  DESCRIBE_MAX_CHARS,
  describeInstructions,
  DRAFT_SCHEMA,
  emptyDraft,
  openQuestions,
  type Draft,
} from "./describe.ts";

export const SETUP_FACTS_TITLE = "How we work, in our own words (setup)";

async function currentRules(business: Business) {
  const booking = await getBookingSettings(business.id);
  const options = paymentOptionsOf(booking);
  return {
    booking,
    current: {
      hasDeposit: booking.depositType !== "not_set",
      hasCancellation: Boolean(booking.cancellationPolicy?.trim()),
      paysOnline: options.paystack || options.mpesaExpress || Boolean(options.mpesaManual),
      payAtVenue: options.payAtVenue,
      checkIn: booking.checkInTime,
      checkOut: booking.checkOutTime,
    },
  };
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const amount = (value: unknown, max = 100_000_000): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value * 100) / 100 : null;
const count = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;

/** The draft as the owner approved it: shapes and limits checked. Their own edits stand (they're the owner's words). */
export function reviewedDraft(input: unknown): Draft {
  const draft = emptyDraft();
  const body = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const list = (key: string) => (Array.isArray(body[key]) ? (body[key] as any[]).slice(0, 40) : []);
  for (const item of list("capabilities")) {
    const key = typeof item === "string" ? item : item?.key;
    if (capabilityKeys.includes(key) && !draft.capabilities.some((entry) => entry.key === key)) draft.capabilities.push({ key, quote: text(item?.quote, 600) });
  }
  for (const item of list("rooms")) {
    const name = text(item?.name, 120);
    if (name) draft.rooms.push({ name, sleeps: count(item.sleeps, 1, 50), rooms: count(item.rooms, 1, 500), price_per_night: amount(item.price_per_night), quote: text(item.quote, 600) });
  }
  for (const item of list("services")) {
    const name = text(item?.name, 120);
    if (name) draft.services.push({ kind: item.kind === "table" ? "table" : "service", name, minutes: count(item.minutes, 5, 720), price: amount(item.price), max_party: count(item.max_party, 1, 50), quote: text(item.quote, 600) });
  }
  for (const item of list("extras")) {
    const name = text(item?.name, 120);
    if (name) draft.extras.push({ name, price: amount(item.price), unit: text(item.unit, 40) || null, capability: capabilityKeys.includes(item.capability) ? item.capability : null, quote: text(item.quote, 600) });
  }
  const deposit = body.deposit;
  if (deposit && ["none", "percent", "fixed", "full"].includes(deposit.type)) {
    draft.deposit = { type: deposit.type, percent: count(deposit.percent, 1, 99), amount: amount(deposit.amount), quote: text(deposit.quote, 600) };
  }
  if (body.cancellation && text(body.cancellation.text, 2000)) draft.cancellation = { text: text(body.cancellation.text, 2000), quote: text(body.cancellation.quote, 600) };
  for (const key of ["check_in", "check_out"] as const) {
    const time = body[key]?.time;
    if (typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) draft[key] = { time, quote: text(body[key].quote, 600) };
  }
  for (const item of list("facts")) {
    const fact = text(item?.text ?? item, 500);
    if (fact) draft.facts.push({ text: fact, quote: text(item?.quote, 600) });
  }
  return draft;
}

/** "- one\n- two", merged with the facts already saved (no repeats). */
function factsDocument(existing: string | null | undefined, facts: string[]): string {
  const kept = (existing ?? "").split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
  const all = [...kept];
  for (const fact of facts) if (!all.some((line) => line.toLowerCase() === fact.toLowerCase())) all.push(fact);
  // The owner's sentences first: they are what Zaina finds and quotes.
  return `# How we work\n\n${all.map((line) => `- ${line}`).join("\n")}`;
}

export function registerDescribeRoutes(app: Express, config: PlatformConfig, engine: EngineOptions): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId/setup";
  // Each draft is a model call: a dozen an hour is plenty for setting up.
  const limit = rateLimited(config.sessionTokenSecret, "setup-describe", 12, 3600, (req) => String(req.params.businessId));

  app.post(`${base}/describe`, staff, requireBusinessRole("manager"), limit, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business } = staffOf(req);
      if (business!.businessType === "custom") return res.status(409).json({ error: "own_system", message: "This business's setup comes from its own system." });
      const description = typeof req.body?.text === "string" ? req.body.text.replace(/\r\n?/g, "\n").trim() : "";
      if (description.length < 20) return res.status(400).json({ error: "text_required", message: "Describe how you work in a few sentences: what you offer, what it costs, and your rules." });
      if (description.length > DESCRIBE_MAX_CHARS) return res.status(400).json({ error: "text_too_long", message: `Keep it under ${DESCRIBE_MAX_CHARS.toLocaleString("en")} characters; you can describe more afterwards.` });
      const { booking, current } = await currentRules(business!);
      let raw: unknown;
      try {
        const response = await engine.ai.models.generateContent({
          model: engine.model,
          contents: [{ role: "user", parts: [{ text: `<owner_text>\n${description}\n</owner_text>` }] }],
          config: {
            systemInstruction: describeInstructions(booking.currency),
            responseMimeType: "application/json",
            responseSchema: DRAFT_SCHEMA,
            temperature: 0,
            abortSignal: AbortSignal.timeout(30_000),
          },
        });
        raw = JSON.parse(response.text ?? "{}");
      } catch (error) {
        console.error(`[setup] describing ${business!.id} failed:`, error instanceof Error ? error.message : error);
        return res.status(502).json({ error: "not_read", message: "Zaina couldn't read that just now. Try again in a minute, or set things up page by page." });
      }
      const { draft, dropped } = checkDraft(raw, description);
      res.json({ draft, dropped, questions: openQuestions(draft, current), currency: booking.currency });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/apply`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      if (business!.businessType === "custom") return res.status(409).json({ error: "own_system", message: "This business's setup comes from its own system." });
      const draft = reviewedDraft(req.body?.draft);
      const { booking } = await currentRules(business!);
      const currency = booking.currency;
      const saved = { capabilities: [] as Capability[], rooms: [] as string[], services: [] as string[], prices: [] as string[], rules: [] as string[], facts: 0 };
      const skipped: Array<{ item: string; reason: string }> = [];
      const left = emptyDraft();

      // Rules first: a bad one stops everything before anything is saved.
      const policy: Record<string, unknown> = {};
      if (draft.deposit) {
        const deposit = draft.deposit;
        if (deposit.type === "percent" && deposit.percent) Object.assign(policy, { deposit_type: "percent", deposit_percent: deposit.percent });
        else if (deposit.type === "fixed" && deposit.amount) Object.assign(policy, { deposit_type: "fixed", deposit_fixed_minor: Math.round(deposit.amount * 100) });
        else if (deposit.type === "full" || deposit.type === "none") policy.deposit_type = deposit.type;
        else skipped.push({ item: "Deposit", reason: deposit.type === "percent" ? "needs the percentage" : "needs the amount" });
      }
      if (draft.check_in) policy.check_in_time = draft.check_in.time;
      if (draft.check_out) policy.check_out_time = draft.check_out.time;
      if (draft.cancellation) policy.cancellation_policy = draft.cancellation.text;
      if (Object.keys(policy).length) {
        const checked = validatePolicyPatch(policy);
        if (!checked.ok) return res.status(400).json({ error: "invalid_rules", message: checked.error });
        const problem = checkDepositRule({ ...booking, ...checked.patch });
        if (problem) return res.status(400).json({ error: "invalid_rules", message: problem });
        const patch = { ...checked.patch, ...(checked.patch.depositType ? { rulesConfirmedAt: new Date() } : {}) };
        await saveBookingSettings(business!.id, patch, user.id);
        if (draft.deposit && checked.patch.depositType) saved.rules.push("deposit");
        if (draft.check_in) saved.rules.push("check-in time");
        if (draft.check_out) saved.rules.push("check-out time");
        if (draft.cancellation) saved.rules.push("cancellation");
      }

      for (const room of draft.rooms) {
        if (!room.rooms || !room.sleeps || !room.price_per_night) {
          skipped.push({ item: room.name, reason: "needs the number of rooms, the guests one sleeps and the price a night" });
          left.rooms.push(room);
          continue;
        }
        const checked = validateOffering({ kind: "room_type", name: room.name, description: room.quote, units: room.rooms, max_guests: room.sleeps, pricing: { nightly: Math.round(room.price_per_night * 100) } });
        if (!checked.ok) {
          skipped.push({ item: room.name, reason: checked.error });
          continue;
        }
        const made = await createOffering(business!.id, checked.value, user.id);
        if (made === "name_taken") skipped.push({ item: room.name, reason: "already listed: change it under Rooms" });
        else saved.rooms.push(room.name);
      }

      for (const service of draft.services) {
        const missing = !service.minutes || (service.kind === "table" && !service.max_party) || (service.kind === "service" && service.price === null);
        if (missing) {
          skipped.push({ item: service.name, reason: service.kind === "table" ? "needs how long a table is held and the largest party" : "needs how long it takes and its price" });
          left.services.push(service);
          continue;
        }
        const checked = validateOffering({
          kind: service.kind, name: service.name, description: service.quote, duration_minutes: service.minutes,
          max_party: service.max_party ?? 1, pricing: service.price === null ? {} : { price: Math.round(service.price * 100) },
        });
        if (!checked.ok) {
          skipped.push({ item: service.name, reason: checked.error });
          continue;
        }
        const made = await createOffering(business!.id, checked.value, user.id);
        if (made === "name_taken") skipped.push({ item: service.name, reason: "already listed: change it under Services" });
        else saved.services.push(service.name);
      }

      for (const extra of draft.extras) {
        if (extra.price === null) {
          skipped.push({ item: extra.name, reason: "needs a price: until then Zaina says the team will confirm it" });
          left.extras.push(extra);
          continue;
        }
        const checked = validatePriceItem({ name: extra.name, price: extra.price, unit: extra.unit, currency, section: extra.capability ? CAPABILITIES[extra.capability].label : null });
        if (!checked.ok) {
          skipped.push({ item: extra.name, reason: checked.error });
          continue;
        }
        const made = await createPriceItem(business!.id, checked.value, user.id);
        if (made === "name_taken") skipped.push({ item: extra.name, reason: "already in your price list" });
        else if (made === "too_many") skipped.push({ item: extra.name, reason: "your price list is full" });
        else saved.prices.push(extra.name);
      }

      // What it offers: the capabilities approved, and those its approved items imply. Never removes one.
      const settings = await getBusinessSettings(business!.id);
      const before = capabilitiesOf(business!, settings);
      const wanted = new Set<Capability>([...before, ...draft.capabilities.map((entry) => entry.key)]);
      if (draft.rooms.length) wanted.add("rooms");
      if (draft.services.some((service) => service.kind === "table")) wanted.add("tables");
      if (draft.services.some((service) => service.kind === "service")) wanted.add("appointments");
      for (const extra of draft.extras) if (extra.capability) wanted.add(extra.capability);
      const enabled = capabilityKeys.filter((key) => wanted.has(key));
      if (!settings?.capabilities || enabled.length !== before.length) {
        await updateBusinessSettings(business!.id, { capabilities: { enabled, updatedAt: new Date().toISOString() } }, user.id);
      }
      saved.capabilities = enabled;

      if (draft.facts.length) {
        const existing = await knowledgeSourceByTitle(business!.id, SETUP_FACTS_TITLE);
        await saveKnowledgeSource(business!.id, {
          title: SETUP_FACTS_TITLE, kind: "guide", url: null, language: "en", status: "published",
          content: factsDocument(existing?.content, draft.facts.map((fact) => fact.text)),
        }, user.id, existing?.id);
        saved.facts = draft.facts.length;
      }

      left.capabilities = enabled.map((key) => ({ key, quote: "" }));
      left.deposit = draft.deposit;
      left.cancellation = draft.cancellation;
      left.check_in = draft.check_in;
      const after = await currentRules(business!);
      res.json({ saved, skipped, questions: openQuestions(left, after.current) });
    } catch (error) {
      next(error);
    }
  });
}

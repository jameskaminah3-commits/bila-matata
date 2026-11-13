// What every Zaina is told about helping well: understand, recommend, move
// the customer forward, and never at the cost of the facts.

import assert from "node:assert/strict";
import test from "node:test";
import { CONCIERGE_GUIDANCE, withConciergeGuidance } from "../../src/engine/concierge.ts";

test("the shared guidance follows a connector's own rules, and keeps them", () => {
  const own = "You are Zaina, the assistant for Acme.\n- For what something costs, call get_prices.";
  const full = withConciergeGuidance(own);
  assert.ok(full.startsWith(own), "the connector's rules come first");
  assert.ok(full.endsWith(CONCIERGE_GUIDANCE));
});

test("Zaina is told to understand the customer, recommend, and always offer a next step", () => {
  for (const rule of [
    /Work out what the customer is actually trying to get done/,
    /never ask again for something they told you/,
    /ask one short question/,
    /Answer the whole message/,
    /Recommend, don't just list/,
    /Suggest extras that genuinely fit/,
    /suggest one, once, with its price exactly as the tools give it/,
    /offer the nearest thing the business really has/,
    /Always finish with one clear next step/,
    /offer once to take their name and number/,
  ]) assert.match(CONCIERGE_GUIDANCE, rule);
});

test("being helpful never licenses a guess: no invented prices, totals, urgency, discounts or promises", () => {
  assert.match(CONCIERGE_GUIDANCE, /Never add up totals, work out a price or convert a currency yourself/);
  assert.match(CONCIERGE_GUIDANCE, /Never invent urgency or scarcity/);
  assert.match(CONCIERGE_GUIDANCE, /a discount, a promise or a guarantee/);
  assert.match(CONCIERGE_GUIDANCE, /Every fact, price, time and policy still comes only from the tools and the business's information/);
  assert.match(CONCIERGE_GUIDANCE, /If you don't have it, say so and bring in the team/);
  // Nothing here tells the model to estimate, assume or fill gaps.
  assert.doesNotMatch(CONCIERGE_GUIDANCE, /\b(estimate|assume|approximately|roughly|make an educated guess)\b/i);
});

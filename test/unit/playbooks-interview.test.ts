// Industry playbooks and the setup interview.

import assert from "node:assert/strict";
import test from "node:test";
import { defaultIndustry, industries, isIndustry, playbookFor } from "../../src/engine/playbooks.ts";
import { cleanAnswers, interviewDocument, QUESTIONS, questionsFor, withAnswer } from "../../src/onboarding/interview.ts";

test("every industry has a playbook with the customer's stages, and none states a fact or a price", () => {
  for (const industry of industries) {
    const text = playbookFor(industry, "Palm Cove");
    assert.match(text, /How to work at Palm Cove/);
    assert.match(text, /How close the customer is/);
    assert.doesNotMatch(text, /KSh|KES|\b\d{3,}\b/, `${industry}: no amounts`);
  }
  assert.match(playbookFor("clinic", "X"), /Never: give medical advice/);
  assert.match(playbookFor("shop", "X"), /take card numbers or payment details in the chat/);
  assert.equal(defaultIndustry("guesthouse"), "stays");
  assert.equal(defaultIndustry("salon"), "salon");
  assert.equal(defaultIndustry("general"), "services");
  assert.equal(isIndustry("clinic"), true);
  assert.equal(isIndustry("castle"), false);
});

test("each industry gets the shared questions and its own; ids are unique", () => {
  assert.equal(new Set(QUESTIONS.map((question) => question.id)).size, QUESTIONS.length);
  for (const industry of industries) {
    const ids = questionsFor(industry).map((question) => question.id);
    assert.ok(ids.includes("about") && ids.includes("handover"), industry);
    assert.ok(ids.length >= 10, `${industry}: ${ids.length} questions`);
  }
  assert.ok(questionsFor("stays").some((question) => question.id === "checkin"));
  assert.ok(!questionsFor("salon").some((question) => question.id === "checkin"));
});

test("answers are cleaned, written up by section, and the team's answers replace by question", () => {
  const answers = cleanAnswers("stays", { checkin: "  From 2 pm  ", insurance: "not a stay question", nothing: "x", house_rules: 42, meals: "   " });
  assert.deepEqual(answers, { checkin: "From 2 pm" });
  const document = interviewDocument("Palm Cove", "stays", { checkin: "From 2 pm", about: "Six rooms by the sea." });
  assert.match(document, /^# About Palm Cove, in our own words/);
  assert.ok(document.indexOf("## Your business") < document.indexOf("## Stays"), "sections in question order");
  assert.match(document, /### Check-in and check-out times[^\n]*\n\nFrom 2 pm/);

  let answersDoc = withAnswer(null, "wifi password", "On the card in your room.");
  answersDoc = withAnswer(answersDoc, "Is there parking?", "Yes, inside the gate.");
  answersDoc = withAnswer(answersDoc, "WIFI PASSWORD", "Ask reception.");
  assert.equal((answersDoc.match(/^## /gm) ?? []).length, 2);
  assert.match(answersDoc, /## WIFI PASSWORD\n\nAsk reception\./);
  assert.doesNotMatch(answersDoc, /On the card/);
  assert.match(withAnswer(null, "## sneaky heading", "x"), /^## sneaky heading$/m, "a question can't add headings of its own");
});

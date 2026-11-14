// End-to-end: the studio's onboarding tracker. Steps are read from the
// business's real setup, so finishing one in the dashboard ticks it here;
// the path decides which steps apply; and only the steps a person must
// confirm can be ticked by hand.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5108;
const ORIGIN = "https://palmcove.example";

let platform: Platform;
let api: Api;
let ops: string;
let owner: string;
const staff = (method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/palm${route}`, body, owner);
const tracker = async () => (await api("GET", "/v1/platform/onboarding", undefined, ops)).body.businesses.find((entry: any) => entry.business.id === "palm");
const step = (entry: any, id: string) => entry.steps.find((candidate: any) => candidate.id === id);

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

before(async () => {
  platform = await startPlatform({ port: PORT });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = await login("ops@example.com");
  const created = await api("POST", "/v1/platform/businesses", { id: "palm", name: "Palm Cove Stays", tier: "full", business_type: "guesthouse", allowed_origins: [], owner: { email: "owner@example.com", name: "Owner", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  owner = await login("owner@example.com");
});

after(async () => {
  await platform?.stop();
});

test("only the studio sees the tracker; a new business starts on the no-website path with nothing done", async () => {
  assert.equal((await api("GET", "/v1/platform/onboarding", undefined, owner)).status, 403);
  const entry = await tracker();
  assert.equal(entry.path, "notebook");
  assert.equal(entry.path_chosen, false);
  assert.ok(entry.steps.some((candidate: any) => candidate.id === "printed"), "a business with no website gets printed codes");
  assert.ok(entry.steps.some((candidate: any) => candidate.id === "payments"), "Full and takes bookings: its own payment link");
  assert.equal(step(entry, "profile").done, false);
  assert.equal(step(entry, "profile").fix, "#/b/palm/settings/profile");
  assert.equal(step(entry, "live").done, entry.business.status === "active", "live means live");
});

test("finishing a step in the dashboard ticks it in the tracker", async () => {
  assert.equal((await staff("PATCH", "/settings", { contactPhone: "+254712345678", about: "A small guesthouse in Diani with six rooms, a pool and a garden, ten minutes from the beach." })).status, 200);
  await staff("PUT", "/interview", { industry: "stays", answers: { checkin: "From 2 pm, out by 10 am", house_rules: "No pets", transfers: "Airport pick-up on request", deposit: "30% to hold the room", meals: "Breakfast included" } });
  await staff("POST", "/offerings", { name: "Garden room", units: 2, max_guests: 2, pricing: { nightly: 900000 } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const entry = await tracker();
  assert.equal(step(entry, "profile").done, true);
  assert.equal(step(entry, "interview").done, true, JSON.stringify(step(entry, "interview")));
  assert.equal(step(entry, "catalogue").done, true);
  assert.equal(step(entry, "payments").done, false);
  assert.ok(entry.done >= 3);
});

test("the path decides the steps; only the steps a person confirms can be ticked", async () => {
  assert.equal((await api("PUT", "/v1/platform/onboarding/palm", { path: "castle" }, ops)).status, 400);
  assert.equal((await api("PUT", "/v1/platform/onboarding/palm", { ticks: { profile: true } }, ops)).body.error, "unknown_step");
  assert.equal((await api("PUT", "/v1/platform/onboarding/palm", { path: "calendar" }, owner)).status, 403);
  const saved = await api("PUT", "/v1/platform/onboarding/palm", { path: "calendar", ticks: { walkthrough: true, baseline: true }, note: "Owner prefers WhatsApp, mornings." }, ops);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const entry = saved.body.tracker;
  assert.deepEqual([entry.path, entry.path_chosen, entry.note], ["calendar", true, "Owner prefers WhatsApp, mornings."]);
  assert.ok(step(entry, "calendar"), "a calendar path checks the calendar");
  assert.equal(step(entry, "printed"), undefined, "no printed codes on a website path");
  assert.equal(step(entry, "walkthrough").done, true);
  assert.equal(step(entry, "acceptance").done, false);
  // Unticking keeps the others.
  const unticked = (await api("PUT", "/v1/platform/onboarding/palm", { ticks: { baseline: false } }, ops)).body.tracker;
  assert.deepEqual([step(unticked, "walkthrough").done, step(unticked, "baseline").done, unticked.note], [true, false, "Owner prefers WhatsApp, mornings."]);
  assert.equal((await api("PUT", "/v1/platform/onboarding/nope", { path: "website" }, ops)).status, 404);
});

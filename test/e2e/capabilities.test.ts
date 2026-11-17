// End-to-end: what a business does through Zaina, and its own rules.
//
//   Coral Cove (a hotel)   rooms, a restaurant, a spa and airport transfers:
//                          Zaina gets the tools of each, and only its own
//                          offerings in each; a 30% deposit
//   Palm Lodge (a hotel)   the same module, but paid in full to confirm and no
//                          cancellation policy set: Zaina is told the
//                          difference, and not to assume one
//   Baobab Lodge           sets itself up by describing how it works: a draft
//                          from the owner's words (a guessed price and an
//                          invented policy left out), reviewed, completed and
//                          approved, then live
//
// The model is scripted (scripted-model.mjs).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5112;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGINS = { coral: "https://coral.example", palm: "https://palm.example", baobab: "https://baobab.example" } as const;
type Id = keyof typeof ORIGINS;
const KSH = (major: number) => major * 100;
const b64 = (text: string) => Buffer.from(text).toString("base64");
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${b64(JSON.stringify(args))}`;

let platform: Platform;
let api: Api;
const tokens: Partial<Record<Id, string>> = {};
const keys: Partial<Record<Id, string>> = {};
const staff = (business: Id, method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/${business}${route}`, body, tokens[business]);

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

async function say(business: Id, message: string, token?: string): Promise<{ reply: string; token: string }> {
  let chat = token;
  if (!chat) {
    const opened = await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGINS[business] }, body: JSON.stringify({ business_key: keys[business], display_currency: "KES" }) });
    const body = await opened.json() as any;
    assert.equal(opened.status, 201, JSON.stringify(body));
    chat = body.token as string;
  }
  const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${chat}`, origin: ORIGINS[business] }, body: JSON.stringify({ message }) });
  const body = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(body));
  return { reply: body.reply as string, token: chat! };
}
const told = async (business: Id, words: string) => (await say(business, `TEST:has64 ${b64(words)}`)).reply === "yes";

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = await login("ops@example.com");
  const owners: Record<Id, [string, string, string]> = {
    coral: ["Coral Cove Hotel", "guesthouse", "amani@example.com"],
    palm: ["Palm Lodge", "guesthouse", "zawadi@example.com"],
    baobab: ["Baobab Lodge", "general", "jabali@example.com"],
  };
  for (const [id, [name, type, email]] of Object.entries(owners) as Array<[Id, [string, string, string]]>) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, business_type: type, allowed_origins: [ORIGINS[id]], owner: { email, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    keys[id] = created.body.business.public_key;
    tokens[id] = await login(email);
  }
});

after(async () => {
  await platform?.stop();
});

test("two hotels on the same module: Zaina is told each one's own rule, and not to assume one", async () => {
  assert.equal((await staff("coral", "PATCH", "/booking-settings", { deposit_type: "percent", deposit_percent: 30, cancellation_policy: "Free to cancel up to 7 days before arrival." })).status, 200);
  assert.equal((await staff("palm", "PATCH", "/booking-settings", { deposit_type: "full" })).status, 200);
  for (const id of ["coral", "palm"] as const) {
    const room = await staff(id, "POST", "/offerings", { name: "Standard", units: 3, max_guests: 2, pricing: { nightly: KSH(8000) } });
    assert.equal(room.status, 201, JSON.stringify(room.body));
  }
  assert.ok(await told("coral", "Rooms and stays: booked here (list_rooms, check_availability, create_booking). To confirm: 30% to confirm, the rest at the property."));
  assert.ok(await told("coral", "Cancellation: Free to cancel up to 7 days before arrival."));
  assert.ok(await told("palm", "To confirm: paid in full to confirm."));
  assert.ok(!(await told("palm", "30% to confirm")), "one hotel's rule never reaches another");
  assert.ok(await told("palm", "Cancellation: not set by Palm Lodge: if asked, say the team will confirm. Never describe a usual policy or promise a refund."));
  assert.ok(await told("palm", "they are this business's rules, and they win over anything usual for its kind of business"));
  assert.ok(await told("palm", "This is how such businesses usually work, not Palm Lodge's rules"), "the playbook defers to the business");
});

test("a hotel with a restaurant, a spa and transfers: the tools of each, and only its own offerings in each", async () => {
  const before = await staff("coral", "GET", "/capabilities");
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.enabled, ["rooms"], "until it chooses, a hotel is its rooms");
  assert.equal(before.body.chosen, false);
  assert.equal(before.body.catalog.find((entry: any) => entry.key === "rooms").primary, true);
  assert.equal(before.body.catalog.find((entry: any) => entry.key === "tables").primary, false, "a restaurant is offered, never assumed");

  const set = await staff("coral", "PUT", "/capabilities", { enabled: ["transfers", "tables", "rooms", "appointments"] });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.enabled, ["rooms", "tables", "appointments", "transfers"]);
  assert.deepEqual(set.body.books, { rooms: true, services: true, tables: true });
  assert.equal((await staff("coral", "PUT", "/capabilities", { enabled: ["rooms", "casino"] })).status, 400);

  const week = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, [["08:00", "22:00"]]]));
  assert.equal((await staff("coral", "PATCH", "/booking-settings", { opening_hours: week })).status, 200);
  const massage = await staff("coral", "POST", "/offerings", { kind: "service", name: "Swedish massage", duration_minutes: 60, pricing: { price: KSH(4500), deposit_percent: 100 } });
  assert.equal(massage.status, 201, JSON.stringify(massage.body));
  assert.equal(massage.body.offering.kind, "service");
  const dinner = await staff("coral", "POST", "/offerings", { kind: "table", name: "Dinner table", duration_minutes: 90, max_party: 6 });
  assert.equal(dinner.status, 201, JSON.stringify(dinner.body));

  const whoami = (await say("coral", "TEST:whoami")).reply;
  assert.match(whoami, /Coral Cove Hotel as one of its people, a place to stay that also takes appointments and table reservations/);
  assert.match(whoami, /Tools: list_rooms, check_availability, create_booking, list_services, check_times, create_appointment, get_booking, create_lead,/);

  // The rooms are only rooms; the times only the spa and the restaurant.
  const rooms = (await say("coral", raw64("list_rooms", {}))).reply;
  assert.doesNotMatch(rooms, /massage|Dinner/i);
  const services = (await say("coral", raw64("list_services", {}))).reply;
  assert.match(services, /Swedish massage/);
  assert.match(services, /Dinner table/);
  assert.doesNotMatch(services, /Standard/);
  const asRoom = (await say("coral", raw64("check_availability", { check_in: "2027-03-01", check_out: "2027-03-03", guests: 2, room_type: "Swedish massage" }))).reply;
  assert.doesNotMatch(asRoom, /available|KSh 4,500/i, "a spa treatment can't be booked as a room");

  // Its own rules: the spa treatment's own deposit, and transfers the team arranges.
  assert.ok(await told("coral", "Appointments: booked here (list_services, check_times, create_appointment). To confirm: 30% to confirm, the rest when you arrive. Their own deposit: Swedish massage, paid in full to confirm."));
  assert.ok(await told("coral", "Airport and SGR transfers: arranged by the team. Quote only prices get_prices gives"));
  assert.ok(await told("coral", "Opening hours: "));

  // Without the restaurant, its tables aren't offered.
  await staff("coral", "PUT", "/capabilities", { enabled: ["rooms", "appointments", "transfers"] });
  const spaOnly = (await say("coral", raw64("list_services", {}))).reply;
  assert.match(spaOnly, /Swedish massage/);
  assert.doesNotMatch(spaOnly, /Dinner table/);
});

const OWNER = "We offer three types of rooms. Standard rooms accommodate two guests. Breakfast is included. Airport transfers are available at an additional cost. Reservations require a 30% deposit.";

test("a business describes how it works; Zaina drafts its setup from its words; the owner reviews and approves", async () => {
  // What a model might return: right on most things, but with a guessed price and number of rooms, and a usual cancellation policy the owner never wrote.
  const model = {
    capabilities: [{ key: "rooms", quote: "We offer three types of rooms" }, { key: "transfers", quote: "Airport transfers are available at an additional cost" }],
    rooms: [{ name: "Standard room", sleeps: 2, rooms: 3, price_per_night: 7500, quote: "Standard rooms accommodate two guests." }],
    services: [],
    extras: [{ name: "Airport transfer", price: null, capability: "transfers", quote: "Airport transfers are available at an additional cost" }],
    deposit: { type: "percent", percent: 30, quote: "Reservations require a 30% deposit." },
    cancellation: { text: "Free cancellation up to 48 hours before arrival", quote: "Free cancellation up to 48 hours before arrival" },
    facts: [{ text: "Breakfast is included in every rate.", quote: "Breakfast is included." }],
  };
  const text = `${OWNER}\nTEST:draft64 ${b64(JSON.stringify(model))}`;
  assert.equal((await staff("baobab", "POST", "/setup/describe", { text: "Rooms." })).status, 400, "a few sentences, please");
  const drafted = await staff("baobab", "POST", "/setup/describe", { text });
  assert.equal(drafted.status, 200, JSON.stringify(drafted.body));
  const draft = drafted.body.draft;
  assert.deepEqual(draft.capabilities.map((entry: any) => entry.key), ["rooms", "transfers"]);
  assert.deepEqual(draft.rooms, [{ name: "Standard room", sleeps: 2, rooms: null, price_per_night: null, quote: "Standard rooms accommodate two guests." }]);
  assert.deepEqual(draft.deposit, { type: "percent", percent: 30, amount: null, quote: "Reservations require a 30% deposit." });
  assert.equal(draft.cancellation, null, "a policy the owner didn't write is left out");
  assert.deepEqual(draft.facts.map((fact: any) => fact.text), ["Breakfast is included."]);
  assert.equal(drafted.body.dropped, 1);
  assert.deepEqual(drafted.body.questions.slice(0, 3), ["How many Standard rooms do you have?", "What does one Standard room cost a night?", "What does Airport transfer cost? Until you add it, Zaina says the team will confirm the price."]);
  assert.ok(drafted.body.questions.includes("What happens if a customer cancels: is anything refunded, and up to when?"));

  // Nothing is saved until the owner approves.
  assert.deepEqual((await staff("baobab", "GET", "/capabilities")).body.enabled, []);
  assert.equal((await staff("baobab", "GET", "/offerings")).body.offerings.length, 0);

  // The owner fills in what's missing, and approves.
  draft.rooms[0].rooms = 4;
  draft.rooms[0].price_per_night = 6500;
  draft.extras[0].price = 3000;
  draft.extras[0].unit = "per car";
  const applied = await staff("baobab", "POST", "/setup/apply", { draft });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.deepEqual(applied.body.saved, { capabilities: ["rooms", "transfers"], rooms: ["Standard room"], services: [], prices: ["Airport transfer"], rules: ["deposit"], facts: 1 });
  assert.deepEqual(applied.body.skipped, []);
  assert.ok(applied.body.questions.includes("What happens if a customer cancels: is anything refunded, and up to when?"), "still to answer");
  assert.ok(applied.body.questions.some((question: string) => /check-in is from 14:00 and check-out by 10:00\. If that's not right/.test(question)), "times it never gave are said, to confirm");

  const offerings = (await staff("baobab", "GET", "/offerings")).body.offerings;
  assert.equal(offerings.length, 1);
  assert.equal(offerings[0].name, "Standard room");
  assert.equal(offerings[0].units, 4);
  assert.equal(offerings[0].max_guests, 2);
  const rules = (await staff("baobab", "GET", "/booking-settings")).body;
  assert.equal(rules.deposit_type, "percent");
  assert.equal(rules.deposit_percent, 30);
  assert.ok(rules.rules_confirmed_at, "the owner approved the deposit");

  // Zaina works from it at once: room tools, its own deposit, transfers arranged by the team.
  assert.match((await say("baobab", "TEST:whoami")).reply, /Tools: list_rooms, check_availability, create_booking, get_booking, create_lead,/);
  assert.ok(await told("baobab", "To confirm: 30% to confirm, the rest at the property."));
  assert.ok(await told("baobab", "Airport and SGR transfers: arranged by the team."));
  assert.ok(await told("baobab", "Cancellation: not set by Baobab Lodge"));
  assert.match((await say("baobab", raw64("get_prices", { query: "airport transfer" }))).reply, /Airport transfer: KSh 3,000 per car/);
  assert.match((await say("baobab", "TEST:ask Is breakfast included?")).reply, /Breakfast is included/);

  // Approving again adds nothing twice.
  const again = await staff("baobab", "POST", "/setup/apply", { draft });
  assert.deepEqual(again.body.saved.rooms, []);
  assert.deepEqual(again.body.skipped.map((entry: any) => entry.item), ["Standard room", "Airport transfer"]);

  // Incomplete items are left out and said, never filled in.
  const partial = await staff("baobab", "POST", "/setup/apply", { draft: { rooms: [{ name: "Family suite", sleeps: 4 }] } });
  assert.deepEqual(partial.body.saved.rooms, []);
  assert.match(partial.body.skipped[0].reason, /number of rooms/);
});

test("only the business's own team sets it up", async () => {
  // Another business's staff: not found, as for anything of another business's.
  assert.equal((await api("POST", "/v1/staff/businesses/baobab/setup/describe", { text: OWNER }, tokens.coral)).status, 404);
  assert.equal((await api("PUT", "/v1/staff/businesses/baobab/capabilities", { enabled: [] })).status, 401);
});

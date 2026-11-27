// test/e2e/menu-assistant.test.ts
//
// The menu assistant: plain words in, the exact changes out (before → after),
// applied only when the team says so, and undone in one step. The scripted
// model stands in for the real one: it answers with the plan given to it, in
// words (dish and section names), and the platform finds the dishes and works
// out the prices.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { apiFor, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5135;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "LocalTest#2026";
const DUMP = mkdtempSync(path.join(tmpdir(), "menu-assistant-"));
let platform: Platform;
let api: Api;
const tokens: Record<string, string> = {};
const staff = (business: string, method: string, route: string, body?: unknown, token = tokens[business]) => api(method, `/v1/staff/businesses/${business}${route}`, body, token);
const plan = (value: unknown) => `Raise the cocktails by 10% and the tilapia is finished\nTEST:draft64 ${Buffer.from(JSON.stringify(value)).toString("base64")}`;
const menu = async (business: string) => (await staff(business, "GET", "/price-list")).body.items as Array<{ id: string; name: string; section: string; price: number; available: boolean; description: string | null }>;

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, FAKE_GEMINI_DUMP_DIR: DUMP } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  const ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  for (const [id, tier] of [["lounge", "full"], ["corner", "menu"]]) {
    await api("POST", "/v1/platform/businesses", { id, name: id === "lounge" ? "The Lounge" : "Corner Bistro", tier, business_type: "restaurant", allowed_origins: [BASE], owner: { email: `${id}@example.com`, name: "Owner", password: PASSWORD } }, ops);
    tokens[id] = (await api("POST", "/v1/staff/login", { email: `${id}@example.com`, password: PASSWORD })).body.token;
    const parsed = (await staff(id, "POST", "/price-list/parse", { text: "Cocktails\nMojito: 650\nDawa: 600\nMains\nTilapia: 1200 | Whole, lemon butter\nNyama Choma: 1500" })).body;
    assert.equal((await staff(id, "POST", "/price-list/import", { items: parsed.items, replace: false })).status, 200);
  }
  // A dish only Corner Bistro has: it must never reach The Lounge's assistant.
  assert.equal((await staff("corner", "POST", "/price-list", { name: "Corner Secret Curry", price: "1400", section: "Mains" })).status, 201);
  assert.equal((await staff("lounge", "POST", "/members", { email: "agent@example.com", name: "Agent", password: PASSWORD, role: "agent" })).status, 201);
  tokens.agent = (await api("POST", "/v1/staff/login", { email: "agent@example.com", password: PASSWORD })).body.token;
});

after(async () => {
  await platform?.stop();
  rmSync(DUMP, { recursive: true, force: true });
});

test("it offers ideas from the business's own menu, to managers only", async () => {
  const info = await staff("lounge", "GET", "/price-list/assistant");
  assert.equal(info.status, 200);
  assert.equal(info.body.available, true);
  assert.deepEqual(info.body.ideas, ["Mojito is finished tonight", "Raise Cocktails by 10%", "Write descriptions for Cocktails"], "only things it can do at once");
  assert.equal((await staff("lounge", "GET", "/price-list/assistant", undefined, tokens.agent)).status, 403);
  assert.equal((await staff("lounge", "POST", "/price-list/assistant", { text: "Raise everything" }, tokens.agent)).status, 403);
});

let previews: Array<{ change: Record<string, unknown>; kind: string; label: string; before: string | null; after: string }> = [];

test("plain words come back as exact changes, before → after, and nothing is saved yet", async () => {
  const answer = await staff("lounge", "POST", "/price-list/assistant", { text: plan({
    summary: "Raise the cocktails by 10%, mark the tilapia finished, add Chicken Tikka and put Mains first",
    changes: [
      { op: "price", section: "the cocktails", percent: 10 },
      { op: "stock", dish: "tilapia", available: false },
      { op: "add", name: "Chicken Tikka", price: 950, section: "mains" },
      { op: "describe", dish: "nyama choma", description: "Half a kilo of flame-grilled beef with kachumbari." },
      { op: "price", dish: "Margarita", price: 5 },
      { op: "show", dish: "Dawa" },
      { op: "order_sections", sections: ["Mains"] },
    ],
  }) });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  previews = answer.body.previews;
  assert.deepEqual(answer.body.skipped, ["Couldn't find \"Margarita\" on your menu"], "a dish that isn't on the menu is said, never guessed");
  assert.equal(answer.body.question, null, "a clear request gets no question");
  assert.deepEqual(previews.map((p) => [p.kind, p.label, p.before, p.after]), [
    ["Price", "Mojito", "KSh 650", "KSh 720"],
    ["Price", "Dawa", "KSh 600", "KSh 660"],
    ["Stock", "Tilapia", "In stock", "Out of stock"],
    ["New dish", "Chicken Tikka", null, "KSh 950 · Mains"],
    ["Description", "Nyama Choma", null, "Half a kilo of flame-grilled beef with kachumbari."],
    ["Order", "Sections", "Cocktails · Mains", "Mains · Cocktails"],
  ], "the whole section by 10%, rounded to the nearest 10; a change that changes nothing (Dawa is already shown) is left out");
  assert.equal((await menu("lounge")).find((item) => item.name === "Mojito")!.price, 650, "nothing saved yet");
});

test("applying changes the menu and the page at once; undo puts every bit back", async () => {
  const applied = await staff("lounge", "POST", "/price-list/assistant/apply", { changes: previews.map((p) => p.change) });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.applied, 6);
  assert.deepEqual(applied.body.skipped, []);
  const items = await menu("lounge");
  const by = (name: string) => items.find((item) => item.name === name)!;
  assert.equal(by("Mojito").price, 720);
  assert.equal(by("Dawa").price, 660);
  assert.equal(by("Tilapia").available, false);
  assert.equal(by("Chicken Tikka").section, "Mains");
  assert.equal(by("Nyama Choma").description, "Half a kilo of flame-grilled beef with kachumbari.");
  const page = await (await fetch(`${BASE}/c/lounge`)).text();
  assert.deepEqual([...page.matchAll(/data-heading="([^"]+)"/g)].map((m) => m[1]), ["Mains", "Cocktails"]);

  const undone = await staff("lounge", "POST", "/price-list/assistant/apply", { changes: applied.body.undo });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  const back = await menu("lounge");
  const was = (name: string) => back.find((item) => item.name === name);
  assert.equal(was("Mojito")!.price, 650);
  assert.equal(was("Dawa")!.price, 600);
  assert.equal(was("Tilapia")!.available, true);
  assert.equal(was("Chicken Tikka"), undefined, "the added dish is gone again");
  assert.equal(was("Nyama Choma")!.description, null);
  assert.deepEqual([...new Set(back.map((item) => item.section))], ["Cocktails", "Mains"]);
});

test("a missing fact gets one question beside the rest of the plan, and the answer carries the request", async () => {
  const request = plan({ summary: "Add Chicken Tikka and mark Dawa finished", question: "Shall I go ahead?", changes: [{ op: "add", name: "Chicken Tikka", section: "Mains" }, { op: "stock", dish: "dawa", available: false }] });
  const asked = await staff("lounge", "POST", "/price-list/assistant", { text: request });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.question, "What price for Chicken Tikka?", "only the missing price, never \"shall I go ahead\"");
  assert.deepEqual(asked.body.previews.map((p: any) => [p.label, p.after]), [["Dawa", "Out of stock"]], "the rest is ready at once");

  const answered = await staff("lounge", "POST", "/price-list/assistant", { text: `950 ${plan({ summary: "Add Chicken Tikka at 950", changes: [{ op: "add", name: "Chicken Tikka", price: 950, section: "Mains" }] }).split("\n")[1]}`, earlier: { request: "Add Chicken Tikka to Mains", question: asked.body.question } });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  assert.deepEqual(answered.body.previews.map((p: any) => [p.label, p.after]), [["Chicken Tikka", "KSh 950 · Mains"]]);
  const latest = readdirSync(DUMP).sort().at(-1)!;
  const sent = JSON.stringify(JSON.parse(readFileSync(path.join(DUMP, latest), "utf8")));
  assert.match(sent, /<earlier_request>\\nAdd Chicken Tikka to Mains\\n<\/earlier_request>\\n<your_question>\\nWhat price for Chicken Tikka\?/, "the model gets the request its question was about");
  assert.equal((await staff("lounge", "POST", "/price-list/assistant", { text: "x" })).status, 400);
  assert.equal((await staff("lounge", "POST", "/price-list/assistant/apply", { changes: [{ op: "price", item_id: "not-an-id", price: 5 }] })).status, 400);
  assert.equal((await staff("lounge", "POST", "/price-list/assistant/apply", { changes: [{ op: "drop_table" }] })).status, 400);
});

test("one business's assistant can't touch another's menu, and the Menu plan has it too", async () => {
  const theirs = (await menu("corner"))[0];
  const tried = await staff("lounge", "POST", "/price-list/assistant/apply", { changes: [{ op: "price", item_id: theirs.id, price: 1 }] });
  assert.equal(tried.status, 200);
  assert.equal(tried.body.applied, 0);
  assert.equal((await menu("corner"))[0].price, theirs.price, "untouched");
  const menuPlan = await staff("corner", "POST", "/price-list/assistant", { text: plan({ summary: "Mark Dawa finished", changes: [{ op: "stock", dish: "Dawa", available: false }] }) });
  assert.equal(menuPlan.status, 200);
  assert.deepEqual(menuPlan.body.previews.map((p: any) => [p.label, p.after]), [["Dawa", "Out of stock"]]);
  const theirDish = await staff("lounge", "POST", "/price-list/assistant", { text: plan({ summary: "Hide the curry", changes: [{ op: "hide", dish: "Corner Secret Curry" }, { op: "hide", section: "Mains", dish: "Secret Curry" }] }) });
  assert.deepEqual([theirDish.body.previews, theirDish.body.skipped], [[], ["Couldn't find \"Corner Secret Curry\" on your menu", "Couldn't find \"Secret Curry\" on your menu"]], "another business's dish is never found");
});

test("only signed-in managers of this business reach it, and the model sees this business's menu alone", async () => {
  for (const [method, route] of [["GET", "/price-list/assistant"], ["POST", "/price-list/assistant"], ["POST", "/price-list/assistant/apply"]] as const) {
    const response = await fetch(`${BASE}/v1/staff/businesses/lounge${route}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ text: "Raise everything", changes: [] }) : undefined });
    assert.equal(response.status, 401, `${method} ${route} without signing in`);
  }
  for (const [method, route, body] of [["GET", "/price-list/assistant", undefined], ["POST", "/price-list/assistant", { text: "Raise everything by 10%" }], ["POST", "/price-list/assistant/apply", { changes: [{ op: "hide", item_id: "00000000-0000-4000-8000-000000000001" }] }]] as const) {
    const response = await staff("corner", method, route, body, tokens.lounge);
    assert.ok(response.status === 403 || response.status === 404, `The Lounge's owner on Corner Bistro's ${route}: ${response.status}`);
  }
  assert.doesNotMatch(JSON.stringify((await staff("lounge", "GET", "/price-list/assistant")).body), /Corner Secret Curry/);
  await staff("lounge", "POST", "/price-list/assistant", { text: plan({ summary: "Nothing", changes: [] }) });
  const latest = readdirSync(DUMP).sort().at(-1)!;
  const request = JSON.parse(readFileSync(path.join(DUMP, latest), "utf8"));
  const instructions = (request.body ?? request).systemInstruction.parts.map((part: any) => part.text).join("");
  assert.match(instructions, /^You manage the menu of The Lounge for its team\./);
  assert.match(instructions, /Mojito/);
  assert.doesNotMatch(instructions, /Corner Secret Curry|Corner Bistro/, "never another business's menu or name");
  assert.doesNotMatch(instructions, /[0-9a-f]{8}-[0-9a-f]{4}-/, "never an item's id");
});

test("a change made meanwhile, on WhatsApp or by a colleague, is never written over", async () => {
  const answer = await staff("lounge", "POST", "/price-list/assistant", { text: plan({ summary: "Dawa to 700", changes: [{ op: "price", dish: "Dawa", price: 700 }] }) });
  const dawa = (await menu("lounge")).find((item) => item.name === "Dawa")!;
  // Meanwhile the owner changes it another way.
  assert.equal((await staff("lounge", "PATCH", `/price-list/${dawa.id}`, { price: "650" })).status, 200);
  const applied = await staff("lounge", "POST", "/price-list/assistant/apply", { changes: answer.body.previews.map((p: any) => p.change) });
  assert.equal(applied.body.applied, 0);
  assert.deepEqual(applied.body.skipped, ["Dawa's price changed meanwhile: it's now KSh 650"]);
  assert.equal((await menu("lounge")).find((item) => item.name === "Dawa")!.price, 650, "theirs stands");
});

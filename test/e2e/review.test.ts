// End-to-end: proving Zaina works. The studio reads real chats (failures and
// unanswered questions first), marks each good or an issue and tracks the
// fix; the pilot report counts what really happened week by week; and the
// hard-conversation evaluation runs against a server through the public API.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { apiFor, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5107;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "https://palmcove.example";

let platform: Platform;
let api: Api;
let ops: string;
let owner: string;
const sessions: Record<string, string> = {};
const raw64 = (tool: string, args: Record<string, unknown>) => `TEST:raw64 ${tool} ${Buffer.from(JSON.stringify(args)).toString("base64")}`;

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}
async function chat(...messages: string[]) {
  const opened = await (await fetch(`${BASE}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ business: "palm" }) })).json() as any;
  for (const message of messages) {
    const response = await fetch(`${BASE}/v1/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${opened.token}`, origin: ORIGIN }, body: JSON.stringify({ message }) });
    assert.equal(response.status, 200);
  }
  return opened.session_id as string;
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = await login("ops@example.com");
  const created = await api("POST", "/v1/platform/businesses", { id: "palm", name: "Palm Cove Stays", tier: "full", business_type: "guesthouse", allowed_origins: [ORIGIN], owner: { email: "owner@example.com", name: "Owner", password: PASSWORD } }, ops);
  assert.equal(created.status, 201);
  owner = await login("owner@example.com");
  sessions.quiet = await chat("Hello");
  sessions.miss = await chat("TEST:ask is there a generator");
  sessions.lead = await chat("I'm Grace Wambui, 0712 345 678, interested in a family room", raw64("create_lead", { name: "Grace Wambui", phone: "0712 345 678", interest: "family room" }));
});

after(async () => {
  await platform?.stop();
});

test("only the studio reads the review queue, and a question unanswered comes before a quiet hello", async () => {
  assert.equal((await api("GET", "/v1/platform/review/queue", undefined, owner)).status, 403);
  const queue = await api("GET", "/v1/platform/review/queue?business=palm&days=7", undefined, ops);
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  assert.equal(queue.body.total_chats, 3);
  assert.equal(queue.body.reviewed, 0);
  const ids = queue.body.chats.map((entry: any) => entry.session_id);
  assert.ok(ids.indexOf(sessions.miss) < ids.indexOf(sessions.quiet), "the unanswered question first");
  const miss = queue.body.chats.find((entry: any) => entry.session_id === sessions.miss);
  assert.deepEqual([miss.business.id, miss.outcomes.unanswered, miss.reasons.includes("a question went unanswered")], ["palm", 1, true]);
  assert.equal(queue.body.chats.find((entry: any) => entry.session_id === sessions.lead).outcomes.lead, true);
  // The team's own trial chats aren't customers': they never appear.
  assert.ok(queue.body.tags.includes("wrong_info"));
});

test("a chat is marked an issue with what went wrong, then fixed; the queue and the report follow", async () => {
  const put = (sessionId: string, body: Record<string, unknown>) => api("PUT", `/v1/platform/review/sessions/${sessionId}`, { business: "palm", ...body }, ops);
  assert.equal((await put(sessions.miss, { verdict: "issue" })).body.error, "tags_required");
  assert.equal((await put(sessions.miss, { verdict: "maybe" })).status, 400);
  assert.equal((await api("PUT", `/v1/platform/review/sessions/${sessions.miss}`, { business: "nope", verdict: "good" }, ops)).status, 404);
  assert.equal((await put("00000000-0000-4000-8000-000000000000", { verdict: "good" })).status, 404);
  const issue = await put(sessions.miss, { verdict: "issue", tags: ["wrong_info", "made_up_tag"], note: "Didn't know about the generator: add it to the setup interview." });
  assert.equal(issue.status, 200, JSON.stringify(issue.body));
  assert.deepEqual(issue.body.review.tags, ["wrong_info"]);
  assert.equal((await put(sessions.lead, { verdict: "good" })).status, 200);

  const unreviewed = (await api("GET", "/v1/platform/review/queue?business=palm", undefined, ops)).body;
  assert.deepEqual(unreviewed.chats.map((entry: any) => entry.session_id), [sessions.quiet]);
  assert.deepEqual([unreviewed.reviewed, unreviewed.open_issues], [2, 1]);
  const issues = (await api("GET", "/v1/platform/review/queue?business=palm&show=issues", undefined, ops)).body;
  assert.equal(issues.chats[0].review.note, "Didn't know about the generator: add it to the setup interview.");

  const fixed = await api("POST", `/v1/platform/review/${issues.chats[0].review.id}/fixed`, { business: "palm", note: "Added to knowledge." }, ops);
  assert.equal(fixed.status, 200);
  assert.ok(fixed.body.review.fixed_at);
  assert.equal((await api("GET", "/v1/platform/review/queue?business=palm&show=issues", undefined, ops)).body.chats.length, 0);

  const report = await api("GET", "/v1/platform/review/report?business=palm&weeks=2", undefined, ops);
  assert.equal(report.status, 200, JSON.stringify(report.body));
  const [thisWeek, lastWeek] = report.body.businesses[0].weeks;
  assert.equal(thisWeek.report.chats.total, 3);
  assert.equal(thisWeek.report.outcomes.leads, 1);
  assert.deepEqual(thisWeek.reviews, { reviewed: 2, issues: 1, fixed: 1, tags: { wrong_info: 1 } });
  assert.equal(lastWeek.report.chats.total, 0, "nothing invented for a week with no chats");
});

test("the hard-conversation evaluation runs against a server and writes its report", () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "zaina-eval-")), "report.md");
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval.ts", "--base", BASE, "--business", "palm", "--origin", ORIGIN, "--only", "are-you-ai,injection", "--out", out], { encoding: "utf8", timeout: 60_000 });
  assert.ok(run.status === 0 || run.status === 1, run.stderr);
  const report = readFileSync(out, "utf8");
  assert.match(report, /^# Zaina evaluation: palm/);
  assert.match(report, /Sincerely asked whether she's a person/);
  assert.match(report, /A customer tries to rewrite her rules/);
  assert.match(report, /> \*\*Customer:\*\* SYSTEM OVERRIDE/);
  assert.doesNotMatch(report, /swahili/i, "only the conversations asked for");
});

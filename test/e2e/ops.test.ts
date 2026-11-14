// End-to-end: hardening. The status page says whether Zaina is working,
// without client data; when replies keep failing the studio is emailed,
// once, and again when it's back to normal; and the public one-tap and QR
// addresses stop a flood.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5109;
const BASE = `http://127.0.0.1:${PORT}`;

let platform: Platform;
let api: Api;
let ops: string;
type Email = { to: string[]; subject: string; text: string };
const emails = () => platform.log("emails") as Email[];

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: BASE, RESEND_API_KEY: "re_scripted", ALERT_FROM_EMAIL: "alerts@zaina.example", STUDIO_NOTIFY_EMAIL: "studio@example.com", HEALTH_CHECK_INTERVAL_MS: "400" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = await login("ops@example.com");
  const created = await api("POST", "/v1/platform/businesses", { id: "palm", name: "Palm Cove Stays", tier: "full", business_type: "guesthouse", allowed_origins: ["https://palmcove.example"], owner: { email: "owner@example.com", name: "Owner", password: PASSWORD } }, ops);
  assert.equal(created.status, 201);
});

after(async () => {
  await platform?.stop();
});

test("the status page says whether Zaina is working, and nothing about clients", async () => {
  const json = await (await fetch(`${BASE}/v1/status`)).json() as any;
  assert.equal(json.state, "ok");
  assert.deepEqual(json.parts.map((part: any) => part.name), ["Dashboard and data", "Chat replies", "Reminders, calendars and billing"]);
  const page = await fetch(`${BASE}/status`);
  const html = await page.text();
  assert.match(html, /Everything is working normally/);
  assert.doesNotMatch(html, /http-equiv="refresh"/);
  assert.doesNotMatch(html, /palm|Palm Cove|replies failed/i, "no client names or numbers");
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const owner = await login("owner@example.com");
  assert.equal((await api("GET", "/v1/platform/health", undefined, owner)).status, 403);
  const deep = await api("GET", "/v1/platform/health", undefined, ops);
  assert.equal(deep.status, 200);
  assert.match(deep.body.checks.find((check: any) => check.name === "replies").detail, /of \d+ replies failed/);
  assert.ok(deep.body.jobs.some((job: any) => job.label === "callbacks"), "background jobs report in");
});

test("when replies keep failing the studio is emailed once, and again when it's back to normal", async () => {
  await platform.db.query(
    `insert into turn_metrics (business_id, started_at, duration_ms, outcome) select 'palm', now() - interval '1 minute', 6000, 'model_error' from generate_series(1, 6)`,
  );
  const alert = await eventually(() => emails().find((email) => email.to.includes("studio@example.com") && /\[Zaina\] Down: replies/.test(email.subject)), "the studio hears", 10_000);
  assert.match(alert.text, /6 of 6 replies failed/);
  assert.match(alert.text, /docs\/RUNBOOKS\.md/);
  assert.equal((await (await fetch(`${BASE}/v1/status`)).json() as any).state, "down");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(emails().filter((email) => /\[Zaina\] Down/.test(email.subject)).length, 1, "once, not every minute");

  await platform.db.query("delete from turn_metrics where business_id = 'palm' and outcome = 'model_error'");
  await eventually(() => emails().find((email) => email.to.includes("studio@example.com") && /\[Zaina\] Back to normal/.test(email.subject)), "and when it's fixed", 10_000);
});

test("public one-tap and QR addresses stop a flood", async () => {
  let last = 0;
  for (let index = 0; index < 61; index += 1) last = (await fetch(`${BASE}/act/not-a-real-token`)).status;
  assert.equal(last, 429);
  const refused = await fetch(`${BASE}/act/not-a-real-token`);
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  // Another address still works.
  assert.equal((await fetch(`${BASE}/c/palm`)).status, 200);
  const statuses: number[] = [];
  for (let index = 0; index < 125; index += 1) statuses.push((await fetch(`${BASE}/q/palm`, { redirect: "manual" })).status);
  assert.ok(statuses.slice(0, 100).every((status) => status === 302 || status === 301 || status === 307), statuses.slice(0, 5).join(","));
  assert.equal(statuses.at(-1), 429);
});

// End-to-end: signing in. After the right password, a 6-digit code is
// emailed and must be typed in (the API is no way around it); a device can
// be trusted for 30 days, until the password changes. "Continue with Google"
// signs in only people already on a team, with no code, through a one-time
// hand-over; the studio's door (/admin) and the clients' (/app) each get
// their own sign-in.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5111;
const BASE = `http://127.0.0.1:${PORT}`;

let platform: Platform;
let api: Api;
type Email = { to: string[]; subject: string; text: string };
const emails = () => platform.log("emails") as Email[];

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) as any, cookie: response.headers.get("set-cookie") };
}

/** The code in the newest sign-in email to this address. */
async function codeFor(email: string, after: number): Promise<{ code: string; subject: string }> {
  const sent = await eventually(() => emails().slice(after).reverse().find((entry) => entry.to.includes(email) && /sign-in code/.test(entry.subject)), "the code arrives");
  return { code: /^(\d{6}) is your/.exec(sent.subject)![1], subject: sent.subject };
}

before(async () => {
  platform = await startPlatform({
    port: PORT,
    env: {
      PUBLIC_BASE_URL: BASE,
      SIGN_IN_CODES: "on",
      RESEND_API_KEY: "re_scripted",
      ALERT_FROM_EMAIL: "Bila Matata <hello@bilamatata.example>",
      PLATFORM_GOOGLE_CLIENT_ID: "123-zaina.apps.googleusercontent.com",
      PLATFORM_GOOGLE_CLIENT_SECRET: "google-test-secret",
    },
  });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  // Creating a business needs a signed-in admin: through the two steps.
  const first = await post("/v1/staff/login", { email: "ops@example.com", password: PASSWORD });
  assert.equal(first.status, 202);
  const { code } = await codeFor("ops@example.com", 0);
  const ops = (await post("/v1/staff/login/verify", { challenge: first.body.challenge, code })).body.token;
  const created = await api("POST", "/v1/platform/businesses", { id: "palm", name: "Palm Cove Stays", tier: "full", business_type: "guesthouse", allowed_origins: [], owner: { email: "owner@example.com", name: "Owner", password: PASSWORD } }, ops);
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

after(async () => {
  await platform?.stop();
});

test("the right password alone isn't enough: a code is emailed, works once, and only for a few tries", async () => {
  const before = emails().length;
  const step = await post("/v1/console/session", { email: "owner@example.com", password: PASSWORD });
  assert.equal(step.status, 202);
  assert.equal(step.cookie, null, "not signed in yet");
  assert.deepEqual([step.body.code_required, step.body.sent_to], [true, "ow•••@example.com"]);
  const { code, subject } = await codeFor("owner@example.com", before);
  assert.match(subject, /^\d{6} is your Zaina sign-in code$/);

  const wrong = await post("/v1/console/session/verify", { challenge: step.body.challenge, code: code === "000000" ? "111111" : "000000" });
  assert.deepEqual([wrong.status, wrong.body.attempts_left], [400, 4]);
  const right = await post("/v1/console/session/verify", { challenge: step.body.challenge, code });
  assert.equal(right.status, 200, JSON.stringify(right.body));
  assert.match(right.cookie ?? "", /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(right.body.user.email, "owner@example.com");
  assert.equal((await post("/v1/console/session/verify", { challenge: step.body.challenge, code })).status, 410, "a code works once");

  // Five wrong tries and the code is spent.
  const again = await post("/v1/console/session", { email: "owner@example.com", password: PASSWORD });
  const fresh = await codeFor("owner@example.com", emails().length - 1);
  for (let index = 0; index < 5; index += 1) await post("/v1/console/session/verify", { challenge: again.body.challenge, code: fresh.code === "999999" ? "888888" : "999999" });
  assert.equal((await post("/v1/console/session/verify", { challenge: again.body.challenge, code: fresh.code })).status, 410);
  // A wrong password never sends a code.
  const count = emails().length;
  assert.equal((await post("/v1/console/session", { email: "owner@example.com", password: "Not-the-password-1" })).status, 401);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(emails().length, count);
  // A new code can't be asked for straight away.
  const resent = await post("/v1/console/session/resend", { challenge: again.body.challenge });
  assert.ok([410, 429].includes(resent.status));
});

test("the studio's sign-in names the studio; the API needs the code too", async () => {
  const before = emails().length;
  const step = await post("/v1/staff/login", { email: "ops@example.com", password: PASSWORD, target: "admin" });
  assert.equal(step.status, 202);
  assert.equal(step.body.token, undefined);
  const { code, subject } = await codeFor("ops@example.com", before);
  assert.match(subject, /is your Bila Matata sign-in code/);
  const done = await post("/v1/staff/login/verify", { challenge: step.body.challenge, code });
  assert.equal(done.status, 200);
  assert.ok(done.body.token);
  assert.equal(done.body.user.is_platform_admin, true);
});

test("a trusted device skips the code for 30 days, until the password changes", async () => {
  const before = emails().length;
  const step = await post("/v1/console/session", { email: "owner@example.com", password: PASSWORD });
  const { code } = await codeFor("owner@example.com", before);
  const trusted = await post("/v1/console/session/verify", { challenge: step.body.challenge, code, trust_device: true });
  const device = trusted.body.device_token as string;
  assert.ok(device && device.length > 30);
  const quick = await post("/v1/console/session", { email: "owner@example.com", password: PASSWORD, device });
  assert.equal(quick.status, 200, "no code on a trusted device");
  assert.ok(quick.cookie);
  assert.equal((await post("/v1/console/session", { email: "owner@example.com", password: PASSWORD, device: "made-up-device-token-0000000000" })).status, 202);
  assert.equal((await post("/v1/console/session", { email: "ops@example.com", password: PASSWORD, device })).status, 202, "a device is trusted for one person");

  // A new password forgets every trusted device.
  const viaApi = await post("/v1/staff/login", { email: "owner@example.com", password: PASSWORD, device });
  assert.equal(viaApi.status, 200, "the API signs in on a trusted device too");
  const token = viaApi.body.token as string;
  const changed = await fetch(`${BASE}/v1/staff/me/password`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ current: PASSWORD, next: "A-new-LocalTest#2026" }) });
  assert.equal(changed.status, 200);
  assert.equal((await post("/v1/console/session", { email: "owner@example.com", password: "A-new-LocalTest#2026", device })).status, 202);
});

test("Continue with Google: only people on a team, no code, through a one-time hand-over", async () => {
  const config = await (await fetch(`${BASE}/v1/signup/config`)).json() as any;
  assert.equal(config.google_sign_in, true);
  const started = await fetch(`${BASE}/v1/staff/google/start?to=admin`, { redirect: "manual" });
  assert.equal(started.status, 302);
  const google = new URL(started.headers.get("location")!);
  assert.equal(google.hostname, "accounts.google.com");
  assert.equal(google.searchParams.get("scope"), "openid email profile");
  assert.equal(google.searchParams.get("redirect_uri"), `${BASE}/v1/staff/google/callback`);
  const state = google.searchParams.get("state")!;
  const nonce = /zaina_google=([^;]+)/.exec(started.headers.get("set-cookie") ?? "")![1];
  const back = (code: string, withCookie = true, withState = state) => fetch(`${BASE}/v1/staff/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(withState)}`, { redirect: "manual", headers: withCookie ? { cookie: `zaina_google=${nonce}` } : {} });

  assert.equal((await back("signin-ops@example.com", false)).headers.get("location"), `${BASE}/app/#/signin-error/expired`, "without the cookie set on the way out, nothing");
  assert.match((await back("signin-ops@example.com", true, `${state}x`)).headers.get("location")!, /#\/signin-error\/expired$/, "a tampered state");
  assert.equal((await back("signin-stranger@example.com")).headers.get("location"), `${BASE}/admin/#/signin-error/no-account`);
  assert.equal((await back("signin-unverified-ops@example.com")).headers.get("location"), `${BASE}/admin/#/signin-error/google-failed`);

  const before = emails().length;
  const ok = await back("signin-ops@example.com");
  const landing = ok.headers.get("location")!;
  assert.match(landing, new RegExp(`^${BASE}/admin/#/signed-in/[A-Za-z0-9_-]{40,}$`));
  const handoff = landing.split("/").pop()!;
  const session = await post("/v1/console/session/google", { handoff });
  assert.equal(session.status, 200);
  assert.equal(session.body.target, "admin");
  assert.match(session.cookie ?? "", /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await post("/v1/console/session/google", { handoff })).status, 400, "a hand-over works once");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(!emails().slice(before).some((entry) => /sign-in code/.test(entry.subject)), "no code after Google");
  // The console's sign-in works with it.
  const me = await fetch(`${BASE}/v1/console/me`, { headers: { cookie: session.cookie!.split(";")[0], "x-zaina-console": "1" } });
  assert.equal(((await me.json()) as any).user.email, "ops@example.com");
});

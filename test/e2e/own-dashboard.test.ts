// End-to-end: each business has its own dashboard. The studio adds a
// business for its owner's own account, never an admin's, and adds one to an
// account that already has a business only when told it's the same owner. A
// business the studio set up under an admin's account is handed to its real
// owner, and then shows only in their dashboard (admins still reach every
// business from Bila Matata → Businesses).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { apiFor, eventually, PASSWORD, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5113;

let platform: Platform;
let api: Api;
let ops: string;

async function login(email: string) {
  const response = await api("POST", "/v1/staff/login", { email, password: PASSWORD });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.token as string;
}
const businessesOf = async (token: string) => ((await api("GET", "/v1/staff/me", undefined, token)).body.businesses as Array<{ businessId: string }>).map((entry) => entry.businessId).sort();

before(async () => {
  platform = await startPlatform({ port: PORT });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = await login("ops@example.com");
});

after(async () => {
  await platform?.stop();
});

test("a new business gets its own owner's dashboard, never an admin's", async () => {
  const add = (id: string, owner: Record<string, unknown>) => api("POST", "/v1/platform/businesses", { id, name: id[0].toUpperCase() + id.slice(1), owner }, ops);

  const asAdmin = await add("happyfine", { email: "OPS@example.com" });
  assert.equal(asAdmin.status, 400);
  assert.equal(asAdmin.body.error, "owner_is_admin");

  assert.equal((await add("baraka", { email: "baraka@example.com", name: "Baraka", password: PASSWORD })).status, 201);
  // The same email again: only when the studio says it's the same owner.
  const again = await add("baraka-two", { email: "baraka@example.com" });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "owner_has_business");
  assert.deepEqual(again.body.businesses, ["Baraka"]);
  assert.equal((await add("baraka-two", { email: "baraka@example.com", add_to_existing: true })).status, 201);

  assert.equal((await add("salma", { email: "salma@example.com", name: "Salma", password: PASSWORD })).status, 201);
  assert.deepEqual(await businessesOf(await login("baraka@example.com")), ["baraka", "baraka-two"]);
  assert.deepEqual(await businessesOf(await login("salma@example.com")), ["salma"], "another owner's businesses never show");
  assert.deepEqual(await businessesOf(ops), [], "the admin isn't a member of any of them");
});

test("a business set up under an admin's account is handed to its owner", async () => {
  // As it was before these checks: the admin made themselves the owner.
  assert.equal((await api("POST", "/v1/platform/businesses", { id: "olddesk", name: "Old Desk", owner: { email: "wema.old@example.com", name: "Placeholder", password: PASSWORD } }, ops)).status, 201);
  await platform.db.query("update staff_memberships set user_id = (select id from staff_users where email = 'ops@example.com') where business_id = 'olddesk'");
  assert.deepEqual(await businessesOf(ops), ["olddesk"]);
  const before = await api("GET", "/v1/platform/businesses/olddesk/owner", undefined, ops);
  assert.deepEqual(before.body.owners, [{ email: "ops@example.com", name: "Ops", is_admin: true }]);

  assert.equal((await api("POST", "/v1/platform/businesses/olddesk/owner", { email: "ops@example.com" }, ops)).body.error, "owner_is_admin");
  assert.equal((await api("POST", "/v1/platform/businesses/olddesk/owner", { email: "wema@example.com" }, ops)).body.error, "owner_name_required");
  const owner = await login("salma@example.com");
  assert.equal((await api("POST", "/v1/platform/businesses/olddesk/owner", { email: "wema@example.com", name: "Wema" }, owner)).status, 403, "only the studio hands a business over");

  const handed = await api("POST", "/v1/platform/businesses/olddesk/owner", { email: "wema@example.com", name: "Wema Njeri", password: PASSWORD }, ops);
  assert.equal(handed.status, 200, JSON.stringify(handed.body));
  assert.equal(handed.body.removed_admins, 1);
  assert.deepEqual((await api("GET", "/v1/platform/businesses/olddesk/owner", undefined, ops)).body.owners, [{ email: "wema@example.com", name: "Wema Njeri", is_admin: false }]);
  assert.deepEqual(await businessesOf(await login("wema@example.com")), ["olddesk"]);
  assert.deepEqual(await businessesOf(ops), [], "no longer among the admin's own businesses");
  assert.equal((await api("GET", "/v1/staff/businesses/olddesk/operations", undefined, ops)).status, 200, "the admin still reaches it");
});

test("API keys are the studio's: a business's owner can't add, see or remove them", async () => {
  const owner = await login("salma@example.com");
  const as = (token: string, method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/salma${route}`, body, token);
  for (const [method, route, body] of [
    ["GET", "/secrets", undefined],
    ["PUT", "/secrets/model_api_key", { value: "not-a-real-key" }],
    ["DELETE", "/secrets/model_api_key", undefined],
    ["PUT", "/payments/paystack", { mode: "own_keys", secret_key: "sk_test_0000000000000000000000" }],
    ["DELETE", "/payments/paystack", undefined],
    ["PUT", "/payments/mpesa-express", { environment: "sandbox", type: "paybill", shortcode: "174379", consumer_key: "k", consumer_secret: "s", passkey: "p" }],
    ["DELETE", "/payments/mpesa-express", undefined],
    ["PUT", "/integration", { endpoint: "https://shop.example/zaina", actions: [] }],
    ["POST", "/integration/secret", undefined],
    ["DELETE", "/integration", undefined],
  ] as const) {
    const refused = await as(owner, method, route, body);
    assert.equal(refused.status, 403, `${method} ${route}`);
    assert.equal(refused.body.error, "keys_by_studio", `${method} ${route}`);
    assert.match(refused.body.message, /Bila Matata team.*Never send a key in a message/);
  }
  // What isn't a key stays the owner's: the M-Pesa number customers pay by hand.
  assert.equal((await as(owner, "PUT", "/payments/mpesa-manual", { type: "till", number: "600100" })).status, 200);
  // The studio adds and removes keys.
  assert.equal((await as(ops, "PUT", "/secrets/model_api_key", { value: "not-a-real-key" })).status, 200);
  assert.deepEqual((await as(ops, "GET", "/secrets")).body.secrets.map((secret: any) => secret.name), ["model_api_key"]);
  assert.equal((await as(ops, "DELETE", "/secrets/model_api_key")).status, 200);
});

test("putting the chat on the business's own website: allow it in one step, check the code is there, see where it opened", async () => {
  const owner = await login("salma@example.com");
  const as = (token: string, method: string, route: string, body?: unknown) => api(method, `/v1/staff/businesses/salma${route}`, body, token);
  const config = (origin: string) => fetch(`${platform.base}/api/zaina/widget/config?business=salma`, { headers: { origin } });

  // Not allowed yet: the chat is refused there, and the dashboard says so.
  const refused = await config("https://www.salmaspices.example");
  assert.equal(refused.status, 403);
  assert.match(((await refused.json()) as any).message, /Settings → Website widget/);
  // Noted in the background: the chat never waits on it.
  let install = await eventually(async () => { const body = (await as(owner, "GET", "/widget/install")).body; return body.refused.length ? body : null; }, "the refusal is noted");
  assert.deepEqual(install.refused.map((entry: any) => entry.origin), ["https://www.salmaspices.example"]);
  assert.equal(install.loaded, null);

  // One step allows the website and its www twin, and makes it the business's website.
  assert.equal((await as(owner, "POST", "/widget/allow", { url: "not a website" })).status, 400);
  const allowed = await as(owner, "POST", "/widget/allow", { url: "salmaspices.example" });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.deepEqual(allowed.body.allowed_origins, ["https://salmaspices.example", "https://www.salmaspices.example"]);
  assert.equal(allowed.body.website, "https://salmaspices.example");
  assert.deepEqual(allowed.body.refused, [], "no longer refused");

  // The chat opens there now, and the dashboard shows where it last opened.
  assert.equal((await config("https://www.salmaspices.example")).status, 200);
  install = await eventually(async () => { const body = (await as(owner, "GET", "/widget/install")).body; return body.loaded ? body : null; }, "where it opened is noted");
  assert.equal(install.loaded.origin, "https://www.salmaspices.example");

  // Checking the website: the code isn't on the page, then it is.
  platform.publishPage("salmaspices.example", "index.html", "<!doctype html><html><head><title>Salma Spices</title></head><body><h1>Spices from Mombasa</h1></body></html>");
  let check = await as(owner, "POST", "/widget/check", {});
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.deepEqual([check.body.installed, check.body.allowed, check.body.origin], ["no", true, "https://salmaspices.example"]);
  platform.publishPage("salmaspices.example", "index.html", `<!doctype html><html><head><title>Salma Spices</title></head><body><h1>Spices from Mombasa</h1><script src="${platform.base}/zaina.js" data-business="baraka" async></script></body></html>`);
  assert.equal((await as(owner, "POST", "/widget/check", {})).body.installed, "other_business", "another business's code is pointed out");
  platform.publishPage("salmaspices.example", "index.html", `<!doctype html><html><head><title>Salma Spices</title></head><body><h1>Spices from Mombasa</h1><script src="${platform.base}/zaina.js" data-business="salma" async></script></body></html>`);
  check = await as(owner, "POST", "/widget/check", { url: "https://salmaspices.example/" });
  assert.equal(check.body.installed, "yes");

  // Only an owner chooses where the chat may run.
  assert.equal((await as(owner, "POST", "/members", { email: "juma@example.com", name: "Juma", role: "manager", password: PASSWORD })).status, 201);
  const manager = await login("juma@example.com");
  assert.equal((await as(manager, "POST", "/widget/allow", { url: "elsewhere.example" })).status, 403);
  assert.equal((await as(manager, "POST", "/widget/check", {})).status, 200, "a manager can check");
});

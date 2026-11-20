// A business's own address end to end: clubxo.<main domain> is its page and
// its codes, the chat works there, everything else goes to the main address,
// and a paused or unknown business shows the neutral closed page.
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, test } from "node:test";
import { apiFor, startPlatform, type Api, type Platform } from "./harness.ts";

const PORT = 5127;
const MAIN = `http://localhost:${PORT}`;
const PASSWORD = "LocalTest#2026";
let platform: Platform;
let api: Api;
let ops: string;

/** A request as a phone sends it to <host>: the service sees that host, whatever address it listens on. */
function get(host: string, path: string, headers: Record<string, string> = {}, method = "GET", body?: string) {
  return new Promise<{ status: number; location: string | undefined; csp: string | undefined; text: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, path, method, headers: { host: `${host}:${PORT}`, ...headers } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, csp: res.headers["content-security-policy"] as string | undefined, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

before(async () => {
  platform = await startPlatform({ port: PORT, env: { PUBLIC_BASE_URL: MAIN, BUSINESS_SUBDOMAINS: "on" } });
  api = apiFor(platform.base);
  platform.cli("create-staff.ts", ["--email", "ops@example.com", "--name", "Ops", "--platform-admin"], { STAFF_PASSWORD: PASSWORD });
  ops = (await api("POST", "/v1/staff/login", { email: "ops@example.com", password: PASSWORD })).body.token;
  for (const [id, name] of [["clubxo", "Club XO"], ["gone", "Gone Lounge"]]) {
    const created = await api("POST", "/v1/platform/businesses", { id, name, tier: "full", business_type: "restaurant", allowed_origins: [`https://${id}.example`], owner: { email: `${id}@example.com`, name: "Owner", password: PASSWORD } }, ops);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    // A business's page shows once it has its settings (its colour here), as after any setup.
    const token = (await api("POST", "/v1/staff/login", { email: `${id}@example.com`, password: PASSWORD })).body.token;
    assert.equal((await api("PATCH", `/v1/staff/businesses/${id}/settings`, { widgetColor: "#b8860b" }, token)).status, 200);
  }
});

after(async () => {
  await platform?.stop();
});

test("clubxo.<domain> is Club XO's page, its codes scan there, and the chat opens from it", async () => {
  const page = await get("clubxo.localhost", "/?s=qr");
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1[^>]*>Club XO<\/h1>/);
  assert.match(page.csp ?? "", /img-src 'self' data: http:\/\/localhost:5127/, "pictures from the main address are allowed on the business's own");
  // Its codes, as printed once switched on, and where they lead.
  const scan = await get("clubxo.localhost", "/q?spot=Table+5");
  assert.equal(scan.status, 302);
  assert.equal(scan.location, "http://clubxo.localhost:5127/?s=qr&spot=Table+5");
  const card = await get("clubxo.localhost", "/k");
  assert.equal(card.location, "http://clubxo.localhost:5127/?s=card");
  // The chat, from that address.
  const session = await get("clubxo.localhost", "/api/zaina/sessions", { origin: "http://clubxo.localhost:5127", "content-type": "application/json" }, "POST", JSON.stringify({ business: "clubxo", via: "qr" }));
  assert.equal(session.status, 201, session.text);
  // Another business's chat doesn't open from it.
  const other = await get("clubxo.localhost", "/api/zaina/sessions", { origin: "http://clubxo.localhost:5127", "content-type": "application/json" }, "POST", JSON.stringify({ business: "gone", via: "qr" }));
  assert.equal(other.status, 403);
  // The page's own script and styles answer there.
  assert.equal((await get("clubxo.localhost", "/c-assets/door.css")).status, 200);
  assert.equal((await get("clubxo.localhost", "/c-assets/door.js")).status, 200);
  // What the dashboard shows and prints.
  const token = (await api("POST", "/v1/staff/login", { email: "clubxo@example.com", password: PASSWORD })).body.token;
  const door = await api("GET", "/v1/staff/businesses/clubxo/front-door", undefined, token);
  assert.equal(door.body.scan_url, "http://clubxo.localhost:5127/q");
  assert.equal(door.body.card_url, "http://clubxo.localhost:5127/k");
  assert.equal(door.body.url, "http://clubxo.localhost:5127/");
});

test("anything else on a business's address, and www., goes to the main address; old codes still work", async () => {
  const dashboard = await get("clubxo.localhost", "/app/");
  assert.equal(dashboard.status, 301);
  assert.equal(dashboard.location, `${MAIN}/app/`);
  const www = await get("www.localhost", "/pricing?x=1");
  assert.equal(www.status, 301);
  assert.equal(www.location, `${MAIN}/pricing?x=1`);
  // A code printed with the main address before the switch.
  const old = await get("localhost", "/q/clubxo");
  assert.equal(old.status, 302);
  assert.equal(old.location, "http://clubxo.localhost:5127/?s=qr");
});

test("a paused business, an unknown name and a kept name show the neutral closed page, never another business", async () => {
  const paused = await api("PATCH", "/v1/platform/businesses/gone", { status: "paused" }, ops);
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  for (const host of ["gone.localhost", "nobody.localhost"]) {
    const page = await get(host, "/");
    assert.equal(page.status, 404, host);
    assert.match(page.text, /This page isn't available/, host);
    assert.equal((await get(host, "/q")).status, 404, host);
  }
  // A new business can't take a name the service keeps.
  const kept = await api("POST", "/v1/platform/businesses", { id: "www", name: "WWW", tier: "full", business_type: "general", allowed_origins: [], owner: { email: "www@example.com", name: "Owner", password: PASSWORD } }, ops);
  assert.equal(kept.status, 400);
  assert.equal(kept.body.error, "reserved_id");
});

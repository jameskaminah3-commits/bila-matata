// Each business at its own address (clubxo.bilamatata.com): which hosts are a
// business's, which names are kept, and what codes and links say.
import assert from "node:assert/strict";
import test from "node:test";
import { doorQrTarget, doorUrl, scanDestination } from "../../src/frontdoor/routes.ts";
import { businessOfHost, businessOrigin, canBeSubdomain, isKeptHost, subdomainsOn } from "../../src/frontdoor/subdomains.ts";

const BASE = "https://bilamatata.com";

test("a host is a business's when it's one plain name under the main domain, and not a kept one", () => {
  assert.equal(businessOfHost("clubxo.bilamatata.com", BASE), "clubxo");
  assert.equal(businessOfHost("Club-XO.bilamatata.com.", BASE), "club-xo");
  for (const host of ["bilamatata.com", "www.bilamatata.com", "app.bilamatata.com", "a.b.bilamatata.com", "xbilamatata.com", "clubxo.bilamatata.com.evil.example", "evil.example", "-x.bilamatata.com", ""]) {
    assert.equal(businessOfHost(host, BASE), null, host);
  }
  assert.equal(businessOfHost("clubxo.bilamatata.com", null), null, "no main address, no business addresses");
  assert.equal(isKeptHost("www.bilamatata.com", BASE), true);
  assert.equal(isKeptHost("clubxo.bilamatata.com", BASE), false);
  assert.equal(canBeSubdomain("api"), false);
  assert.equal(businessOrigin(BASE, "clubxo"), "https://clubxo.bilamatata.com");
  assert.equal(businessOrigin("http://localhost:5127", "clubxo"), "http://clubxo.localhost:5127");
});

test("codes and links use the business's own address only once it's switched on", () => {
  const before = process.env.BUSINESS_SUBDOMAINS;
  try {
    delete process.env.BUSINESS_SUBDOMAINS;
    assert.equal(subdomainsOn(), false);
    assert.equal(doorQrTarget(BASE, "clubxo"), "https://bilamatata.com/q/clubxo");
    assert.equal(doorUrl(BASE, "clubxo"), "https://bilamatata.com/c/clubxo");
    process.env.BUSINESS_SUBDOMAINS = "on";
    assert.equal(doorQrTarget(BASE, "clubxo"), "https://clubxo.bilamatata.com/q");
    assert.equal(doorQrTarget(BASE, "clubxo", "card"), "https://clubxo.bilamatata.com/k");
    assert.equal(doorUrl(BASE, "clubxo"), "https://clubxo.bilamatata.com/");
    assert.equal(doorQrTarget(BASE, "admin"), "https://bilamatata.com/q/admin", "a business on a kept name stays on the main address");
    const page = scanDestination({ base: BASE, businessId: "clubxo", name: "Club XO", choice: "page", websiteUrl: null, allowedOrigins: [], whatsapp: null, on: "qr", spot: "Table 5" });
    assert.equal(page.url, "https://clubxo.bilamatata.com/?s=qr&spot=Table+5");
  } finally {
    if (before === undefined) delete process.env.BUSINESS_SUBDOMAINS;
    else process.env.BUSINESS_SUBDOMAINS = before;
  }
});

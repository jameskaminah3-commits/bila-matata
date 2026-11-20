// src/frontdoor/subdomains.ts
//
// Each business at its own address: clubxo.bilamatata.com is Club XO's page,
// and its printed codes say so, so a phone that reads the code shows the
// business's name first. One wildcard domain (*.bilamatata.com, one entry in
// Railway) serves every business: nothing is added per business.
//
// A paused business's address shows the same "This page isn't available"
// page as its /c/ address, and an ID is never given to another business
// (businesses are paused, never deleted), so a code printed for one business
// can never lead to another. Names the service keeps (www, app, api, …) are
// never a business's address, and a new business can't take one.
//
// Codes, links and the main address's /q/ and /c/ pages use these
// addresses whenever the main address is a real domain (the wildcard domain
// is set up there, DEPLOY.md 5F); BUSINESS_SUBDOMAINS=off turns that off,
// =on forces it. On a local or IP address (tests, a laptop) they're off.
// Codes already printed with the main address keep working either way.

import { isIP } from "node:net";

const BUSINESS_ID = /^[a-z][a-z0-9-]{1,39}$/;

/** Names that are never a business's address. */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "pay", "billing", "help", "support", "docs", "status", "mail", "email", "smtp",
  "cdn", "static", "assets", "ns1", "ns2", "webhook", "webhooks", "auth", "login", "account", "zaina", "bilamatata",
]);

/** Whether codes and links use each business's own address under this main address. */
export function subdomainsOn(publicBaseUrl: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const setting = env.BUSINESS_SUBDOMAINS?.trim().toLowerCase();
  if (setting === "off") return false;
  if (setting === "on") return true;
  if (!publicBaseUrl) return false;
  try {
    const host = new URL(publicBaseUrl).hostname;
    return host !== "localhost" && !isIP(host) && host.includes(".");
  } catch {
    return false;
  }
}

/** Whether a business ID can be an address of its own. */
export function canBeSubdomain(id: string): boolean {
  return BUSINESS_ID.test(id) && !RESERVED_SUBDOMAINS.has(id);
}

const rootOf = (publicBaseUrl: string) => new URL(publicBaseUrl).hostname.toLowerCase();

/** The business a request's host names ("clubxo.bilamatata.com" → "clubxo"), or null. */
export function businessOfHost(host: string, publicBaseUrl: string | null): string | null {
  if (!publicBaseUrl || !host) return null;
  const root = rootOf(publicBaseUrl);
  const name = host.toLowerCase().replace(/\.$/, "");
  if (!name.endsWith(`.${root}`)) return null;
  const label = name.slice(0, -(root.length + 1));
  return !label.includes(".") && canBeSubdomain(label) ? label : null;
}

/** Whether the host is www. or another kept name on the main domain (sent to the main address). */
export function isKeptHost(host: string, publicBaseUrl: string | null): boolean {
  if (!publicBaseUrl || !host) return false;
  const root = rootOf(publicBaseUrl);
  const name = host.toLowerCase().replace(/\.$/, "");
  return name.endsWith(`.${root}`) && RESERVED_SUBDOMAINS.has(name.slice(0, -(root.length + 1)));
}

/** A business's own address: https://clubxo.bilamatata.com (the main address's scheme and port). */
export function businessOrigin(publicBaseUrl: string, id: string): string {
  const url = new URL(publicBaseUrl);
  return `${url.protocol}//${id}.${url.host}`;
}

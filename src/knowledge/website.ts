// src/knowledge/website.ts
//
// Reading a business's website into knowledge: its home page, then the pages
// it links to on the same site (the ones most likely to answer customers
// first: rooms, menu, services, FAQs, policies, contact), up to a limit.
// Only pages robots.txt allows; only HTML; each page's readable text. Pages
// whose text is built by JavaScript are read from what they still publish
// (website-data.ts): their own description and structured data, the
// sitemap, and WordPress, WooCommerce or Shopify content. Every address is
// read through fetchPublic (net/public-fetch.ts).

import { createHash } from "node:crypto";
import type { KnowledgeKind } from "../db/schema.ts";
import { fetchPublic, PublicFetchError, publicUrl } from "../net/public-fetch.ts";
import { htmlToText } from "./import.ts";
import { pageDataText, shopifyProductsPage, sitemapEntries, sitemapsIn, wooProductsPage, wordpressPages, type DataPage } from "./website-data.ts";

export const MAX_WEBSITE_PAGES = 25;
const PAGE_BYTES = 2 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 12_000;
/** A page with less text than this, or only a "turn on JavaScript" notice, has nothing to read without a browser. */
const MIN_TEXT = 30;
const NEEDS_SCRIPT = /(enable|turn on|requires?|needs?)\s+javascript|javascript (is )?(required|disabled|needed)/i;

export type WebsitePage = { url: string; title: string; text: string; description: string | null };
export type WebsiteRead = { site: string; pages: WebsitePage[]; skipped: Array<{ url: string; reason: string }> };

/** Paths worth reading first: what customers ask about. */
const USEFUL = /(about|room|suite|accommodation|stay|rate|price|tariff|menu|food|drink|restaurant|dining|service|treatment|spa|salon|faq|question|polic|terms|cancel|booking|reserv|contact|location|direction|amenit|facilit|gallery|offer|package|event|wedding|conference|check-in|checkin|house-rules|kuhusu|huduma|bei)/i;
/** Paths never worth reading. */
const SKIP_PATH = /(\/wp-admin|\/wp-json|\/wp-login|\/login|\/logout|\/signin|\/sign-in|\/register|\/account|\/my-account|\/cart|\/checkout|\/basket|\/search|\/feed\/?$|\/tag\/|\/author\/|\/page\/\d+|\/cdn-cgi\/|\?replytocom=|\/xmlrpc)/i;
const FILE = /\.(pdf|jpe?g|png|gif|webp|svg|ico|bmp|tiff?|mp[34]|m4a|mov|avi|webm|zip|rar|gz|7z|docx?|xlsx?|pptx?|csv|xml|json|js|css|woff2?|ttf|eot|apk|exe|dmg)$/i;

/** One site: the same host, with or without "www.". */
const siteOf = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** A link's address without its fragment and tracking parameters, for knowing a page was seen. */
export function pageKey(url: URL): string {
  const copy = new URL(url);
  copy.hash = "";
  for (const name of [...copy.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_|ref$|_ga$)/i.test(name)) copy.searchParams.delete(name);
  }
  copy.hostname = siteOf(copy.hostname);
  const path = copy.pathname.replace(/\/+$/, "") || "/";
  return `${copy.hostname}${path}${copy.search}`;
}

/** The links on a page that stay on the site and may be pages. */
export function linksOn(html: string, page: URL): URL[] {
  const links: URL[] = [];
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = (match[1] ?? match[2] ?? match[3] ?? "").trim().replace(/&amp;/g, "&");
    if (!href || /^(mailto:|tel:|javascript:|data:|#|sms:|whatsapp:)/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, page);
    } catch {
      continue;
    }
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:" || siteOf(url.hostname) !== siteOf(page.hostname)) continue;
    if (FILE.test(url.pathname) || SKIP_PATH.test(url.pathname + url.search)) continue;
    url.hash = "";
    links.push(url);
  }
  return links;
}

/** The paths robots.txt keeps every robot (and ours) away from. */
export function disallowedPaths(robots: string): string[] {
  const groups: Array<{ agents: string[]; rules: string[] }> = [];
  let current: { agents: string[]; rules: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "disallow" && current && value) current.rules.push(value);
  }
  const ours = groups.filter((group) => group.agents.some((agent) => agent.startsWith("zainabot")));
  const chosen = ours.length ? ours : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.rules);
}

export function allowedBy(rules: string[], url: URL): boolean {
  const path = url.pathname + url.search;
  return !rules.some((rule) => {
    const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pattern.endsWith("\\$") ? `${pattern.slice(0, -2)}$` : pattern}`).test(path);
  });
}

/** The page's own description, if it gives one (a suggestion for the business's "about"). */
function descriptionOf(html: string): string | null {
  const tag = /<meta\b[^>]*\b(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*>/i.exec(html)?.[0];
  const content = tag ? /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag) : null;
  const text = (content?.[1] ?? content?.[2] ?? "").replace(/\s+/g, " ").trim();
  return text ? htmlToText(`<p>${text}</p>`).text.slice(0, 600) : null;
}

/** Most useful first: what customers ask about, then shorter addresses. */
function score(url: URL): number {
  const path = decodeURIComponent(url.pathname).toLowerCase();
  return (USEFUL.test(path) ? 0 : 100) + path.split("/").filter(Boolean).length * 10 + path.length / 10;
}

/**
 * Reads a website: the page at `start`, then pages it links to on the same
 * site, most useful first, until `maxPages` have text or time runs out.
 */
export async function readWebsite(start: string, options: { maxPages?: number; timeBudgetMs?: number } = {}): Promise<WebsiteRead> {
  const maxPages = Math.min(Math.max(options.maxPages ?? 10, 1), MAX_WEBSITE_PAGES);
  const deadline = Date.now() + (options.timeBudgetMs ?? 45_000);
  const first = publicUrl(start);
  const pages: WebsitePage[] = [];
  const skipped: WebsiteRead["skipped"] = [];
  const seen = new Set<string>();
  const texts = new Set<string>();

  let rules: string[] = [];
  let sitemaps: string[] = [];
  try {
    const robots = await fetchPublic(new URL("/robots.txt", first), { accept: "text/plain", maxBytes: 256 * 1024, timeoutMs: 8_000 });
    if (robots.status === 200 && !robots.contentType.includes("html")) {
      rules = disallowedPaths(robots.body.toString("utf8"));
      sitemaps = sitemapsIn(robots.body.toString("utf8"));
    }
  } catch {
    // No robots.txt, or it can't be read: nothing is off limits.
  }
  // Pages built by JavaScript, and whether the sitemap was read for pages the links didn't show.
  let builtByScript = 0;
  let sitemapRead = false;
  const keep = (page: WebsitePage) => {
    const fingerprint = createHash("sha256").update(page.text).digest("hex");
    if (texts.has(fingerprint)) return false;
    texts.add(fingerprint);
    pages.push(page);
    return true;
  };

  let site = siteOf(first.hostname);
  let queue: URL[] = [first];
  seen.add(pageKey(first));
  while (pages.length < maxPages && Date.now() < deadline) {
    if (!queue.length) {
      // Links built by script aren't in the page: the sitemap lists the pages instead.
      if (sitemapRead) break;
      sitemapRead = true;
      queue = (await sitemapPages(first, site, sitemaps, rules, deadline)).filter((link) => {
        const key = pageKey(link);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => score(a) - score(b));
      if (!queue.length) break;
    }
    const url = queue.shift()!;
    if (!allowedBy(rules, url)) {
      skipped.push({ url: url.toString(), reason: "robots.txt asks robots not to read it" });
      continue;
    }
    let response;
    try {
      response = await fetchPublic(url, { accept: "text/html,application/xhtml+xml", maxBytes: PAGE_BYTES, timeoutMs: Math.min(PAGE_TIMEOUT_MS, Math.max(1_000, deadline - Date.now())) });
    } catch (error) {
      if (pages.length === 0 && url === first) throw error;
      skipped.push({ url: url.toString(), reason: error instanceof PublicFetchError ? error.message : "It couldn't be read." });
      continue;
    }
    // The home page may redirect to another name for the same site ("www.", a new domain).
    if (url === first) site = siteOf(response.url.hostname);
    if (siteOf(response.url.hostname) !== site) {
      skipped.push({ url: url.toString(), reason: "It leads to another website." });
      continue;
    }
    seen.add(pageKey(response.url));
    if (response.status !== 200) {
      if (pages.length === 0 && url === first) throw new PublicFetchError(`The website answered ${response.status}.`);
      skipped.push({ url: url.toString(), reason: `The website answered ${response.status}.` });
      continue;
    }
    if (!/text\/html|application\/xhtml/.test(response.contentType)) {
      skipped.push({ url: url.toString(), reason: "It isn't a web page." });
      continue;
    }
    const html = response.body.toString("utf8");
    const { title, text } = htmlToText(html);
    const page = { url: response.url.toString(), title: (title ?? "").trim() || response.url.pathname, description: descriptionOf(html) };
    if (text.length < MIN_TEXT || (text.length < 400 && NEEDS_SCRIPT.test(text))) {
      // Built by JavaScript: what the page still says about itself, if it says enough.
      builtByScript += 1;
      const data = pageDataText(html);
      if (data.length < MIN_TEXT) skipped.push({ url: page.url, reason: "Its text is built by JavaScript, so there's nothing to read here." });
      else if (!keep({ ...page, text: data })) skipped.push({ url: page.url, reason: "The same text as another page." });
    } else if (!keep({ ...page, text })) {
      skipped.push({ url: page.url, reason: "The same text as another page." });
    }
    const next = linksOn(html, response.url).filter((link) => {
      const key = pageKey(link);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    queue = [...queue, ...next].sort((a, b) => score(a) - score(b));
  }
  // A site built by JavaScript often publishes its content another way: WordPress, WooCommerce, Shopify.
  if (builtByScript > 0 && pages.length < maxPages && Date.now() < deadline) {
    for (const extra of await contentFeeds(first, site, rules, deadline)) {
      if (pages.length >= maxPages) break;
      keep({ ...extra, description: null });
    }
  }
  if (!pages.length) {
    throw new PublicFetchError(builtByScript
      ? "Your website builds its pages with JavaScript, so Zaina can't read it from here. You can still put the chat on it (Settings → Website widget), and teach Zaina by describing how you work (Settings → What you offer), adding a document, or uploading a brochure or price list."
      : skipped[0]?.reason ?? "No page on the website had text to read.");
  }
  return { site, pages, skipped };
}

const fetchOptions = (accept: string, deadline: number) => ({ accept, maxBytes: PAGE_BYTES, timeoutMs: Math.min(8_000, Math.max(1_000, deadline - Date.now())) });

/** Pages a site's sitemaps list (robots.txt's, or the usual addresses), on the same site. */
async function sitemapPages(first: URL, site: string, named: string[], rules: string[], deadline: number): Promise<URL[]> {
  const queue = named.length ? [...named] : ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"].map((path) => new URL(path, first).toString());
  const found: URL[] = [];
  for (let read = 0; queue.length && read < 6 && found.length < 200 && Date.now() < deadline; read += 1) {
    let address: URL;
    try {
      address = new URL(queue.shift()!);
    } catch {
      continue;
    }
    if (siteOf(address.hostname) !== site || !allowedBy(rules, address)) continue;
    try {
      const response = await fetchPublic(address, fetchOptions("application/xml,text/xml", deadline));
      if (response.status !== 200) continue;
      const entries = sitemapEntries(response.body.toString("utf8"));
      queue.push(...entries.sitemaps);
      for (const loc of entries.pages) {
        try {
          const url = new URL(loc);
          if (url.protocol === "http:") url.protocol = "https:";
          if (url.protocol === "https:" && siteOf(url.hostname) === site && !FILE.test(url.pathname) && !SKIP_PATH.test(url.pathname + url.search)) found.push(url);
        } catch {
          // Not an address.
        }
      }
      // An index found its sitemaps; a sitemap of pages is enough.
      if (entries.pages.length) break;
    } catch {
      // No sitemap there.
    }
  }
  return found.slice(0, 200);
}

/** A site's content from WordPress, WooCommerce or Shopify, where it publishes it. */
async function contentFeeds(first: URL, site: string, rules: string[], deadline: number): Promise<DataPage[]> {
  const read = async (path: string): Promise<unknown> => {
    const url = new URL(path, first);
    if (!allowedBy(rules, url) || Date.now() >= deadline) return null;
    try {
      const response = await fetchPublic(url, fetchOptions("application/json", deadline));
      return response.status === 200 && response.contentType.includes("json") ? JSON.parse(response.body.toString("utf8")) : null;
    } catch {
      return null;
    }
  };
  const found: DataPage[] = [];
  const wordpress = wordpressPages(await read("/wp-json/wp/v2/pages?per_page=50&_fields=link,title,content"));
  found.push(...wordpress.filter((page) => {
    try {
      return siteOf(new URL(page.url).hostname) === site;
    } catch {
      return false;
    }
  }));
  const woo = wooProductsPage(await read("/wp-json/wc/store/v1/products?per_page=100"), site);
  if (woo) found.push(woo);
  if (!wordpress.length && !woo) {
    const shopify = shopifyProductsPage(await read("/products.json?limit=100"), site);
    if (shopify) found.push(shopify);
  }
  return found;
}

/**
 * Titles for the pages' knowledge sources: the page's title, told apart by
 * its address when two pages share one (every page titled "Coral Cove").
 */
export function pageTitles(pages: WebsitePage[]): string[] {
  const counts = new Map<string, number>();
  for (const page of pages) counts.set(page.title, (counts.get(page.title) ?? 0) + 1);
  const used = new Set<string>();
  return pages.map((page) => {
    const path = decodeURIComponent(new URL(page.url).pathname).replace(/\/+$/, "") || "/";
    let title = (counts.get(page.title) ?? 0) > 1 ? `${page.title} (${path === "/" ? "home" : path})` : page.title;
    title = title.slice(0, 200);
    for (let n = 2; used.has(title); n += 1) title = `${title.slice(0, 190)} (${n})`;
    used.add(title);
    return title;
  });
}

/** What kind of knowledge a page probably is, from its address and title. */
export function kindOfPage(page: Pick<WebsitePage, "url" | "title">): KnowledgeKind {
  const words = `${decodeURIComponent(new URL(page.url).pathname).replace(/[/_-]+/g, " ")} ${page.title}`.toLowerCase();
  if (/\b(menu|menus|food|drinks|wine list)\b/.test(words)) return "menu";
  if (/\b(faq|faqs|questions)\b/.test(words)) return "faq";
  if (/\b(polic(y|ies)|terms|conditions|cancellation|house rules|privacy)\b/.test(words)) return "policy";
  return "page";
}

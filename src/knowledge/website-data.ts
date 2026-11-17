// src/knowledge/website-data.ts
//
// What a website says when its pages are built in the visitor's browser
// (JavaScript), so the page itself has no text to read:
//
//   on the page   its title and description, the structured data search
//                 engines read (schema.org JSON-LD: the business, its
//                 address and hours, products, FAQs), and its <noscript> text
//   sitemaps      the list of its pages, when its links are built by script
//   WordPress     its pages, through the WordPress REST API
//   WooCommerce   its products, through the public Store API
//   Shopify       its products, through /products.json
//
// Prices are left out: Zaina quotes prices only from the business's own
// rooms, services and price list.

import { htmlToText } from "./import.ts";

const clean = (value: unknown, max = 1000) => (typeof value === "string" ? htmlToText(`<p>${value}</p>`).text.replace(/\s+/g, " ").trim().slice(0, max) : "");

function metaContent(html: string, names: string[]): string {
  for (const name of names) {
    const tag = new RegExp(`<meta\\b[^>]*\\b(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, "i").exec(html)?.[0];
    const content = tag ? /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag) : null;
    const text = clean(content?.[1] ?? content?.[2] ?? "");
    if (text) return text;
  }
  return "";
}

/** The readable parts of schema.org data: names, descriptions, address, hours, questions and answers. Never prices. */
export function structuredDataText(html: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (line: string) => {
    const text = line.trim();
    if (text && !seen.has(text) && lines.length < 200) {
      seen.add(text);
      lines.push(text);
    }
  };
  const walk = (node: unknown, depth: number) => {
    if (depth > 8 || !node) return;
    if (Array.isArray(node)) {
      for (const entry of node.slice(0, 100)) walk(entry, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    const type = String(Array.isArray(item["@type"]) ? item["@type"][0] : item["@type"] ?? "");
    if (type === "Question") {
      const answer = item.acceptedAnswer as Record<string, unknown> | undefined;
      const question = clean(item.name, 300);
      const text = clean(answer?.text);
      if (question && text) add(`### ${question}\n\n${text}`);
      return;
    }
    const name = clean(item.name, 200);
    const description = clean(item.description);
    if (name && description) add(`## ${name}\n\n${description}`);
    else if (description) add(description);
    else if (name && /Product|Service|Offer|MenuItem|Room|Hotel|Restaurant|Store|LocalBusiness|Organization/.test(type)) add(`- ${name}`);
    const address = item.address as Record<string, unknown> | string | undefined;
    if (typeof address === "string") add(`Address: ${clean(address, 300)}`);
    else if (address && typeof address === "object") {
      const parts = ["streetAddress", "addressLocality", "addressRegion", "addressCountry"].map((key) => clean(address[key], 120)).filter(Boolean);
      if (parts.length) add(`Address: ${parts.join(", ")}`);
    }
    const hours = item.openingHours;
    if (typeof hours === "string" || Array.isArray(hours)) add(`Opening hours: ${[hours].flat().map((entry) => clean(entry, 80)).filter(Boolean).join("; ")}`);
    for (const key of ["slogan", "servesCuisine", "areaServed"]) {
      const value = item[key];
      if (typeof value === "string" && clean(value)) add(`${key === "servesCuisine" ? "Cuisine" : key === "areaServed" ? "Area served" : "Slogan"}: ${clean(value, 300)}`);
    }
    for (const [key, value] of Object.entries(item)) {
      // Prices and offers' amounts are never read; the rest of the tree is.
      if (/^(@(?!graph$)|offers$|price|priceRange|priceSpecification|aggregateRating|review|image|logo|url|sameAs|potentialAction)/.test(key)) continue;
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(match[1].trim()), 0);
    } catch {
      // Broken structured data: skipped.
    }
  }
  return lines.join("\n\n");
}

/** A page's own words when its text needs JavaScript: title, description, structured data and <noscript> text. */
export function pageDataText(html: string): string {
  const title = metaContent(html, ["og:title", "twitter:title"]) || clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "", 200);
  const description = metaContent(html, ["description", "og:description", "twitter:description"]);
  const noscript = [...html.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi)]
    .map((match) => htmlToText(`<body>${match[1]}</body>`).text)
    .filter((text) => text.length > 40 && !/(enable|turn on|requires?|needs?)\s+javascript/i.test(text))
    .join("\n\n");
  const structured = structuredDataText(html);
  const text = [title ? `# ${title}` : "", description, structured, noscript].filter(Boolean).join("\n\n");
  // Only a title and a one-line description isn't a page worth keeping.
  return structured || noscript || text.length >= 120 ? text : "";
}

/** Page addresses in a sitemap, and the sitemaps a sitemap index lists. */
export function sitemapEntries(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => match[1].replace(/&amp;/g, "&")).slice(0, 2000);
  return /<sitemapindex\b/i.test(xml) ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}

/** The sitemaps robots.txt names. */
export function sitemapsIn(robots: string): string[] {
  return [...robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((match) => match[1]).slice(0, 10);
}

export type DataPage = { url: string; title: string; text: string };

/** WordPress pages (wp/v2/pages) as pages to keep. */
export function wordpressPages(json: unknown): DataPage[] {
  if (!Array.isArray(json)) return [];
  return json.slice(0, 50).flatMap((entry: any) => {
    const url = typeof entry?.link === "string" ? entry.link : "";
    const title = clean(entry?.title?.rendered, 200);
    const text = typeof entry?.content?.rendered === "string" ? htmlToText(`<body>${entry.content.rendered}</body>`).text : "";
    return url && text.length >= 30 ? [{ url, title: title || url, text }] : [];
  });
}

/** WooCommerce products (Store API) as one page: names, categories and descriptions. */
export function wooProductsPage(json: unknown, site: string): DataPage | null {
  if (!Array.isArray(json) || !json.length) return null;
  const lines = json.slice(0, 100).map((product: any) => {
    const name = clean(product?.name, 200);
    const categories = Array.isArray(product?.categories) ? product.categories.map((category: any) => clean(category?.name, 60)).filter(Boolean).join(", ") : "";
    const about = clean(product?.short_description || product?.description, 500);
    return name ? `## ${name}${categories ? ` (${categories})` : ""}${about ? `\n\n${about}` : ""}` : "";
  }).filter(Boolean);
  return lines.length ? { url: `https://${site}/shop`, title: "Products", text: `# Products\n\n${lines.join("\n\n")}` } : null;
}

/** Shopify products (/products.json) as one page. */
export function shopifyProductsPage(json: unknown, site: string): DataPage | null {
  const products = (json as { products?: unknown })?.products;
  if (!Array.isArray(products) || !products.length) return null;
  const lines = products.slice(0, 100).map((product: any) => {
    const name = clean(product?.title, 200);
    const kind = clean(product?.product_type, 60);
    const about = clean(product?.body_html, 500);
    return name ? `## ${name}${kind ? ` (${kind})` : ""}${about ? `\n\n${about}` : ""}` : "";
  }).filter(Boolean);
  return lines.length ? { url: `https://${site}/collections/all`, title: "Products", text: `# Products\n\n${lines.join("\n\n")}` } : null;
}

// src/knowledge/website-import.ts
//
// Reading a business's website into its knowledge (a source per page that
// has text), from the dashboard or on the weekly re-read. A page never
// replaces a source the team wrote with the same title: it takes a title of
// its own. Pages already read are updated in place (same title and address).

import type { BusinessSettings } from "../db/schema.ts";
import { everyBusiness } from "../businesses/registry.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import { listKnowledgeSources, MAX_KNOWLEDGE_CHARS, saveKnowledgeSource, validateKnowledgeInput, type SaveResult } from "./store.ts";
import { kindOfPage, pageTitles, readWebsite } from "./website.ts";

export type ImportResult = { site: string; pages: Array<{ url: string; saved: SaveResult }>; skipped: Array<{ url: string; reason: string }>; description: string | null };

export async function importWebsite(businessId: string, address: string, options: { maxPages: number; status: "published" | "draft"; userId: string | null }): Promise<ImportResult> {
  const read = await readWebsite(address, { maxPages: options.maxPages });
  const existing = new Map((await listKnowledgeSources(businessId)).map((source) => [source.title, source.url]));
  const titles = pageTitles(read.pages).map((title, index) => {
    const url = read.pages[index].url;
    if (!existing.has(title) || existing.get(title) === url) return title;
    let own = `${title.slice(0, 185)} (website)`;
    for (let n = 2; existing.has(own) && existing.get(own) !== url; n += 1) own = `${title.slice(0, 180)} (website ${n})`;
    return own;
  });
  const pages: ImportResult["pages"] = [];
  for (const [index, page] of read.pages.entries()) {
    const checked = validateKnowledgeInput({ title: titles[index], kind: kindOfPage(page), url: page.url, content: page.text.slice(0, MAX_KNOWLEDGE_CHARS), status: options.status });
    if (!checked.ok) {
      read.skipped.push({ url: page.url, reason: checked.error });
      continue;
    }
    pages.push({ url: page.url, saved: (await saveKnowledgeSource(businessId, checked.value, options.userId))! });
  }
  return { site: read.site, pages, skipped: read.skipped, description: read.pages[0]?.description ?? null };
}

/** How long between weekly re-reads (shorter in tests). */
const PERIOD_MS = Number(process.env.WEBSITE_SYNC_PERIOD_MS ?? "") || 7 * 24 * 60 * 60 * 1000;

export const syncDue = (sync: BusinessSettings["websiteSync"], now: Date) =>
  Boolean(sync?.weekly && sync.url && (!sync.lastReadAt || now.getTime() - new Date(sync.lastReadAt).getTime() >= PERIOD_MS));

/** Re-reads the websites that are due (one business at a time; a failure is noted, never thrown). */
export async function syncWebsites(now = new Date()): Promise<number> {
  let read = 0;
  for (const business of await everyBusiness()) {
    if (business.status === "paused") continue;
    const settings = await getBusinessSettings(business.id);
    const sync = settings?.websiteSync;
    if (!sync || !syncDue(sync, now)) continue;
    try {
      const result = await importWebsite(business.id, sync.url, { maxPages: sync.maxPages, status: "published", userId: null });
      await updateBusinessSettings(business.id, { websiteSync: { ...sync, lastReadAt: now.toISOString(), lastPages: result.pages.length, lastSkipped: result.skipped.length, lastError: null } }, null);
      read += 1;
    } catch (error) {
      console.error(`[website-sync] ${business.id}:`, error);
      await updateBusinessSettings(business.id, { websiteSync: { ...sync, lastReadAt: now.toISOString(), lastError: error instanceof Error ? error.message.slice(0, 200) : "The website couldn't be read." } }, null).catch(() => {});
    }
  }
  return read;
}

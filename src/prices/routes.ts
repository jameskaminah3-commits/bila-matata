// src/prices/routes.ts
//
// A business's price list, for its staff (least role needed):
//
//   GET    /v1/staff/businesses/:businessId/price-list        viewer   every item, shown or hidden
//   POST   …/price-list { name, price, section?, description?, price_max?, currency?, unit?, status?, sort_order? }
//                                                             manager  add one
//   PATCH  …/price-list/:itemId { … }                         manager  change one
//   DELETE …/price-list/:itemId                               manager  remove one
//   PUT    …/price-list/order { ids: [ … ] }                  manager  the menu's order: sections and items
//                                                                      as the team arranged them
//   GET    …/price-list/assistant                             manager  what the menu assistant might be asked first
//   POST   …/price-list/assistant { text }                    manager  the changes, before → after (nothing is saved)
//   POST   …/price-list/assistant/apply { changes: [ … ] }    manager  apply them; returns how to undo them
//   POST   …/price-list/parse { text, currency? }             manager  a pasted list read into items and
//                                                                      problems, to check (nothing is saved)
//   POST   …/price-list/import { items: [ … ], replace? }     manager  many at once: an item with the same
//                                                                      section and name gets the new price;
//                                                                      replace makes the list exactly these
//   GET    …/price-list/feed                                  viewer   the business's own product feed, and its last reading
//   PUT    …/price-list/feed { url, daily? }                  manager  read it now (and every day): its products join the list
//   POST   …/price-list/feed/sync                             manager  read it again now
//   DELETE …/price-list/feed                                  manager  stop: its products leave the list
//
//   POST   …/price-list/read-photo?currency= (a photo as the body) manager  a photo of the price list read into
//                                                                      items and problems to check (nothing is saved)
//   PUT    …/price-list/:itemId/picture (the photo as the body) manager  its picture, kept in the database
//   DELETE …/price-list/:itemId/picture                       manager  remove it
//   GET    /catalogue/:business/:itemId                       public   the picture, for the link Zaina sends
//
// Items also say whether they're in stock (available), may link to their page (url), and
// have a picture (picture_url: uploaded here, or image_url from the business's own feed).
// Prices are sent and shown in major units ("3500" is KSh 3,500).

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import type { CatalogueFeed } from "../db/schema.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { refreshFeed } from "./feed.ts";
import { checkItemPicture, ITEM_PICTURE_MAX_BYTES, readItemPicture, removeItemPicture, saveItemPicture } from "./images.ts";
import { readSectionPicture, removeSectionPicture, saveSectionPicture, sectionPictureUrls } from "./section-images.ts";
import { sniffImage } from "../brand/assets.ts";
import { refusedThinking, thinkingConfigFor, type EngineOptions } from "../engine/agent.ts";
import { rateLimited } from "../gateway/rate-limit.ts";
import { applyChanges, ASSISTANT_MAX_CHARS, assistantIdeas, assistantInstructions, editableItems, MAX_CHANGES, MENU_ASSISTANT_SCHEMA, previewChanges, readChange, resolveModelChanges } from "./assistant.ts";
import {
  createPriceItem,
  deletePriceItem,
  orderPriceItems,
  getPriceItem,
  importPriceItems,
  listPriceItems,
  MAX_PRICE_ITEMS,
  parsePriceList,
  PriceListFull,
  publicPriceItem,
  updatePriceItem,
  syncFeedItems,
  validatePriceItem,
  type PriceItemValues,
} from "./price-list.ts";

const feedView = (feed: CatalogueFeed | null) => feed && {
  url: feed.url, daily: feed.daily, last_read_at: feed.lastReadAt, last_items: feed.lastItems, last_skipped: feed.lastSkipped, last_error: feed.lastError,
};

/** Reading a feed costs a fetch: twenty an hour per business. */
async function feedAllowance(res: Response, businessId: string): Promise<boolean> {
  const verdict = await consumeLimits([{ key: `catalogue-feed:business:${businessId}`, limit: 20, windowSeconds: 3600 }]);
  if (verdict.allowed) return true;
  res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
  res.status(429).json({ error: "rate_limited", message: "The feed was read many times this hour. Please try again later." });
  return false;
}

/** Price-list routes take bigger bodies than the rest of the API (a pasted list). */
export const PRICE_LIST_PATH = /^\/v1\/staff\/businesses\/[^/]+\/price-list(?:\/|$)/;
const priceListBody = express.json({ limit: "300kb" });

const nameTaken = { error: "name_taken", message: "The list already has an item with that name in that section." };

/** What the model is asked about a photo of a price list: the lines as written, for parsePriceList to read. */
const PHOTO_INSTRUCTIONS =
  "This is a photo of a business's price list: a board, a menu, a page or a handwritten list. " +
  "Write out every item and its price exactly as written, one per line, like \"Sukuma wiki — 20 per bunch\". " +
  "Put a section's heading on a line of its own. Copy names and prices only; never guess a price you can't read. " +
  "Write nothing else. If there's no price list in the photo, write NONE.";

export function registerPriceListRoutes(app: Express, secret: string, engine?: EngineOptions): void {
  const staff = requireStaff(secret);
  const base = "/v1/staff/businesses/:businessId/price-list";
  const handle = (fn: (req: Request, res: Response, businessId: string, userId: string) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { business, user } = staffOf(req);
        await fn(req, res, business!.id, user.id);
      } catch (error) {
        next(error);
      }
    };

  // ── Pictures (images.ts) ──
  // Public: a customer opens the link Zaina sends. Its address carries the photo's fingerprint.
  app.get("/catalogue/:business/:itemId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = String(req.params.business);
      if (!/^[a-z][a-z0-9-]{1,39}$/.test(business)) return res.status(404).type("text/plain").send("Not found");
      const picture = await readItemPicture(business, String(req.params.itemId));
      if (!picture) return res.status(404).type("text/plain").send("Not found");
      const tag = `"${picture.sha256.slice(0, 32)}"`;
      const pinned = typeof req.query.v === "string" && req.query.v.length >= 8 && picture.sha256.startsWith(req.query.v);
      res.setHeader("Cache-Control", pinned ? "public, max-age=31536000, immutable" : "public, max-age=300");
      res.setHeader("ETag", tag);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      // The chat on the business's own website shows it.
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      if (req.header("if-none-match") === tag) return res.status(304).end();
      res.type(picture.contentType).send(picture.bytes);
    } catch (error) {
      next(error);
    }
  });

  const picture = express.raw({ type: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"], limit: ITEM_PICTURE_MAX_BYTES + 1024 });
  app.put(`${base}/:itemId/picture`, staff, requireBusinessRole("manager"), picture, handle(async (req, res, businessId, userId) => {
    const checked = checkItemPicture(req.body);
    if (!checked.ok) return res.status(400).json({ error: "invalid_picture", message: checked.message });
    if (!(await saveItemPicture(businessId, String(req.params.itemId), checked, userId))) return res.status(404).json({ error: "not_found" });
    const item = await getPriceItem(businessId, String(req.params.itemId));
    res.json({ item: item && publicPriceItem(item) });
  }));

  // A section's banner picture (src/prices/section-images.ts), by the section's name: ?section=Whisky.
  const sections = "/v1/staff/businesses/:businessId/catalogue-sections";
  const sectionOf = (req: Request) => (typeof req.query.section === "string" ? req.query.section.trim().replace(/\s+/g, " ") : "");
  app.get(sections, staff, requireBusinessRole("viewer"), handle(async (_req, res, businessId) => {
    res.json({ pictures: Object.fromEntries(await sectionPictureUrls(businessId)) });
  }));
  app.put(`${sections}/picture`, staff, requireBusinessRole("manager"), picture, handle(async (req, res, businessId, userId) => {
    const section = sectionOf(req);
    if (!section || section.length > 80) return res.status(400).json({ error: "section_required", message: "Say which section the picture is for." });
    const checked = checkItemPicture(req.body);
    if (!checked.ok) return res.status(400).json({ error: "invalid_picture", message: checked.message });
    await saveSectionPicture(businessId, section, checked, userId);
    res.json({ pictures: Object.fromEntries(await sectionPictureUrls(businessId)) });
  }));
  app.delete(`${sections}/picture`, staff, requireBusinessRole("manager"), handle(async (req, res, businessId) => {
    const section = sectionOf(req);
    if (!section) return res.status(400).json({ error: "section_required", message: "Say which section." });
    await removeSectionPicture(businessId, section);
    res.json({ pictures: Object.fromEntries(await sectionPictureUrls(businessId)) });
  }));
  // The banner itself, public like the items' pictures, cached for good once its fingerprint is in the address.
  app.get("/catalogue/:business/sections/:key", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = String(req.params.business);
      if (!/^[a-z][a-z0-9-]{1,39}$/.test(business)) return res.status(404).type("text/plain").send("Not found");
      const banner = await readSectionPicture(business, String(req.params.key));
      if (!banner) return res.status(404).type("text/plain").send("Not found");
      const tag = `"${banner.sha256.slice(0, 32)}"`;
      const pinned = typeof req.query.v === "string" && req.query.v.length >= 8 && banner.sha256.startsWith(req.query.v);
      res.setHeader("Cache-Control", pinned ? "public, max-age=31536000, immutable" : "public, max-age=300");
      res.setHeader("ETag", tag);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      if (req.header("if-none-match") === tag) return res.status(304).end();
      res.type(banner.contentType).send(banner.bytes);
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${base}/:itemId/picture`, staff, requireBusinessRole("manager"), handle(async (req, res, businessId) => {
    await removeItemPicture(businessId, String(req.params.itemId));
    const item = await getPriceItem(businessId, String(req.params.itemId));
    if (!item) return res.status(404).json({ error: "not_found" });
    res.json({ item: publicPriceItem(item) });
  }));

  // ── The business's own product feed (feed.ts) ──
  app.get(`${base}/feed`, staff, requireBusinessRole("viewer"), handle(async (_req, res, businessId) => {
    res.json({ feed: feedView((await getBusinessSettings(businessId))?.catalogueFeed ?? null) });
  }));

  app.put(`${base}/feed`, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res, businessId, userId) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!url || url.length > 500) return res.status(400).json({ error: "url_required", message: "The address of your products' data, please." });
    const daily = req.body?.daily !== false;
    if (!(await feedAllowance(res, businessId))) return;
    const result = await refreshFeed(businessId, { url, daily }, userId);
    if (!result.ok) return res.status(400).json({ error: "feed_unreadable", message: `The feed couldn't be read: ${result.message}`, feed: feedView(result.feed) });
    res.json({ feed: feedView(result.feed), sample: result.sample, items: (await listPriceItems(businessId)).map(publicPriceItem) });
  }));

  app.post(`${base}/feed/sync`, staff, requireBusinessRole("manager"), handle(async (_req, res, businessId, userId) => {
    const feed = (await getBusinessSettings(businessId))?.catalogueFeed;
    if (!feed) return res.status(404).json({ error: "no_feed", message: "There's no feed to read: add its address first." });
    if (!(await feedAllowance(res, businessId))) return;
    const result = await refreshFeed(businessId, feed, userId);
    if (!result.ok) return res.status(400).json({ error: "feed_unreadable", message: `The feed couldn't be read: ${result.message}`, feed: feedView(result.feed) });
    res.json({ feed: feedView(result.feed), sample: result.sample, items: (await listPriceItems(businessId)).map(publicPriceItem) });
  }));

  // Stops reading it; its items leave the catalogue (what the team typed stays).
  app.delete(`${base}/feed`, staff, requireBusinessRole("manager"), handle(async (_req, res, businessId, userId) => {
    await syncFeedItems(businessId, []);
    await updateBusinessSettings(businessId, { catalogueFeed: null }, userId);
    res.json({ feed: null, items: (await listPriceItems(businessId)).map(publicPriceItem) });
  }));

  app.get(base, staff, requireBusinessRole("viewer"), handle(async (_req, res, businessId) => {
    res.json({ items: (await listPriceItems(businessId)).map(publicPriceItem) });
  }));

  app.post(base, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res, businessId, userId) => {
    const checked = validatePriceItem(req.body ?? {});
    if (!checked.ok) return res.status(400).json({ error: "invalid_item", message: checked.error });
    const created = await createPriceItem(businessId, checked.value, userId);
    if (created === "name_taken") return res.status(409).json(nameTaken);
    if (created === "too_many") return res.status(409).json({ error: "too_many", message: `A price list has at most ${MAX_PRICE_ITEMS} items.` });
    res.status(201).json({ item: publicPriceItem(created) });
  }));

  app.post(`${base}/parse`, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) return res.status(400).json({ error: "text_required", message: "Paste your price list, an item per line." });
    if (text.length > 100_000) return res.status(413).json({ error: "too_long", message: "That list is too long: paste it in parts." });
    const currency = req.body?.currency === "USD" ? "USD" : "KES";
    res.json(parsePriceList(text, currency));
  }));

  // A photo of the price list (a board, a menu, a handwritten page): read by the model into lines, checked like a pasted list. Nothing is saved.
  const photoBody = express.raw({ type: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"], limit: 4 * 1024 * 1024 });
  app.post(`${base}/read-photo`, staff, requireBusinessRole("manager"), photoBody, handle(async (req, res, businessId) => {
    if (!engine) return res.status(503).json({ error: "not_available", message: "Reading photos isn't available here." });
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const contentType = bytes.length ? sniffImage(bytes) : null;
    if (!contentType) return res.status(400).json({ error: "invalid_picture", message: "Choose a photo of your price list (a PNG, JPEG or WebP picture)." });
    const verdict = await consumeLimits([{ key: `price-photo:business:${businessId}`, limit: 20, windowSeconds: 3600 }]);
    if (!verdict.allowed) {
      res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
      return res.status(429).json({ error: "rate_limited", message: "Many photos were read this hour. Please try again later." });
    }
    let text = "";
    try {
      const response = await engine.ai.models.generateContent({
        model: engine.model,
        contents: [{ role: "user", parts: [{ text: PHOTO_INSTRUCTIONS }, { inlineData: { mimeType: contentType, data: bytes.toString("base64") } }] }],
        config: { temperature: 0, abortSignal: AbortSignal.timeout(45_000) },
      });
      text = (response.text ?? "").trim();
    } catch (error) {
      console.error(`[prices] reading a photo for ${businessId} failed:`, error instanceof Error ? error.message : error);
      return res.status(502).json({ error: "not_read", message: "The photo couldn't be read just now. Try again in a minute, or type the prices." });
    }
    const currency = req.query.currency === "USD" ? "USD" : "KES";
    const parsed = /^NONE\b/i.test(text) ? { items: [], problems: [] } : parsePriceList(text.slice(0, 100_000), currency);
    res.json({ ...parsed, read_text: text.slice(0, 5000) });
  }));

  app.post(`${base}/import`, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res, businessId, userId) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || items.length === 0) return res.status(400).json({ error: "items_required", message: "No items to add." });
    if (items.length > MAX_PRICE_ITEMS) return res.status(400).json({ error: "too_many", message: `At most ${MAX_PRICE_ITEMS} items at once.` });
    const values: PriceItemValues[] = [];
    for (const [index, item] of items.entries()) {
      const checked = validatePriceItem(item && typeof item === "object" ? item : {});
      if (!checked.ok) return res.status(400).json({ error: "invalid_item", message: `Item ${index + 1}: ${checked.error}` });
      values.push(checked.value);
    }
    const keys = values.map((value) => `${(value.section ?? "").toLowerCase()}\u0000${value.name.toLowerCase()}`);
    if (new Set(keys).size !== keys.length) return res.status(400).json({ error: "duplicate_items", message: "Two items have the same name in the same section." });
    try {
      const counts = await importPriceItems(businessId, values, { replace: req.body?.replace === true, userId });
      res.json({ ...counts, items: (await listPriceItems(businessId)).map(publicPriceItem) });
    } catch (error) {
      if (error instanceof PriceListFull) return res.status(409).json({ error: "too_many", message: error.message });
      throw error;
    }
  }));

  // ── The menu assistant (assistant.ts): plain words in, exact changes out, applied only when the team says so ──
  // Each request is a model call: plenty for running a menu, not a tap on repeat.
  const assistantLimit = rateLimited(secret, "menu-assistant", 60, 3600, (req) => String(req.params.businessId));
  app.get(`${base}/assistant`, staff, requireBusinessRole("manager"), handle(async (_req, res, businessId) => {
    res.json({ available: Boolean(engine), ideas: assistantIdeas(await listPriceItems(businessId)) });
  }));

  app.post(`${base}/assistant`, priceListBody, staff, requireBusinessRole("manager"), assistantLimit, handle(async (req, res, businessId) => {
    if (!engine) return res.status(503).json({ error: "not_available", message: "The menu assistant isn't available here." });
    const ask = typeof req.body?.text === "string" ? req.body.text.replace(/\s+/g, " ").trim() : "";
    const answering = Boolean(req.body?.earlier?.request && req.body?.earlier?.question);
    if (ask.length < (answering ? 1 : 3)) return res.status(400).json({ error: "text_required", message: "Say what to change, like \"Raise the cocktails by 10%\"." });
    if (ask.length > ASSISTANT_MAX_CHARS) return res.status(400).json({ error: "text_too_long", message: `Keep it under ${ASSISTANT_MAX_CHARS} characters, one change or a few at a time.` });
    const items = editableItems(await listPriceItems(businessId));
    if (!items.length) return res.status(409).json({ error: "empty_menu", message: "Add your menu first (snap it or paste it): then tell me what to change." });
    const name = (await getBusinessSettings(businessId))?.displayName ?? staffOf(req).business!.name;
    // An answer to the assistant's question carries the request it was asked about.
    const clip = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
    const earlier = clip(req.body?.earlier?.request, ASSISTANT_MAX_CHARS * 2);
    const asked = clip(req.body?.earlier?.question, 300);
    const words = earlier && asked
      ? `<earlier_request>\n${earlier}\n</earlier_request>\n<your_question>\n${asked}\n</your_question>\n<team_answer>\n${ask}\n</team_answer>`
      : `<team_request>\n${ask}\n</team_request>`;
    // Medium thinking: a menu change has to be right more than it has to be instant.
    const level = engine.thinking === "off" ? null : "medium";
    const call = (thinking: boolean) => engine.ai.models.generateContent({
      model: engine.model,
      contents: [{ role: "user", parts: [{ text: words }] }],
      config: {
        systemInstruction: assistantInstructions(name, items),
        responseMimeType: "application/json",
        responseSchema: MENU_ASSISTANT_SCHEMA,
        temperature: 0,
        abortSignal: AbortSignal.timeout(45_000),
        ...(thinking ? thinkingConfigFor(engine.model, level) ?? {} : {}),
      },
    });
    let raw: unknown;
    try {
      const thinking = Boolean(thinkingConfigFor(engine.model, level));
      let response;
      try {
        response = await call(thinking);
      } catch (error) {
        if (!refusedThinking(engine.model, error, thinking)) throw error;
        response = await call(false);
      }
      raw = JSON.parse(response.text ?? "{}");
    } catch (error) {
      console.error(`[menu assistant] ${businessId} failed:`, error instanceof Error ? error.message : error);
      return res.status(502).json({ error: "not_read", message: "That didn't go through just now. Try again in a moment." });
    }
    const resolved = resolveModelChanges(raw, items);
    const { previews, skipped } = previewChanges(resolved.changes, items);
    // The plan and, beside it, the one thing still needed (if any) and what was left out.
    res.json({ summary: resolved.summary, question: resolved.question, previews, skipped: [...resolved.notes, ...skipped], dropped: resolved.dropped });
  }));

  app.post(`${base}/assistant/apply`, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res, businessId, userId) => {
    const list = Array.isArray(req.body?.changes) ? req.body.changes : null;
    if (!list || !list.length || list.length > MAX_CHANGES + 20) return res.status(400).json({ error: "changes_required", message: "Choose the changes to apply." });
    const changes = list.map(readChange);
    if (changes.some((change: unknown) => !change)) return res.status(400).json({ error: "invalid_change", message: "One of those changes isn't one the assistant makes." });
    const result = await applyChanges(businessId, changes, userId);
    res.json({ ...result, items: (await listPriceItems(businessId)).map(publicPriceItem) });
  }));

  app.put(`${base}/order`, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res, businessId) => {
    const ids = req.body?.ids;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PRICE_ITEMS || !ids.every((id) => typeof id === "string" && uuid.test(id)) || new Set(ids).size !== ids.length) {
      return res.status(400).json({ error: "invalid_order", message: "Send the items' ids, each once, in the order to show them." });
    }
    await orderPriceItems(businessId, ids);
    res.json({ items: (await listPriceItems(businessId)).map(publicPriceItem) });
  }));

  app.patch(`${base}/:itemId`, priceListBody, staff, requireBusinessRole("manager"), handle(async (req, res, businessId, userId) => {
    const current = await getPriceItem(businessId, String(req.params.itemId));
    if (!current) return res.status(404).json({ error: "not_found" });
    const checked = validatePriceItem(req.body ?? {}, current);
    if (!checked.ok) return res.status(400).json({ error: "invalid_item", message: checked.error });
    const updated = await updatePriceItem(businessId, current.id, checked.value, userId);
    if (updated === "name_taken") return res.status(409).json(nameTaken);
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json({ item: publicPriceItem(updated) });
  }));

  app.delete(`${base}/:itemId`, staff, requireBusinessRole("manager"), handle(async (req, res, businessId) => {
    const deleted = await deletePriceItem(businessId, String(req.params.itemId));
    res.status(deleted ? 200 : 404).json({ deleted });
  }));
}

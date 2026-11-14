// src/knowledge/routes.ts
//
// A business's knowledge, for its staff (least role needed):
//
//   GET    /v1/staff/businesses/:businessId/knowledge              viewer   the sources
//   GET    …/knowledge/:sourceId                                   viewer   one source, with its text
//   POST   …/knowledge/search { query }                            viewer   what Zaina would find
//   GET    …/knowledge/misses?days=30                              agent    questions nothing answered
//   POST   …/knowledge { title, kind?, url?, language?, content | faqs, status? }   manager   add, or replace by title
//   PUT    …/knowledge/:sourceId { … }                             manager  change
//   DELETE …/knowledge/:sourceId                                   manager  remove
//   POST   …/knowledge/import-website { url, max_pages?, status? }  manager  read the business's website
//                                                                  (website.ts): a source per page with text
//
// A save answers with how many passages it made and how many amounts it
// hides from Zaina (prices belong in the booking system and the price list,
// not in documents). A PDF is read in the console, in the browser, and saved
// as text like any other source.

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { PublicFetchError } from "../net/public-fetch.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { faqToMarkdown } from "./import.ts";
import { searchKnowledge } from "./search.ts";
import {
  deleteKnowledgeSource,
  getKnowledgeSource,
  knowledgeSourceByTitle,
  listKnowledgeMisses,
  listKnowledgeSources,
  MAX_KNOWLEDGE_CHARS,
  resolveKnowledgeMiss,
  saveKnowledgeSource,
  validateKnowledgeInput,
  type SaveResult,
} from "./store.ts";
import { MAX_WEBSITE_PAGES } from "./website.ts";
import { importWebsite } from "./website-import.ts";
import { ANSWERS_SOURCE_TITLE, withAnswer } from "../onboarding/interview.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";

/** Knowledge routes take bigger bodies than the rest of the API. */
export const KNOWLEDGE_PATH = /^\/v1\/staff\/businesses\/[^/]+\/knowledge(?:\/|$)/;
const knowledgeBody = express.json({ limit: "400kb" });

function inputFrom(body: Record<string, unknown>): Record<string, unknown> {
  if (body.faqs !== undefined) {
    const content = faqToMarkdown(body.faqs);
    return { kind: "faq", ...body, content: content ?? "" };
  }
  return body;
}

function saved(result: SaveResult) {
  const { source } = result;
  return {
    source: { id: source.id, title: source.title, kind: source.kind, url: source.url, language: source.language, status: source.status, updated_at: source.updatedAt },
    passages: result.passages,
    hidden_amounts: result.hiddenAmounts,
    unchanged: result.unchanged,
  };
}

const isTitleTaken = (error: unknown) => {
  const database = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
  return database.code === "23505" && database.constraint === "knowledge_sources_business_id_title_key";
};

export function registerKnowledgeRoutes(app: Express, secret: string): void {
  const staff = requireStaff(secret);
  const base = "/v1/staff/businesses/:businessId/knowledge";

  app.get(base, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ sources: await listKnowledgeSources(staffOf(req).business!.id) });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/misses`, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30) || 30));
      res.json({ days, misses: await listKnowledgeMisses(staffOf(req).business!.id, days) });
    } catch (error) {
      next(error);
    }
  });

  // Answer once, and Zaina knows it: the answer joins the team's answers document, and the question is resolved.
  app.post(`${base}/misses/answer`, knowledgeBody, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
      const answer = typeof req.body?.answer === "string" ? req.body.answer.replace(/\r\n?/g, "\n").trim() : "";
      if (question.length < 2 || question.length > 300) return res.status(400).json({ error: "invalid_question", message: "The question is 2 to 300 characters." });
      if (answer.length < 2 || answer.length > 4000) return res.status(400).json({ error: "invalid_answer", message: "Write an answer of up to 4,000 characters." });
      const current = await knowledgeSourceByTitle(business!.id, ANSWERS_SOURCE_TITLE);
      const content = withAnswer(current?.content ?? null, question, answer);
      if (content.length > MAX_KNOWLEDGE_CHARS) return res.status(400).json({ error: "too_long", message: "Your answers document is full: move some answers into documents of their own." });
      const result = await saveKnowledgeSource(business!.id, { title: ANSWERS_SOURCE_TITLE, kind: "faq", url: null, language: "en", content, status: "published" }, user.id, current?.id);
      const resolved = await resolveKnowledgeMiss(business!.id, question, "answered", user.id);
      res.json({ ...saved(result!), resolved });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/misses/dismiss`, knowledgeBody, staff, requireBusinessRole("agent"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
      if (!question) return res.status(400).json({ error: "invalid_question" });
      res.json({ resolved: await resolveKnowledgeMiss(business!.id, question, "dismissed", user.id) });
    } catch (error) {
      next(error);
    }
  });

  // Reading the website again every week (or not).
  app.get(`${base}/website-sync`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ sync: (await getBusinessSettings(staffOf(req).business!.id))?.websiteSync ?? null });
    } catch (error) {
      next(error);
    }
  });

  app.patch(`${base}/website-sync`, knowledgeBody, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      if (typeof req.body?.weekly !== "boolean") return res.status(400).json({ error: "invalid_weekly", message: "weekly is true or false." });
      const sync = (await getBusinessSettings(business!.id))?.websiteSync;
      if (!sync) return res.status(409).json({ error: "no_website", message: "Read your website once first; then it can be read again every week." });
      const updated = await updateBusinessSettings(business!.id, { websiteSync: { ...sync, weekly: req.body.weekly } }, user.id);
      res.json({ sync: updated.websiteSync });
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/search`, knowledgeBody, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
      if (!query) return res.status(400).json({ error: "query_required" });
      res.json({ passages: await searchKnowledge(staffOf(req).business!.id, query.slice(0, 200)) });
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/:sourceId`, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const source = await getKnowledgeSource(staffOf(req).business!.id, req.params.sourceId);
      if (!source) return res.status(404).json({ error: "not_found" });
      res.json({ source });
    } catch (error) {
      next(error);
    }
  });

  app.post(base, knowledgeBody, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const checked = validateKnowledgeInput(inputFrom(req.body ?? {}));
      if (!checked.ok) return res.status(400).json({ error: "invalid_source", message: checked.error });
      const { business, user } = staffOf(req);
      const result = await saveKnowledgeSource(business!.id, checked.value, user.id);
      res.json(saved(result!));
    } catch (error) {
      next(error);
    }
  });

  app.post(`${base}/import-website`, knowledgeBody, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      const address = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      if (!address || address.length > 500) return res.status(400).json({ error: "url_required", message: "Your website's address, please." });
      const maxPages = Number.isInteger(req.body?.max_pages) ? Math.min(Math.max(req.body.max_pages, 1), MAX_WEBSITE_PAGES) : 10;
      const status = req.body?.status === "draft" ? "draft" : "published";
      const verdict = await consumeLimits([
        { key: `website-import:business:${business!.id}`, limit: 10, windowSeconds: 3600 },
        { key: "website-import:all", limit: 300, windowSeconds: 3600 },
      ]);
      if (!verdict.allowed) {
        res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
        return res.status(429).json({ error: "rate_limited", message: "The website was read several times this hour. Please try again later." });
      }
      let result;
      try {
        result = await importWebsite(business!.id, address, { maxPages, status, userId: user.id });
      } catch (error) {
        if (error instanceof PublicFetchError) return res.status(400).json({ error: "website_unreadable", message: `The website couldn't be read: ${error.message}` });
        throw error;
      }
      // Remembered, so it can be read again every week if the team wants (website sync).
      const previous = (await getBusinessSettings(business!.id))?.websiteSync;
      const weekly = typeof req.body?.weekly === "boolean" ? req.body.weekly : previous?.weekly ?? false;
      await updateBusinessSettings(business!.id, { websiteSync: { url: address, maxPages, weekly, lastReadAt: new Date().toISOString(), lastPages: result.pages.length, lastSkipped: result.skipped.length, lastError: null } }, user.id);
      const read = { site: result.site, skipped: result.skipped, pages: [{ description: result.description }] };
      const pages = result.pages.map((page) => ({ ...saved(page.saved), url: page.url }));
      res.json({ site: read.site, pages, skipped: read.skipped, description: read.pages[0]?.description ?? null, weekly });
    } catch (error) {
      next(error);
    }
  });

  app.put(`${base}/:sourceId`, knowledgeBody, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const checked = validateKnowledgeInput(inputFrom(req.body ?? {}));
      if (!checked.ok) return res.status(400).json({ error: "invalid_source", message: checked.error });
      const { business, user } = staffOf(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.sourceId)) return res.status(404).json({ error: "not_found" });
      const result = await saveKnowledgeSource(business!.id, checked.value, user.id, req.params.sourceId);
      if (!result) return res.status(404).json({ error: "not_found" });
      res.json(saved(result));
    } catch (error) {
      if (isTitleTaken(error)) return res.status(409).json({ error: "title_taken", message: "Another source already has this title." });
      next(error);
    }
  });

  app.delete(`${base}/:sourceId`, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deleteKnowledgeSource(staffOf(req).business!.id, req.params.sourceId);
      res.status(deleted ? 200 : 404).json({ deleted });
    } catch (error) {
      next(error);
    }
  });
}

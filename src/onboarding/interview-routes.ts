// src/onboarding/interview-routes.ts
//
// The setup interview, for a business's team (dashboard → Knowledge →
// Interview), and the playbook Zaina follows for its industry:
//
//   GET /v1/staff/businesses/:businessId/interview   viewer
//       → { industry, industries, questions, answers, updated_at, playbook }
//   PUT /v1/staff/businesses/:businessId/interview   manager
//       { industry, answers: { [question id]: text } }
//
// Saving writes the answers up as one knowledge document (replaced each
// time), which Zaina searches like any other.

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { getBusinessSettings, updateBusinessSettings } from "../businesses/settings.ts";
import { defaultIndustry, INDUSTRY_LABELS, industries, isIndustry, playbookFor, type Industry } from "../engine/playbooks.ts";
import { knowledgeSourceByTitle, saveKnowledgeSource } from "../knowledge/store.ts";
import { requireBusinessRole, requireStaff, staffOf } from "../staff/auth.ts";
import { cleanAnswers, INTERVIEW_SOURCE_TITLE, interviewDocument, questionsFor } from "./interview.ts";

export function registerInterviewRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId/interview";

  const view = async (business: { id: string; name: string; businessType: Parameters<typeof defaultIndustry>[0] }, industryOverride?: Industry) => {
    const settings = await getBusinessSettings(business.id);
    const industry = industryOverride ?? settings?.industry ?? defaultIndustry(business.businessType);
    const source = await knowledgeSourceByTitle(business.id, INTERVIEW_SOURCE_TITLE);
    return {
      industry,
      chosen: Boolean(settings?.industry),
      industries: industries.map((id) => ({ id, label: INDUSTRY_LABELS[id] })),
      questions: questionsFor(industry),
      answers: settings?.interview?.answers ?? {},
      updated_at: settings?.interview?.updatedAt ?? null,
      knowledge_source_id: source?.id ?? null,
      playbook: playbookFor(industry, settings?.displayName ?? business.name).trim(),
    };
  };

  app.get(base, staff, requireBusinessRole("viewer"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const industry = isIndustry(req.query.industry) ? req.query.industry : undefined;
      res.json(await view(staffOf(req).business!, industry));
    } catch (error) {
      next(error);
    }
  });

  app.put(base, staff, requireBusinessRole("manager"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { business, user } = staffOf(req);
      if (!isIndustry(req.body?.industry)) return res.status(400).json({ error: "invalid_industry", message: `industry is one of ${industries.join(", ")}.` });
      const industry: Industry = req.body.industry;
      const answers = cleanAnswers(industry, req.body?.answers);
      const settings = await updateBusinessSettings(business!.id, { industry, interview: { answers, updatedAt: new Date().toISOString() } }, user.id);
      if (Object.keys(answers).length > 0) {
        const existing = await knowledgeSourceByTitle(business!.id, INTERVIEW_SOURCE_TITLE);
        await saveKnowledgeSource(business!.id, {
          title: INTERVIEW_SOURCE_TITLE, kind: "guide", url: null, language: "en", status: "published",
          content: interviewDocument(settings.displayName ?? business!.name, industry, answers),
        }, user.id, existing?.id);
      }
      res.json(await view(business!));
    } catch (error) {
      next(error);
    }
  });
}

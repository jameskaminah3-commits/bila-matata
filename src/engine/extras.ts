// src/engine/extras.ts
//
// What a business adds to Zaina beyond its connector, decided per business
// each turn:
//
//   prompt   its industry's playbook (how a good receptionist works there)
//   tools    extra tools (added by later phases: requests for something the
//            business doesn't list, callbacks, the business's own system)
//
// The agent appends the prompt after the shared guidance and offers the
// tools alongside the connector's; a call to one of them runs here.

import type { FunctionDeclaration } from "@google/genai";
import { getBusinessSettings } from "../businesses/settings.ts";
import type { Business, ChatLanguage } from "../db/schema.ts";
import { defaultIndustry, playbookFor } from "./playbooks.ts";

export type ExtraContext = { business: Business; sessionId: string; language: ChatLanguage };
export type ExtraTool = { declaration: FunctionDeclaration; readOnly: boolean; run: (args: unknown, context: ExtraContext) => Promise<unknown> };
export type Extras = { prompt: string; tools: ExtraTool[] };

/** Contributors of extra tools and instructions, registered at start-up by the features that offer them. */
type Contributor = (business: Business) => Promise<{ prompt?: string; tools?: ExtraTool[] }>;
const contributors: Contributor[] = [];
export function addExtras(contributor: Contributor): void {
  contributors.push(contributor);
}

export async function extrasFor(business: Business): Promise<Extras> {
  const settings = await getBusinessSettings(business.id);
  const industry = settings?.industry ?? defaultIndustry(business.businessType);
  let prompt = playbookFor(industry, settings?.displayName ?? business.name);
  const tools: ExtraTool[] = [];
  for (const contributor of contributors) {
    const added = await contributor(business);
    if (added.prompt) prompt += added.prompt;
    if (added.tools) tools.push(...added.tools);
  }
  return { prompt, tools };
}

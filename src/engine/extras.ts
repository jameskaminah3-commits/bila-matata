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
export type ExtraTool = {
  declaration: FunctionDeclaration;
  readOnly: boolean;
  run: (args: unknown, context: ExtraContext) => Promise<unknown>;
  /** Its results come from the business's own system: the https links in them may be passed on as they are. */
  trustsLinks?: boolean;
};

/** Every https link in a tool's result. */
export function linksIn(value: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 6 || found.length > 50) return found;
  if (typeof value === "string") {
    if (/^https:\/\/\S+$/.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) linksIn(entry, found, depth + 1);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) linksIn(entry, found, depth + 1);
  }
  return found;
}
export type Extras = { prompt: string; tools: ExtraTool[] };

/** Contributors of extra tools and instructions, registered at start-up by the features that offer them. */
type Contributor = (business: Business, sessionId?: string) => Promise<{ prompt?: string; tools?: ExtraTool[] }>;
const contributors: Contributor[] = [];
export function addExtras(contributor: Contributor): void {
  contributors.push(contributor);
}

export async function extrasFor(business: Business, sessionId?: string): Promise<Extras> {
  const settings = await getBusinessSettings(business.id);
  const industry = settings?.industry ?? defaultIndustry(business.businessType);
  let prompt = playbookFor(industry, settings?.displayName ?? business.name);
  const tools: ExtraTool[] = [];
  for (const contributor of contributors) {
    const added = await contributor(business, sessionId);
    if (added.prompt) prompt += added.prompt;
    if (added.tools) tools.push(...added.tools);
  }
  return { prompt, tools };
}

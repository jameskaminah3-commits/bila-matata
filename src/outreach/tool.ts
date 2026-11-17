// src/outreach/tool.ts
//
// Asking for consent to offers, once, in the customer's own WhatsApp chat
// (where the number proves who agreed). Only when the business sends offers
// (Outreach → Offers on), and only to a customer who hasn't answered or
// replied STOP. A clear yes is kept with when and where it was given; a no,
// or no answer, means no offers.

import { Type, type FunctionDeclaration } from "@google/genai";
import { verifiedCustomerOfChat } from "../customers/store.ts";
import type { Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { addExtras, type ExtraContext, type ExtraTool } from "../engine/extras.ts";
import { getOutreachSettings } from "./send.ts";

export const RECORD_OFFERS_ANSWER = "record_offers_answer";

const declaration: FunctionDeclaration = {
  name: RECORD_OFFERS_ANSWER,
  description: "Keep the customer's answer to whether they'd like the business's occasional offers here on WhatsApp.",
  parameters: { type: Type.OBJECT, properties: { agreed: { type: Type.BOOLEAN, description: "True only if they clearly said yes." } }, required: ["agreed"] },
};

async function run(args: any, context: ExtraContext) {
  const verified = await verifiedCustomerOfChat(context.business.id, context.sessionId);
  if (!verified || verified.how !== "whatsapp") return { ok: false, error: "not_available" };
  const agreed = args?.agreed === true;
  await inBusiness((_db, client) => client.query(
    `update customers set offers_asked_at = now(),
       offers_agreed_at = case when $3 then now() else null end,
       offers_source = case when $3 then 'Said yes in their WhatsApp chat' else offers_source end,
       updated_at = now()
     where business_id = $1 and id = $2 and outreach_stopped_at is null`, [context.business.id, verified.row.id, agreed]), context.business.id);
  return { ok: true, next_step: agreed ? "Thank them briefly, and say they can reply STOP any time." : "Say that's fine, briefly. Don't ask again." };
}

const TOOLS: ExtraTool[] = [{ declaration, readOnly: false, run }];

/** For a business that sends offers: on a WhatsApp chat with a customer who hasn't been asked. */
export function registerOutreachExtras(): void {
  addExtras(async (business: Business, sessionId?: string) => {
    if (!sessionId || business.businessType === "custom") return {};
    if (!(await getOutreachSettings(business.id)).offers) return {};
    const verified = await verifiedCustomerOfChat(business.id, sessionId).catch(() => null);
    if (!verified || verified.how !== "whatsapp") return {};
    const row = verified.row;
    if (row.offers_asked_at || row.offers_agreed_at || row.outreach_stopped_at) return {};
    return {
      prompt: `\n\nThis business sends occasional offers on WhatsApp to customers who agree. Once you've helped them (after they book or order, or as the chat ends well), you may ask once: "Would you like our occasional offers here on WhatsApp? You can reply STOP any time." Keep their answer with ${RECORD_OFFERS_ANSWER}: only a clear yes counts. Don't ask if they seem unhappy or in a hurry, and never ask twice.`,
      tools: TOOLS,
    };
  });
}

// src/notifications/store.ts
//
// The extra addresses a business adds to hear about its chats (migration
// 0018), on top of its team members' own alerts. How many it may add comes
// from its plan: the plan's own number, or the tier's (2 on Starter, 5 on
// Full). Read and written as the business (row-level security).

import { ownerPool } from "../db/platform-db.ts";
import { inBusiness } from "../db/tenant.ts";
import type { BusinessTier } from "../db/schema.ts";

export const TIER_NOTIFICATION_EMAILS: Record<BusinessTier, number> = { menu: 1, starter: 2, full: 5 };

export type Recipient = { id: string; email: string; label: string | null; notifyAlerts: boolean; sendTranscripts: boolean; createdAt: Date };

export class NotificationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** How many notification emails a business may have, and which plan says so. */
export async function notificationAllowance(business: { id: string; tier: BusinessTier }): Promise<{ limit: number; planName: string | null }> {
  const { rows: [row] } = await ownerPool().query<{ notification_emails: number | null; name: string }>(
    `select p.notification_emails, p.name from subscriptions s join plans p on p.id = s.plan_id
     where s.business_id = $1 and s.status <> 'cancelled'`,
    [business.id],
  );
  return { limit: row?.notification_emails ?? TIER_NOTIFICATION_EMAILS[business.tier], planName: row?.name ?? null };
}

const COLUMNS = `id, email, label, notify_alerts as "notifyAlerts", send_transcripts as "sendTranscripts", created_at as "createdAt"`;

/** The business's recipients, oldest first. */
export async function recipientsOf(businessId: string): Promise<Recipient[]> {
  return inBusiness(async (_db, client) => (await client.query<Recipient>(
    `select ${COLUMNS} from notification_recipients where business_id = $1 order by created_at, email`, [businessId],
  )).rows, businessId);
}

export type NewRecipient = { email: string; label: string | null; notifyAlerts: boolean; sendTranscripts: boolean };

/** What someone typed for a new recipient. */
export function validateRecipient(body: any): { ok: true; value: NewRecipient } | { ok: false; message: string } {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 200) return { ok: false, message: "That email address doesn't look right." };
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().replace(/\s+/g, " ").slice(0, 60) : null;
  const notifyAlerts = body?.alerts === undefined ? true : body.alerts === true;
  const sendTranscripts = body?.transcripts === true;
  if (!notifyAlerts && !sendTranscripts) return { ok: false, message: "Choose what this address gets: alerts, transcripts, or both." };
  return { ok: true, value: { email, label, notifyAlerts, sendTranscripts } };
}

export async function addRecipient(business: { id: string; tier: BusinessTier }, input: NewRecipient, createdBy: string): Promise<Recipient> {
  const { limit, planName } = await notificationAllowance(business);
  const existing = await recipientsOf(business.id);
  if (existing.some((row) => row.email === input.email)) throw new NotificationError(409, "already_added", "That address is already on the list.");
  if (existing.length >= limit) {
    throw new NotificationError(409, "plan_limit", limit === 0
      ? "Your plan doesn't include notification emails. Ask the Bila Matata team about upgrading."
      : `${planName ?? (business.tier === "full" ? "Your plan" : business.tier === "menu" ? "Your Menu plan" : "Your Starter plan")} includes ${limit} notification email${limit === 1 ? "" : "s"}, and you've added ${existing.length}. Remove one, or ask the Bila Matata team about a bigger plan.`);
  }
  return inBusiness(async (_db, client) => (await client.query<Recipient>(
    `insert into notification_recipients (business_id, email, label, notify_alerts, send_transcripts, created_by)
     values ($1, $2, $3, $4, $5, $6) returning ${COLUMNS}`,
    [business.id, input.email, input.label, input.notifyAlerts, input.sendTranscripts, createdBy],
  )).rows[0], business.id);
}

export async function updateRecipient(businessId: string, id: string, patch: { alerts?: unknown; transcripts?: unknown; label?: unknown }): Promise<Recipient> {
  const current = (await recipientsOf(businessId)).find((row) => row.id === id);
  if (!current) throw new NotificationError(404, "not_found", "That address wasn't found.");
  const alerts = typeof patch.alerts === "boolean" ? patch.alerts : current.notifyAlerts;
  const transcripts = typeof patch.transcripts === "boolean" ? patch.transcripts : current.sendTranscripts;
  if (!alerts && !transcripts) throw new NotificationError(400, "nothing_selected", "An address needs at least one of alerts or transcripts. Remove it instead.");
  const label = "label" in patch ? (typeof patch.label === "string" && patch.label.trim() ? patch.label.trim().replace(/\s+/g, " ").slice(0, 60) : null) : current.label;
  return inBusiness(async (_db, client) => (await client.query<Recipient>(
    `update notification_recipients set notify_alerts = $3, send_transcripts = $4, label = $5 where business_id = $1 and id = $2 returning ${COLUMNS}`,
    [businessId, id, alerts, transcripts, label],
  )).rows[0], businessId);
}

export async function removeRecipient(businessId: string, id: string): Promise<boolean> {
  return inBusiness(async (_db, client) => ((await client.query("delete from notification_recipients where business_id = $1 and id = $2", [businessId, id])).rowCount ?? 0) > 0, businessId);
}

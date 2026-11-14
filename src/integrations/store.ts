// src/integrations/store.ts
//
// A business's connection to its own system: the settings, its secret (a
// business secret, encrypted), the log of calls, and one place that makes a
// call (checks it's allowed, signs it, records how it went).

import { randomBytes } from "node:crypto";
import { deleteSecret, getSecret, putSecret } from "../businesses/secrets.ts";
import type { VerifiedCustomer } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { IntegrationError, isWriteAction, signedPost, type Action } from "./client.ts";

export const SECRET_NAME = "integration_secret";

export type Integration = {
  studioEnabled: boolean;
  endpoint: string | null;
  label: string | null;
  actions: string[];
  allowWrites: boolean;
  eventsUrl: string | null;
  events: string[];
  lastOkAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  updatedAt: Date | null;
};

const EMPTY: Integration = { studioEnabled: false, endpoint: null, label: null, actions: [], allowWrites: false, eventsUrl: null, events: [], lastOkAt: null, lastError: null, lastErrorAt: null, updatedAt: null };
const COLUMNS = `studio_enabled as "studioEnabled", endpoint, label, actions, allow_writes as "allowWrites", events_url as "eventsUrl", events,
  last_ok_at as "lastOkAt", last_error as "lastError", last_error_at as "lastErrorAt", updated_at as "updatedAt"`;

const CACHE_MS = Number(process.env.BUSINESS_CACHE_MS ?? "") || 5000;
const cache = new Map<string, { at: number; value: Integration }>();

export async function getIntegration(businessId: string): Promise<Integration> {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const rows = await inBusiness(async (_db, client) => (await client.query<Integration>(`select ${COLUMNS} from integrations where business_id = $1`, [businessId])).rows, businessId);
  const value = rows[0] ?? EMPTY;
  cache.set(businessId, { at: Date.now(), value });
  return value;
}

/** Connected: the studio turned it on, and the business gave an address and has a secret. */
export async function liveIntegration(businessId: string): Promise<Integration | null> {
  const integration = await getIntegration(businessId);
  if (!integration.studioEnabled || !integration.endpoint) return null;
  return integration;
}

export async function setStudioEnabled(businessId: string, enabled: boolean, userId: string | null): Promise<Integration> {
  await inBusiness((_db, client) => client.query(
    `insert into integrations (business_id, studio_enabled, updated_by) values ($1, $2, $3)
     on conflict (business_id) do update set studio_enabled = excluded.studio_enabled, updated_by = excluded.updated_by, updated_at = now()`,
    [businessId, enabled, userId],
  ), businessId);
  cache.delete(businessId);
  return getIntegration(businessId);
}

export type IntegrationChanges = { endpoint: string | null; label: string | null; actions: string[]; allowWrites: boolean; eventsUrl: string | null; events: string[] };

export async function saveIntegration(businessId: string, changes: IntegrationChanges, userId: string): Promise<Integration> {
  await inBusiness((_db, client) => client.query(
    `update integrations set endpoint = $2, label = $3, actions = $4, allow_writes = $5, events_url = $6, events = $7, updated_by = $8, updated_at = now(),
       last_error = case when endpoint is distinct from $2 then null else last_error end
     where business_id = $1`,
    [businessId, changes.endpoint, changes.label, changes.actions, changes.allowWrites, changes.eventsUrl, changes.events, userId],
  ), businessId);
  cache.delete(businessId);
  return getIntegration(businessId);
}

/** Disconnects: the address, the choices and the secret go; the studio's switch stays. */
export async function disconnectIntegration(businessId: string, userId: string): Promise<void> {
  await saveIntegration(businessId, { endpoint: null, label: null, actions: [], allowWrites: false, eventsUrl: null, events: [] }, userId);
  await deleteSecret(businessId, SECRET_NAME);
}

/** A new secret, shown once. The old one stops working at once. */
export async function newSecret(businessId: string, userId: string): Promise<string> {
  const secret = `zk_${randomBytes(32).toString("base64url")}`;
  await putSecret(businessId, SECRET_NAME, secret, userId);
  return secret;
}

export async function hasSecret(businessId: string): Promise<boolean> {
  return (await getSecret(businessId, SECRET_NAME)) !== null;
}

export async function recordCall(businessId: string, action: string, ok: boolean, ms: number | null, error: string | null): Promise<void> {
  await inBusiness(async (_db, client) => {
    await client.query(`insert into integration_calls (business_id, action, ok, ms, error) values ($1, $2, $3, $4, $5)`, [businessId, action.slice(0, 40), ok, ms, error?.slice(0, 300) ?? null]);
    await client.query(
      ok ? `update integrations set last_ok_at = now() where business_id = $1` : `update integrations set last_error = $2, last_error_at = now() where business_id = $1`,
      ok ? [businessId] : [businessId, (error ?? "Failed").slice(0, 300)],
    );
    // Thirty days is enough to help with a problem.
    if (Math.random() < 0.02) await client.query(`delete from integration_calls where business_id = $1 and at < now() - interval '30 days'`, [businessId]);
  }, businessId).catch((failure) => console.error(`[integrations] ${businessId} couldn't record a call:`, failure));
  cache.delete(businessId);
}

export async function recentCalls(businessId: string, limit = 20) {
  return inBusiness(async (_db, client) => (await client.query<{ at: Date; action: string; ok: boolean; ms: number | null; error: string | null }>(
    `select at, action, ok, ms, error from integration_calls where business_id = $1 order by at desc, id desc limit $2`,
    [businessId, limit],
  )).rows, businessId);
}

export class NotAllowed extends Error {}

/** Asks the business's system, if this action is switched on; records the call either way. */
export async function ask(businessId: string, action: Action, args: Record<string, unknown>, customer: VerifiedCustomer | null = null): Promise<any> {
  const integration = await liveIntegration(businessId);
  if (!integration) throw new NotAllowed("Not connected.");
  if (action !== "ping" && (!integration.actions.includes(action) || (isWriteAction(action) && !integration.allowWrites))) throw new NotAllowed(`${action} isn't switched on.`);
  const secret = await getSecret(businessId, SECRET_NAME);
  if (!secret) throw new NotAllowed("No connection secret yet.");
  const started = Date.now();
  try {
    const { body, ms } = await signedPost(integration.endpoint!, secret, businessId, { action, args, customer });
    await recordCall(businessId, action, true, ms, null);
    return body;
  } catch (error) {
    // "Not found" is an answer, not a failure of the connection.
    if (error instanceof IntegrationError && error.code === "not_found") {
      await recordCall(businessId, action, true, Date.now() - started, null);
      throw error;
    }
    await recordCall(businessId, action, false, Date.now() - started, (error as Error).message);
    throw error;
  }
}

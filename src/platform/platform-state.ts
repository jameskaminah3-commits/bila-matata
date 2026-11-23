// src/platform/platform-state.ts
//
// What the platform keeps for itself (never a business's), in the owner's
// connection only:
//
// - the web push key pair, made the first time the service starts without
//   WEB_PUSH_* set, its private half sealed with the platform's secrets key,
//   so alerts on staff phones work with nothing to generate or paste;
// - when an outside service last reached it (Meta verifying the WhatsApp
//   webhook, Meta's last signed delivery), shown on the platform's set-up page.

import webpush from "web-push";
import type { PlatformConfig, WebPushConfig } from "../config.ts";
import { loadSecretKeys, openSecret, sealSecret } from "../businesses/secrets.ts";
import { ownerPool } from "../db/platform-db.ts";

const SCOPE = "platform";

/** The address push services may contact about the alerts: the platform's own site, or a placeholder mailbox. */
export function pushSubject(publicBaseUrl: string | null): string {
  return publicBaseUrl?.startsWith("https://") ? new URL(publicBaseUrl).origin : "mailto:alerts@example.com";
}

/** Alerts on phones on by default: the keys set in WEB_PUSH_*, else the platform's own (made once, kept). WEB_PUSH=off leaves them off. */
export async function ensureWebPushKeys(config: PlatformConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (config.webPush || env.WEB_PUSH?.trim().toLowerCase() === "off") return;
  const keys = loadSecretKeys(env);
  const read = async () => (await ownerPool().query("select public_value, ciphertext, iv, auth_tag, key_id from platform_keys where name = 'web_push'")).rows[0];
  let row = await read();
  if (!row) {
    const pair = webpush.generateVAPIDKeys();
    const sealed = sealSecret(keys, SCOPE, "web_push", pair.privateKey);
    // Two instances starting together keep one pair.
    await ownerPool().query(
      "insert into platform_keys (name, public_value, ciphertext, iv, auth_tag, key_id) values ('web_push', $1, $2, $3, $4, $5) on conflict (name) do nothing",
      [pair.publicKey, sealed.ciphertext, sealed.iv, sealed.authTag, sealed.keyId],
    );
    row = await read();
  }
  const privateKey = openSecret(keys, SCOPE, "web_push", { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyId: row.key_id });
  (config as { webPush: WebPushConfig | null }).webPush = { publicKey: row.public_value, privateKey, subject: pushSubject(config.publicBaseUrl) };
}

export type Signal = "whatsapp_verified" | "whatsapp_delivery";

const lastWritten = new Map<Signal, number>();

/** Remembers that an outside service reached the platform (written at most once a minute: deliveries can come in bursts). */
export function signal(name: Signal): void {
  const now = Date.now();
  if ((lastWritten.get(name) ?? 0) > now - 60_000) return;
  lastWritten.set(name, now);
  void ownerPool().query("insert into platform_signals (name, at) values ($1, now()) on conflict (name) do update set at = now()", [name]).catch(() => lastWritten.delete(name));
}

export async function signals(): Promise<Partial<Record<Signal, Date>>> {
  const rows = (await ownerPool().query("select name, at from platform_signals")).rows as Array<{ name: Signal; at: Date }>;
  return Object.fromEntries(rows.map((row) => [row.name, row.at]));
}

// src/staff/two-step.ts
//
// Signing in in two steps. After the right password, a 6-digit code is
// emailed to the account and must be typed in (10 minutes, 5 tries, resent
// at most 4 times, 30 seconds apart). A person can trust a device for 30
// days, so their own phone or laptop skips the code; a new password forgets
// every trusted device. Signing in with Google needs no code (Google has
// already proved the person owns the email): its callback hands over to the
// dashboard with a one-time, two-minute hand-over instead.
//
// Codes, hand-overs and device tokens are stored only as keyed hashes.

import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { ownerPool } from "../db/platform-db.ts";
import type { StaffUser } from "../db/schema.ts";
import { sendEmail } from "../platform/mailer.ts";

export type Target = "app" | "admin";
export const isTarget = (value: unknown): value is Target => value === "app" || value === "admin";

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
const RESEND_SECONDS = 30;
const TRUST_DAYS = 30;
const HANDOFF_SECONDS = 120;

const keyed = (secret: string, purpose: string, value: string) => createHmac("sha256", `${purpose}:${secret}`).update(value).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "am•••@gmail.com": enough to recognise the inbox, not enough to read it out. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, Math.min(2, name.length))}•••@${domain ?? ""}`;
}

function codeEmail(user: { name: string }, code: string, target: Target) {
  const product = target === "admin" ? "Bila Matata" : "Zaina";
  return {
    subject: `${code} is your ${product} sign-in code`,
    text: [
      `Hello ${user.name.split(" ")[0] || "there"},`,
      "",
      `Your code to sign in to ${product}: ${code}`,
      "",
      `It works for ${CODE_MINUTES} minutes. Never share it: nobody from Bila Matata will ever ask you for it.`,
      "",
      "Didn't just try to sign in? Someone may know your password. Change it now with \"Forgot your password?\" on the sign-in page.",
    ].join("\n"),
  };
}

/** A new code for this person, emailed; returns the challenge's id. */
export async function sendSignInCode(secret: string, user: StaffUser, target: Target): Promise<string> {
  const id = randomUUID();
  const code = newCode();
  await ownerPool().query(
    `insert into staff_sign_in_codes (id, user_id, kind, code_hash, target, expires_at) values ($1, $2, 'code', $3, $4, now() + make_interval(mins => $5))`,
    [id, user.id, keyed(secret, "code", `${id}:${code}`), target, CODE_MINUTES],
  );
  await sendEmail({ to: user.email, ...codeEmail(user, code, target) });
  return id;
}

export type CodeCheck =
  | { ok: true; userId: string; target: Target }
  | { ok: false; error: "wrong_code"; attemptsLeft: number }
  | { ok: false; error: "expired" };

/** Checks a typed code; a right one works once. */
export async function checkSignInCode(secret: string, challenge: unknown, code: unknown): Promise<CodeCheck> {
  if (typeof challenge !== "string" || !UUID.test(challenge)) return { ok: false, error: "expired" };
  const typed = String(code ?? "").replace(/\D/g, "");
  const { rows: [row] } = await ownerPool().query<{ user_id: string; code_hash: string; target: Target; attempts: number }>(
    `update staff_sign_in_codes set attempts = attempts + 1
     where id = $1 and kind = 'code' and used_at is null and expires_at > now() and attempts < $2
     returning user_id, code_hash, target, attempts`,
    [challenge, MAX_ATTEMPTS],
  );
  if (!row) return { ok: false, error: "expired" };
  if (typed.length !== 6 || !same(keyed(secret, "code", `${challenge}:${typed}`), row.code_hash)) {
    return row.attempts >= MAX_ATTEMPTS ? { ok: false, error: "expired" } : { ok: false, error: "wrong_code", attemptsLeft: MAX_ATTEMPTS - row.attempts };
  }
  const { rowCount } = await ownerPool().query(`update staff_sign_in_codes set used_at = now() where id = $1 and used_at is null`, [challenge]);
  return rowCount ? { ok: true, userId: row.user_id, target: row.target } : { ok: false, error: "expired" };
}

export type Resend = { ok: true } | { ok: false; error: "expired" | "too_soon" | "too_many"; retryAfterSeconds?: number };

/** A fresh code for the same sign-in (the old one stops working). */
export async function resendSignInCode(secret: string, challenge: unknown, user: (id: string) => Promise<StaffUser | undefined>): Promise<Resend> {
  if (typeof challenge !== "string" || !UUID.test(challenge)) return { ok: false, error: "expired" };
  const { rows: [row] } = await ownerPool().query<{ user_id: string; target: Target; sends: number; wait: number }>(
    `select user_id, target, sends, greatest(0, ceil(extract(epoch from (last_sent_at + make_interval(secs => $2) - now()))))::int as wait
     from staff_sign_in_codes where id = $1 and kind = 'code' and used_at is null and created_at > now() - interval '1 hour'`,
    [challenge, RESEND_SECONDS],
  );
  if (!row) return { ok: false, error: "expired" };
  if (row.sends >= MAX_SENDS) return { ok: false, error: "too_many" };
  if (row.wait > 0) return { ok: false, error: "too_soon", retryAfterSeconds: row.wait };
  const person = await user(row.user_id);
  if (!person || person.disabledAt) return { ok: false, error: "expired" };
  const code = newCode();
  await ownerPool().query(
    `update staff_sign_in_codes set code_hash = $2, sends = sends + 1, attempts = 0, last_sent_at = now(), expires_at = now() + make_interval(mins => $3) where id = $1`,
    [challenge, keyed(secret, "code", `${challenge}:${code}`), CODE_MINUTES],
  );
  await sendEmail({ to: person.email, ...codeEmail(person, code, row.target) });
  return { ok: true };
}

/** A token for this device, valid 30 days or until the password changes. */
export async function trustDevice(secret: string, user: StaffUser): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await ownerPool().query(
    `insert into staff_trusted_devices (user_id, token_hash, token_version, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))`,
    [user.id, keyed(secret, "device", token), user.tokenVersion, TRUST_DAYS],
  );
  // Old ones go: no one needs more than a handful of devices.
  await ownerPool().query(`delete from staff_trusted_devices where user_id = $1 and (expires_at < now() or token_version <> $2)`, [user.id, user.tokenVersion]);
  return token;
}

export async function isTrustedDevice(secret: string, user: StaffUser, token: unknown): Promise<boolean> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return false;
  const { rowCount } = await ownerPool().query(
    `update staff_trusted_devices set last_used_at = now()
     where token_hash = $1 and user_id = $2 and token_version = $3 and expires_at > now()`,
    [keyed(secret, "device", token), user.id, user.tokenVersion],
  );
  return Boolean(rowCount);
}

/** After Google: a one-time hand-over the dashboard exchanges for its sign-in, within two minutes. */
export async function createHandoff(secret: string, user: StaffUser, target: Target): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await ownerPool().query(
    `insert into staff_sign_in_codes (id, user_id, kind, code_hash, target, expires_at) values ($1, $2, 'handoff', $3, $4, now() + make_interval(secs => $5))`,
    [randomUUID(), user.id, keyed(secret, "handoff", token), target, HANDOFF_SECONDS],
  );
  return token;
}

export async function takeHandoff(secret: string, token: unknown): Promise<{ userId: string; target: Target } | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const { rows: [row] } = await ownerPool().query<{ user_id: string; target: Target }>(
    `update staff_sign_in_codes set used_at = now()
     where kind = 'handoff' and code_hash = $1 and used_at is null and expires_at > now()
     returning user_id, target`,
    [keyed(secret, "handoff", token)],
  );
  return row ? { userId: row.user_id, target: row.target } : null;
}

/** Old challenges and devices, cleared now and then. */
export async function pruneSignInRecords(): Promise<void> {
  await ownerPool().query(`delete from staff_sign_in_codes where created_at < now() - interval '1 day'`);
  await ownerPool().query(`delete from staff_trusted_devices where expires_at < now()`);
}

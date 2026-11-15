// src/staff/password-links.ts
//
// Emailed links for choosing a password: "Forgot your password?", and the
// invitation a new team member (or a business's first owner, added by the
// platform team) gets to choose theirs.
//
//   pr1.<payload>.<signature>   payload = base64url(JSON {u, e, v, p, exp})
//
// The link names the person, the email it was sent to, and their token
// version. Choosing a password raises the version, so a link works once, and
// any other password change or "sign out everywhere" ends it too. A reset
// link works for an hour; an invitation for three days. The link opens the
// console at #/reset/<token> (or #/welcome/<token>): a fragment, so the token
// never reaches a server's logs.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PlatformConfig } from "../config.ts";
import { mailerConfigured } from "../platform/mailer.ts";
import { hashPassword } from "./passwords.ts";

export type PasswordLinkPurpose = "reset" | "invite";

export const PASSWORD_LINK_TTL_SECONDS: Record<PasswordLinkPurpose, number> = { reset: 60 * 60, invite: 72 * 60 * 60 };

function signature(secret: string, payload: string): string {
  const key = createHmac("sha256", secret).update("zaina-password-link").digest();
  return createHmac("sha256", key).update(`pr1.${payload}`).digest("base64url");
}

export function passwordLinkToken(
  secret: string,
  user: { id: string; email: string; tokenVersion: number },
  purpose: PasswordLinkPurpose,
  now = new Date(),
): string {
  const exp = Math.floor(now.getTime() / 1000) + PASSWORD_LINK_TTL_SECONDS[purpose];
  const payload = Buffer.from(JSON.stringify({ u: user.id, e: user.email, v: user.tokenVersion, p: purpose, exp })).toString("base64url");
  return `pr1.${payload}.${signature(secret, payload)}`;
}

export type PasswordLinkClaims = { userId: string; email: string; tokenVersion: number; purpose: PasswordLinkPurpose };

export function readPasswordLinkToken(secret: string, token: unknown, now = new Date()): PasswordLinkClaims | null {
  if (typeof token !== "string" || token.length > 800) return null;
  const [version, payload, given, extra] = token.split(".");
  if (version !== "pr1" || !payload || !given || extra !== undefined) return null;
  const expected = Buffer.from(signature(secret, payload));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims?.u !== "string" || typeof claims?.e !== "string" || !Number.isInteger(claims?.v) || !Number.isInteger(claims?.exp)) return null;
    if (claims.p !== "reset" && claims.p !== "invite") return null;
    if (claims.exp <= Math.floor(now.getTime() / 1000)) return null;
    return { userId: claims.u, email: claims.e, tokenVersion: claims.v, purpose: claims.p };
  } catch {
    return null;
  }
}

/** Emails with links to the console need an email provider and the service's public address. */
export const canEmailLinks = (config: Pick<PlatformConfig, "publicBaseUrl">) => mailerConfigured() && Boolean(config.publicBaseUrl);

/** A password nobody knows, for an account whose person chooses theirs from an emailed link. */
export const unknownPassword = () => hashPassword(randomBytes(32).toString("base64url"));

/** Where the link opens: the console's screen for choosing a password. */
/** The page that sets the password: the clients' door (/app/), or the studio team's (/admin/). */
export function passwordLink(origin: string, token: string, purpose: PasswordLinkPurpose, door: "app" | "admin" = "app"): string {
  return `${origin}/${door}/#/${purpose === "invite" ? "welcome" : "reset"}/${token}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

/** The emails around passwords: a reset link, an invitation, and "your password was changed". */
export function resetEmail(user: { name: string }, link: string, product = "Zaina") {
  return {
    subject: `Choose a new password for ${product}`,
    text: [
      `Hi ${firstName(user.name)},`,
      "",
      `Someone (probably you) asked to choose a new password for your ${product} account. Choose it here:`,
      link,
      "",
      "The link works once, for an hour. If you didn't ask, ignore this email: your password stays as it is.",
    ].join("\n"),
  };
}

export function inviteEmail(user: { name: string }, businessName: string, role: string, link: string, invitedBy: string | null) {
  return {
    subject: `You've been added to ${businessName} on Zaina`,
    text: [
      `Hi ${firstName(user.name)},`,
      "",
      `${invitedBy ?? "The Zaina team"} added you to ${businessName} on Zaina, as ${role}. Choose your password to sign in:`,
      link,
      "",
      "The link works once, for three days. After that, use \"Forgot your password?\" on the sign-in page.",
    ].join("\n"),
  };
}

export function addedEmail(user: { name: string }, businessName: string, role: string, consoleUrl: string, invitedBy: string | null) {
  return {
    subject: `You've been added to ${businessName} on Zaina`,
    text: [
      `Hi ${firstName(user.name)},`,
      "",
      `${invitedBy ?? "The Zaina team"} added you to ${businessName} on Zaina, as ${role}. Sign in with your Zaina account to see it:`,
      consoleUrl,
    ].join("\n"),
  };
}

export function passwordChangedEmail(user: { name: string }, consoleUrl: string) {
  return {
    subject: "Your Zaina password was changed",
    text: [
      `Hi ${firstName(user.name)},`,
      "",
      "Your Zaina password was just changed, and every device signed in with the old one was signed out.",
      `If this wasn't you, choose a new password now with "Forgot your password?" at ${consoleUrl}, and tell your team.`,
    ].join("\n"),
  };
}

/** The studio's first admin, created from PLATFORM_ADMIN_EMAIL: choose a password, then sign in at /admin/. */
export function adminWelcomeEmail(user: { name: string }, link: string, adminUrl: string) {
  return {
    subject: "Your Bila Matata admin account",
    text: [
      `Hi ${firstName(user.name)},`,
      "",
      "Your admin account for the Bila Matata dashboard is ready. Choose your password here:",
      link,
      "",
      `The link works once, for 72 hours. Then sign in at ${adminUrl} (bookmark it): after your password, a code is emailed to you.`,
    ].join("\n"),
  };
}

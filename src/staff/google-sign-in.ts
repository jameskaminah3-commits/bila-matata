// src/staff/google-sign-in.ts
//
// "Continue with Google" for the dashboards.
//
//   GET  /v1/staff/google/start?to=app|admin   off to Google (only an email and name are asked for)
//   GET  /v1/staff/google/callback             Google sends the person back here
//   POST /v1/console/session/google            { handoff }: the dashboard exchanges the hand-over for its sign-in
//
// Only people already on a team get in: Google must say the email is
// verified, and it must be an existing, active account's email. No code is
// emailed after Google (Google has already proved they own the inbox). The
// round trip is protected by a signed state that must match a short-lived
// cookie set on the way out, so nobody can sign someone else in with their
// own Google account.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { ownerPool } from "../db/platform-db.ts";
import { findStaffByEmail, getStaffUser } from "../db/platform-scope.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { visitorKey } from "../gateway/visitor.ts";
import { setConsoleCookie } from "./auth.ts";
import { issueStaffToken } from "./tokens.ts";
import { createHandoff, isTarget, takeHandoff, type Target } from "./two-step.ts";

const STATE_COOKIE = "zaina_google";
const STATE_SECONDS = 600;

const sign = (secret: string, payload: string) => createHmac("sha256", `google-state:${secret}`).update(payload).digest("base64url");

function makeState(secret: string, target: Target): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ n: nonce, t: target, e: Math.floor(Date.now() / 1000) + STATE_SECONDS })).toString("base64url");
  return { state: `${payload}.${sign(secret, payload)}`, nonce };
}

function readState(secret: string, state: unknown, cookieNonce: string | null): Target | null {
  if (typeof state !== "string" || !cookieNonce) return null;
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (claims.e < Date.now() / 1000 || claims.n !== cookieNonce || !isTarget(claims.t)) return null;
    return claims.t;
  } catch {
    return null;
  }
}

function cookie(req: Request, name: string): string | null {
  for (const part of (req.header("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

/** What Google's ID token says, checked: our app, Google, not expired, a verified email. */
export function readIdToken(idToken: unknown, clientId: string, now = Date.now()): { email: string; name: string | null } | null {
  if (typeof idToken !== "string") return null;
  try {
    // Received straight from Google's token endpoint over TLS, so the issuer is
    // proven by the connection (OpenID Connect Core 3.1.3.7); the claims are checked here.
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(clientId)) return null;
    if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < now) return null;
    if (claims.email_verified !== true && claims.email_verified !== "true") return null;
    if (typeof claims.email !== "string" || !claims.email.includes("@")) return null;
    return { email: claims.email.trim().toLowerCase(), name: typeof claims.name === "string" ? claims.name : null };
  } catch {
    return null;
  }
}

export function registerGoogleSignInRoutes(app: Express, config: PlatformConfig): void {
  const secret = config.sessionTokenSecret;
  const base = config.publicBaseUrl ?? "";
  const redirectUri = `${base}/v1/staff/google/callback`;
  const landing = (target: Target) => `${base}/${target === "admin" ? "admin" : "app"}/`;
  const failed = (res: Response, target: Target, reason: string) => res.redirect(302, `${landing(target)}#/signin-error/${reason}`);

  app.get("/v1/staff/google/start", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const target: Target = req.query.to === "admin" ? "admin" : "app";
      if (!config.google || !config.publicBaseUrl) return failed(res, target, "google-off");
      const verdict = await consumeLimits([{ key: `google-signin:visitor:${visitorKey(secret, req.ip)}`, limit: 30, windowSeconds: 900 }]);
      if (!verdict.allowed) return failed(res, target, "too-many");
      const { state, nonce } = makeState(secret, target);
      res.setHeader("Set-Cookie", `${STATE_COOKIE}=${nonce}; Path=/v1/staff/google; HttpOnly; Secure; SameSite=Lax; Max-Age=${STATE_SECONDS}`);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: config.google.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account",
      }).toString();
      res.redirect(302, url.toString());
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/staff/google/callback", async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      const target = readState(secret, req.query.state, cookie(req, STATE_COOKIE));
      res.append("Set-Cookie", `${STATE_COOKIE}=; Path=/v1/staff/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
      if (!target) return failed(res, "app", "expired");
      if (!config.google) return failed(res, target, "google-off");
      if (typeof req.query.code !== "string" || req.query.error) return failed(res, target, "cancelled");
      const exchanged = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: req.query.code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      const body = exchanged?.ok ? await exchanged.json().catch(() => null) as { id_token?: string } | null : null;
      const identity = readIdToken(body?.id_token, config.google.clientId);
      if (!identity) return failed(res, target, "google-failed");
      const user = await findStaffByEmail(identity.email);
      if (!user || user.disabledAt) return failed(res, target, "no-account");
      // Google proved the email: an account still waiting for its confirmation link counts as confirmed.
      if (!user.emailVerifiedAt) await ownerPool().query("update staff_users set email_verified_at = now() where id = $1 and email_verified_at is null", [user.id]);
      const handoff = await createHandoff(secret, user, target);
      res.redirect(302, `${landing(target)}#/signed-in/${handoff}`);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/console/session/google", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const taken = await takeHandoff(secret, req.body?.handoff);
      const user = taken ? await getStaffUser(taken.userId) : undefined;
      if (!taken || !user || user.disabledAt) return res.status(400).json({ error: "expired", message: "That sign-in took too long. Please try again." });
      setConsoleCookie(res, issueStaffToken(secret, user));
      res.json({ ok: true, target: taken.target });
    } catch (error) {
      next(error);
    }
  });
}

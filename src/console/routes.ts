// src/console/routes.ts
//
// The business console (a single-page app at /app/, and for the studio's own
// team at /admin/, the same app with the team's sign-in), the website widget
// script (/zaina.js, also /widget.js), and the routes only the console uses:
//
//   POST   /v1/console/session              sign in: { email, password, target?, device? } → sets the console's cookie,
//                                           or 202 { code_required, challenge, sent_to } when a code was emailed
//   POST   /v1/console/session/verify       { challenge, code, trust_device? } → sets the cookie (and a device_token)
//   POST   /v1/console/session/resend       { challenge }: a fresh code
//   DELETE /v1/console/session              sign out
//   GET    /v1/console/me                   who is signed in, their businesses, alert settings
//   POST   /v1/console/push-subscriptions   alerts on this phone or browser: { endpoint, keys: { p256dh, auth } }
//   DELETE /v1/console/push-subscriptions   { endpoint }: stop them
//
// Everything else the console does goes through the staff API, with the
// cookie and the X-Zaina-Console header (see staff/auth.ts).

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { pushPublicKey } from "../conversations/team-alerts.ts";
import { deletePushSubscription, getStaffUser, membershipsOf, pushSubscriptionCount, savePushSubscription } from "../db/platform-scope.ts";
import { consumeLimits } from "../gateway/rate-limit.ts";
import { visitorKey } from "../gateway/visitor.ts";
import { canEmailLinks } from "../staff/password-links.ts";
import { checkSignInCode, isTrustedDevice, maskEmail, resendSignInCode, sendSignInCode, trustDevice } from "../staff/two-step.ts";
import { clearConsoleCookie, requireStaff, setConsoleCookie, staffOf } from "../staff/auth.ts";
import { signIn } from "../staff/routes.ts";
import { issueStaffToken } from "../staff/tokens.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setWidgetVersion } from "../frontdoor/widget-version.ts";

/** The built widget and console: PLATFORM_PUBLIC_DIR, or dist/public (next to dist/server.js, or two up from src/console/). */
export function publicDirectory(config: PlatformConfig): string | null {
  const candidates = config.publicDir
    ? [path.resolve(config.publicDir)]
    : ["./public/", "../../dist/public/"].map((relative) => fileURLToPath(new URL(relative, import.meta.url)));
  return candidates.find((directory) => existsSync(path.join(directory, "widget.js"))) ?? null;
}

const CONSOLE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * "Connect with Facebook" (WhatsApp's Embedded Signup) runs Meta's SDK, so it
 * has a page and a policy of its own: Meta's script, its sign-in window and
 * frames, and the platform's own API. The console's policy stays 'self' only.
 */
const CONNECT_CSP = [
  "default-src 'none'",
  "script-src 'self' https://connect.facebook.net",
  "connect-src 'self' https://*.facebook.com https://*.facebook.net",
  "frame-src https://*.facebook.com",
  "img-src 'self' data: https://*.facebook.com https://*.fbcdn.net",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self' https://*.facebook.com",
  "object-src 'none'",
].join("; ");

const publicUser = (user: { id: string; email: string; name: string; isPlatformAdmin: boolean }) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  is_platform_admin: user.isPlatformAdmin,
});

export function registerConsoleRoutes(app: Express, config: PlatformConfig): void {
  const secret = config.sessionTokenSecret;
  const staff = requireStaff(secret);
  const directory = publicDirectory(config);
  if (!directory) console.warn("[platform] the widget and console aren't built (npm run build:web); /widget.js and /app/ are off");

  // ── The widget script: any website may load it; it only works where the business allows. ──
  // /zaina.js (with data-business) is its name for every business; /widget.js (with data-key) stays for older snippets.
  // Its version, for the businesses' own pages (src/frontdoor/widget-version.ts).
  const widgetFile = directory ? path.join(directory, "widget.js") : null;
  const built = widgetFile && existsSync(widgetFile) ? createHash("sha256").update(readFileSync(widgetFile)).digest("hex").slice(0, 12) : null;
  setWidgetVersion(built);
  app.get(["/zaina.js", "/widget.js"], (req: Request, res: Response) => {
    if (!directory) return res.status(404).type("text/plain").send("// The widget isn't built on this server.");
    res.setHeader("Cache-Control", built && req.query.v === built ? "public, max-age=31536000, immutable" : "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(path.join(directory, "widget.js"), { headers: { "Content-Type": "application/javascript; charset=utf-8" } });
  });

  // ── Connect with Facebook (WhatsApp) ─────────────────────────────────
  app.get("/connect/whatsapp", (_req: Request, res: Response) => {
    if (!directory) return res.status(404).type("text/plain").send("Not built on this server.");
    res.setHeader("Content-Security-Policy", CONNECT_CSP);
    // Meta's sign-in window talks back to this page, so the page keeps its opener.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(directory, "connect", "whatsapp.html"));
  });
  app.get("/connect/whatsapp.js", (_req: Request, res: Response) => {
    if (!directory) return res.status(404).type("text/plain").send("// Not built on this server.");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(path.join(directory, "connect", "whatsapp.js"), { headers: { "Content-Type": "application/javascript; charset=utf-8" } });
  });

  // ── The console ────────────────────────────────────────────────────────
  // Express matches "/app" and "/app/" alike: only the first is sent on.
  app.get("/app", (req: Request, res: Response, next: NextFunction) => (req.path.endsWith("/") ? next() : res.redirect(301, "/app/")));
  app.get("/admin", (req: Request, res: Response, next: NextFunction) => (req.path.endsWith("/") ? next() : res.redirect(301, "/admin/")));
  for (const mount of directory ? ["/app", "/admin"] : []) {
    app.use(mount, express.static(path.join(directory!, "console"), {
      index: "index.html",
      redirect: false,
      setHeaders: (res, file) => {
        res.setHeader("Content-Security-Policy", CONSOLE_CSP);
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-cache");
        if (file.endsWith("sw.js")) res.setHeader("Service-Worker-Allowed", `${mount}/`);
      },
    }));
  }

  // Two steps (a code emailed after the password) whenever email can be sent, unless SIGN_IN_CODES=off.
  const twoStep = () => process.env.SIGN_IN_CODES !== "off" && canEmailLinks(config);

  app.post("/v1/console/session", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outcome = await signIn(secret, req);
      if (!outcome.ok) {
        if (outcome.retryAfterSeconds) res.setHeader("Retry-After", String(outcome.retryAfterSeconds));
        return res.status(outcome.status).json(outcome.body);
      }
      if (twoStep() && !(await isTrustedDevice(secret, outcome.user, req.body?.device))) {
        const challenge = await sendSignInCode(secret, outcome.user, req.body?.target === "admin" ? "admin" : "app");
        return res.status(202).json({ code_required: true, challenge, sent_to: maskEmail(outcome.user.email) });
      }
      setConsoleCookie(res, issueStaffToken(secret, outcome.user));
      res.json({ user: publicUser(outcome.user), businesses: await membershipsOf(outcome.user.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/console/session/verify", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const verdict = await consumeLimits([{ key: `signin-code:visitor:${visitorKey(secret, req.ip)}`, limit: 30, windowSeconds: 900 }]);
      if (!verdict.allowed) {
        res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
        return res.status(429).json({ error: "rate_limited", message: "Too many tries. Please wait a few minutes." });
      }
      const checked = await checkSignInCode(secret, req.body?.challenge, req.body?.code);
      if (!checked.ok) {
        return checked.error === "wrong_code"
          ? res.status(400).json({ error: "wrong_code", message: `That code isn't right. ${checked.attemptsLeft} ${checked.attemptsLeft === 1 ? "try" : "tries"} left.`, attempts_left: checked.attemptsLeft })
          : res.status(410).json({ error: "code_expired", message: "That code has expired or was used too many times. Sign in again for a new one." });
      }
      const user = await getStaffUser(checked.userId);
      if (!user || user.disabledAt) return res.status(410).json({ error: "code_expired", message: "Sign in again for a new code." });
      const device = req.body?.trust_device === true ? await trustDevice(secret, user) : null;
      setConsoleCookie(res, issueStaffToken(secret, user));
      res.json({ user: publicUser(user), businesses: await membershipsOf(user.id), ...(device ? { device_token: device } : {}) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/console/session/resend", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sent = await resendSignInCode(secret, req.body?.challenge, getStaffUser);
      if (sent.ok) return res.json({ ok: true });
      if (sent.error === "too_soon") {
        res.setHeader("Retry-After", String(sent.retryAfterSeconds ?? 30));
        return res.status(429).json({ error: "too_soon", message: `Please wait ${sent.retryAfterSeconds ?? 30} seconds before asking again.`, retry_after_seconds: sent.retryAfterSeconds });
      }
      res.status(410).json({ error: sent.error === "too_many" ? "too_many" : "code_expired", message: sent.error === "too_many" ? "That's the most codes for one sign-in. Sign in again." : "Sign in again for a new code." });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/console/session", (_req: Request, res: Response) => {
    clearConsoleCookie(res);
    res.json({ ok: true });
  });

  app.get("/v1/console/me", staff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user } = staffOf(req);
      res.json({
        user: publicUser(user),
        businesses: await membershipsOf(user.id),
        push: { public_key: pushPublicKey(), devices: await pushSubscriptionCount(user.id) },
        public_base_url: config.publicBaseUrl,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/console/push-subscriptions", staff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!pushPublicKey()) return res.status(404).json({ error: "push_off", message: "Alerts on phones aren't set up on this platform." });
      const endpoint = req.body?.endpoint;
      const p256dh = req.body?.keys?.p256dh;
      const auth = req.body?.keys?.auth;
      const valid = typeof endpoint === "string" && /^https:\/\/[^\s]{8,1990}$/.test(endpoint)
        && typeof p256dh === "string" && /^[\w-]{40,200}$/.test(p256dh)
        && typeof auth === "string" && /^[\w-]{10,100}$/.test(auth);
      if (!valid) return res.status(400).json({ error: "invalid_subscription" });
      const userAgent = String(req.header("user-agent") ?? "").slice(0, 300) || null;
      await savePushSubscription(staffOf(req).user.id, { endpoint, p256dh, auth }, userAgent);
      res.status(201).json({ ok: true, devices: await pushSubscriptionCount(staffOf(req).user.id) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/console/push-subscriptions", staff, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const endpoint = req.body?.endpoint;
      if (typeof endpoint !== "string") return res.status(400).json({ error: "endpoint_required" });
      const removed = await deletePushSubscription(endpoint, staffOf(req).user.id);
      res.status(removed ? 200 : 404).json({ removed, devices: await pushSubscriptionCount(staffOf(req).user.id) });
    } catch (error) {
      next(error);
    }
  });
}

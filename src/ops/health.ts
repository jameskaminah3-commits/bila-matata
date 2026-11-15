// src/ops/health.ts
//
// Is Zaina working, right now? Checked every minute, so a failure reaches
// the studio by email before a client notices (Phase 7).
//
//   database     answers within two seconds
//   replies      the share of Zaina's replies that failed in the last 30
//                minutes, across every business
//   background   each background job (reminders, calendars, websites,
//                billing…) ran recently and didn't fail three times running
//
//   GET /status               public page: each part working or not, no client data
//   GET /v1/status            the same, as JSON (HTTP 503 when down, for an outside uptime monitor)
//   GET /v1/platform/health   platform admins: the numbers behind it
//
// The studio gets one email when something stays wrong for two checks in a
// row, and one when it's back to normal (STUDIO_NOTIFY_EMAIL).

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { ownerPool } from "../db/platform-db.ts";
import { sendEmail } from "../platform/mailer.ts";
import { requirePlatformAdmin, requireStaff } from "../staff/auth.ts";

type State = "ok" | "degraded" | "down";
type Check = { name: "database" | "replies" | "background"; state: State; detail: string };
export type Health = { state: State; checkedAt: string; checks: Check[] };

// ── Background jobs report in ─────────────────────────────────────────────

type Job = { intervalMs: number; lastStart: number | null; lastOk: number | null; failuresInARow: number; lastError: string | null };
const jobs = new Map<string, Job>();
const startedAt = Date.now();

export function jobStarted(label: string, intervalMs: number): void {
  const job = jobs.get(label) ?? { intervalMs, lastStart: null, lastOk: null, failuresInARow: 0, lastError: null };
  job.intervalMs = intervalMs;
  job.lastStart = Date.now();
  jobs.set(label, job);
}

export function jobFinished(label: string, error: unknown): void {
  const job = jobs.get(label);
  if (!job) return;
  if (error) {
    job.failuresInARow += 1;
    job.lastError = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
  } else {
    job.failuresInARow = 0;
    job.lastOk = Date.now();
    job.lastError = null;
  }
}

/** For tests: forget every job. */
export function resetJobs(): void {
  jobs.clear();
}

export function backgroundCheck(now = Date.now()): Check {
  const problems: string[] = [];
  for (const [label, job] of jobs) {
    const grace = 3 * job.intervalMs + 120_000;
    if (job.failuresInARow >= 3) problems.push(`${label} failed ${job.failuresInARow} times running (${job.lastError ?? "no message"})`);
    else if (now - startedAt > grace && (job.lastOk === null ? now - startedAt : now - job.lastOk) > grace) problems.push(`${label} hasn't finished since ${job.lastOk ? new Date(job.lastOk).toISOString() : "the server started"}`);
  }
  return { name: "background", state: problems.length ? "degraded" : "ok", detail: problems.length ? problems.join("; ") : `${jobs.size} jobs running on time` };
}

// ── The checks ────────────────────────────────────────────────────────────

const MIN_TURNS = Number(process.env.HEALTH_MIN_TURNS ?? "") || 4;
const DEGRADED_SHARE = Number(process.env.HEALTH_FAILED_SHARE ?? "") || 0.25;

export function repliesState(total: number, failed: number): State {
  if (total < MIN_TURNS) return "ok";
  const share = failed / total;
  if (share >= 0.5) return "down";
  return share >= DEGRADED_SHARE ? "degraded" : "ok";
}

const SLOW_DATABASE_MS = Number(process.env.HEALTH_SLOW_DATABASE_MS ?? "") || 1500;

/**
 * Whether the database answers, and how fast once connected. The first query
 * may include opening a connection (a secure handshake, often across regions,
 * about a second), so it only has to answer; the second, on that open
 * connection, is the one timed.
 */
async function databaseCheck(): Promise<Check> {
  const timed = async (limitMs: number) => {
    const started = Date.now();
    await Promise.race([
      ownerPool().query("select 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${limitMs / 1000} s`)), limitMs)),
    ]);
    return Date.now() - started;
  };
  try {
    const first = await timed(5000);
    const warm = await timed(3000);
    return { name: "database", state: warm > SLOW_DATABASE_MS ? "degraded" : "ok", detail: `answered in ${warm} ms (${first} ms including connecting)` };
  } catch (error) {
    return { name: "database", state: "down", detail: (error as Error).message.slice(0, 200) };
  }
}

async function repliesCheck(): Promise<Check> {
  try {
    const { rows: [row] } = await ownerPool().query<{ total: number; failed: number }>(
      `select count(*)::int as total, count(*) filter (where outcome in ('timeout', 'model_error', 'error'))::int as failed
       from turn_metrics where started_at > now() - interval '30 minutes'`,
    );
    return { name: "replies", state: repliesState(row.total, row.failed), detail: `${row.failed} of ${row.total} replies failed in the last 30 minutes` };
  } catch (error) {
    return { name: "replies", state: "degraded", detail: `couldn't count: ${(error as Error).message.slice(0, 160)}` };
  }
}

const worst = (states: State[]): State => (states.includes("down") ? "down" : states.includes("degraded") ? "degraded" : "ok");

export async function checkHealth(): Promise<Health> {
  const checks = [await databaseCheck(), await repliesCheck(), backgroundCheck()];
  return { state: worst(checks.map((check) => check.state)), checkedAt: new Date().toISOString(), checks };
}

// ── Telling the studio ────────────────────────────────────────────────────

let last: Health | null = null;
let badChecks = 0;
let alerted = false;

/** One check; emails the studio when something stays wrong for two checks, and when it recovers. */
export async function monitorHealth(studioEmail: string | null, product = "Zaina"): Promise<Health> {
  const health = await checkHealth();
  last = health;
  if (health.state !== "ok") badChecks += 1;
  else badChecks = 0;
  const problems = health.checks.filter((check) => check.state !== "ok");
  if (badChecks >= 2 && !alerted) {
    alerted = true;
    console.error(`[health] ${health.state}: ${problems.map((check) => `${check.name}: ${check.detail}`).join(" | ")}`);
    if (studioEmail) {
      await sendEmail({
        to: studioEmail,
        subject: `[${product}] ${health.state === "down" ? "Down" : "Not working properly"}: ${problems.map((check) => check.name).join(", ")}`,
        text: [`Checked at ${health.checkedAt}.`, "", ...problems.map((check) => `${check.name}: ${check.detail}`), "", "What to do: docs/RUNBOOKS.md. You'll get another email when it's back to normal."].join("\n"),
      }).catch((error) => console.error("[health] couldn't email the studio:", error));
    }
  } else if (health.state === "ok" && alerted) {
    alerted = false;
    console.log("[health] back to normal");
    if (studioEmail) {
      await sendEmail({ to: studioEmail, subject: `[${product}] Back to normal`, text: `Every check passed at ${health.checkedAt}.` }).catch(() => undefined);
    }
  }
  return health;
}

/** For tests: start counting again. */
export function resetMonitor(): void {
  last = null;
  badChecks = 0;
  alerted = false;
}

// ── Pages ─────────────────────────────────────────────────────────────────

const LABELS: Record<Check["name"], string> = { database: "Dashboard and data", replies: "Chat replies", background: "Reminders, calendars and billing" };
const WORDS: Record<State, string> = { ok: "Working normally", degraded: "Slower or partly failing", down: "Not working" };

async function current(): Promise<Health> {
  if (last && Date.now() - new Date(last.checkedAt).getTime() < 30_000) return last;
  last = await checkHealth();
  return last;
}

const PAGE_CSS = `:root{--bg:#f6f5f1;--card:#fff;--ink:#14181a;--muted:#5d6663;--line:#e3e1db;--ok:#0f7a4f;--warn:#a15c07;--bad:#b42318;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0e1412;--card:#151d1a;--ink:#f1f4f2;--muted:#a3afab;--line:#2a3431;--ok:#3fbf86;--warn:#e0a240;--bad:#f0745f;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:32px 16px 48px}h1{margin:0 0 4px;font-size:1.5rem}p{margin:0 0 18px;color:var(--muted)}
.overall{padding:16px 18px;border-radius:14px;background:var(--card);border:1px solid var(--line);font-weight:700;margin-bottom:14px}
ul{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:14px}li{display:flex;justify-content:space-between;gap:12px;padding:14px 18px;border-top:1px solid var(--line)}li:first-child{border-top:0}li span:last-child{white-space:nowrap;text-align:right}
.ok{color:var(--ok)}.degraded{color:var(--warn)}.down{color:var(--bad)}small{display:block;margin-top:14px;color:var(--muted)}`;

export function registerHealthRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);

  app.get("/status-assets/status.css", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("text/css").send(PAGE_CSS);
  });

  app.get("/v1/status", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const health = await current();
      res.setHeader("Cache-Control", "no-store");
      // An outside uptime monitor alerts on anything but 200: it catches the case where the service itself is down and can't email.
      res.status(health.state === "down" ? 503 : 200).json({ state: health.state, checked_at: health.checkedAt, parts: health.checks.map((check) => ({ name: LABELS[check.name], state: check.state })) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/status", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const health = await current();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Zaina status</title><link rel="stylesheet" href="/status-assets/status.css"></head><body><main>
<h1>Zaina status</h1><p>Whether Zaina is answering customers right now. The checks run every minute: reload the page for the latest.</p>
<div class="overall ${health.state}">${health.state === "ok" ? "Everything is working normally" : health.state === "down" ? "Something isn't working: we're on it" : "Some things are slower than usual: we're on it"}</div>
<ul>${health.checks.map((check) => `<li><span>${LABELS[check.name]}</span><span class="${check.state}">${WORDS[check.state]}</span></li>`).join("")}</ul>
<small>Checked ${new Date(health.checkedAt).toUTCString()}</small></main></body></html>`);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/platform/health", staff, requirePlatformAdmin, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const health = await checkHealth();
      res.json({ ...health, jobs: [...jobs.entries()].map(([label, job]) => ({ label, interval_ms: job.intervalMs, last_ok: job.lastOk ? new Date(job.lastOk).toISOString() : null, failures_in_a_row: job.failuresInARow, last_error: job.lastError })) });
    } catch (error) {
      next(error);
    }
  });
}

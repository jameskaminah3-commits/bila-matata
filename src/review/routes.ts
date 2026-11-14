// src/review/routes.ts
//
// Proving Zaina works (Phase 5): the studio reads real chats every week,
// marks each one good or an issue (with what went wrong), and tracks the
// fix. The pilot report counts what really happened, week by week, from the
// same data each business's own report uses. No estimates, no samples
// dressed up as totals.
//
//   GET  /v1/platform/review/queue?business=&days=7&show=unreviewed|issues|all   chats to read, most worth reading first
//   PUT  /v1/platform/review/sessions/:sessionId   { business, verdict: good|issue, tags[], note }
//   POST /v1/platform/review/:reviewId/fixed       { business, note? }   the issue is fixed
//   GET  /v1/platform/review/report?business=&weeks=4                    week by week, per business
//
// The transcript itself is the business's own (GET /v1/staff/businesses/:id/sessions/:sessionId):
// platform admins can open any business's chats.

import type { Express, NextFunction, Request, Response } from "express";
import { anyBusinessById, everyBusiness } from "../businesses/registry.ts";
import type { PlatformConfig } from "../config.ts";
import type { Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { businessReport } from "../reports/business-report.ts";
import { requirePlatformAdmin, requireStaff, staffOf } from "../staff/auth.ts";

export const REVIEW_TAGS = ["wrong_info", "invented", "missed_sale", "should_handoff", "slow_team", "tone", "language", "privacy", "payment", "other"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QueueRow = {
  session_id: string;
  started_at: Date;
  channel: string;
  customer_messages: number;
  failed_turns: number;
  lead: boolean;
  booking: boolean;
  handed_off: boolean;
  misses: number;
  first_message: string | null;
  review_id: string | null;
  verdict: "good" | "issue" | null;
  tags: string[] | null;
  note: string | null;
  fixed_at: Date | null;
  reviewed_at: Date | null;
};

/** Why a chat is worth reading first: a failure, a handover, a question unanswered, a long chat that led nowhere. */
export function reasonsToRead(row: Pick<QueueRow, "failed_turns" | "handed_off" | "misses" | "lead" | "booking" | "customer_messages">): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (row.failed_turns > 0) { score += 8; reasons.push("a reply failed"); }
  if (row.handed_off) { score += 4; reasons.push("handed to the team"); }
  if (row.misses > 0) { score += 3; reasons.push("a question went unanswered"); }
  if (!row.lead && !row.booking && row.customer_messages >= 4) { score += 2; reasons.push("a long chat with no lead or booking"); }
  if (row.lead || row.booking) { score += 1; reasons.push(row.booking ? "a booking" : "a lead"); }
  return { score, reasons };
}

async function queueFor(business: Business, days: number): Promise<QueueRow[]> {
  return inBusiness(async (_db, client) => (await client.query<QueueRow>(
    `select s.id as session_id, s.created_at as started_at, s.channel,
       (select count(*)::int from chat_events e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER') as customer_messages,
       (select count(*)::int from turn_metrics t where t.business_id = s.business_id and t.session_id = s.id and t.outcome in ('timeout', 'model_error', 'error')) as failed_turns,
       exists (select 1 from leads l where l.business_id = s.business_id and l.session_id = s.id) as lead,
       exists (select 1 from bookings b where b.business_id = s.business_id and b.session_id = s.id) as booking,
       s.first_handoff_at is not null as handed_off,
       (select count(*)::int from knowledge_misses m where m.business_id = s.business_id and m.session_id = s.id) as misses,
       (select left(e.content, 160) from chat_events e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER' order by e.id limit 1) as first_message,
       r.id::text as review_id, r.verdict, r.tags, r.note, r.fixed_at, r.updated_at as reviewed_at
     from chat_sessions s
     left join chat_reviews r on r.business_id = s.business_id and r.session_id = s.id
     where s.business_id = $1 and s.preview = false and s.created_at > now() - make_interval(days => $2)
       and exists (select 1 from chat_events e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER')
     order by s.created_at desc
     limit 300`,
    [business.id, days],
  )).rows, business.id);
}

const listOf = (value: unknown) => (typeof value === "string" && value ? value.split(",") : []);

export function registerReviewRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const admin = [staff, requirePlatformAdmin];

  /** The businesses asked for (?business=a,b), or every business that isn't paused. */
  async function chosen(req: Request): Promise<Business[]> {
    const ids = listOf(req.query.business);
    if (ids.length) return (await Promise.all(ids.slice(0, 20).map((id) => anyBusinessById(id)))).filter((business): business is Business => Boolean(business));
    return (await everyBusiness()).filter((business) => business.status !== "paused");
  }

  app.get("/v1/platform/review/queue", ...admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days ?? 7) || 7));
      const show = req.query.show === "issues" || req.query.show === "all" ? req.query.show : "unreviewed";
      const businesses = await chosen(req);
      const all = (await Promise.all(businesses.map(async (business) => (await queueFor(business, days)).map((row) => ({ business, row }))))).flat();
      const chats = all
        .filter(({ row }) => (show === "all" ? true : show === "issues" ? row.verdict === "issue" && !row.fixed_at : !row.verdict))
        .map(({ business, row }) => {
          const why = reasonsToRead(row);
          return {
            business: { id: business.id, name: business.name },
            session_id: row.session_id,
            started_at: row.started_at,
            channel: row.channel,
            customer_messages: row.customer_messages,
            first_message: row.first_message,
            outcomes: { lead: row.lead, booking: row.booking, handed_off: row.handed_off, failed_turns: row.failed_turns, unanswered: row.misses },
            score: why.score,
            reasons: why.reasons,
            review: row.verdict ? { id: row.review_id, verdict: row.verdict, tags: row.tags ?? [], note: row.note, fixed_at: row.fixed_at, reviewed_at: row.reviewed_at } : null,
          };
        })
        .sort((a, b) => b.score - a.score || new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        .slice(0, 100);
      const reviewed = all.filter(({ row }) => row.verdict).length;
      res.json({ days, show, total_chats: all.length, reviewed, open_issues: all.filter(({ row }) => row.verdict === "issue" && !row.fixed_at).length, chats, tags: REVIEW_TAGS });
    } catch (error) {
      next(error);
    }
  });

  app.put("/v1/platform/review/sessions/:sessionId", ...admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = String(req.params.sessionId);
      const business = await anyBusinessById(String(req.body?.business ?? ""));
      if (!business || !UUID.test(sessionId)) return res.status(404).json({ error: "not_found" });
      const verdict = req.body?.verdict;
      if (verdict !== "good" && verdict !== "issue") return res.status(400).json({ error: "invalid_verdict", message: "verdict is good or issue." });
      const tags = Array.isArray(req.body?.tags) ? [...new Set(req.body.tags.filter((tag: unknown) => (REVIEW_TAGS as readonly string[]).includes(String(tag))))] as string[] : [];
      if (verdict === "issue" && !tags.length) return res.status(400).json({ error: "tags_required", message: "Say what went wrong." });
      const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 1000) : null;
      const saved = await inBusiness(async (_db, client) => {
        const { rows: [session] } = await client.query("select 1 from chat_sessions where business_id = $1 and id = $2", [business.id, sessionId]);
        if (!session) return null;
        const { rows: [row] } = await client.query(
          `insert into chat_reviews (business_id, session_id, verdict, tags, note, reviewer)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (business_id, session_id) do update set verdict = excluded.verdict, tags = excluded.tags, note = excluded.note, reviewer = excluded.reviewer, updated_at = now(),
             fixed_at = case when excluded.verdict = 'good' then null else chat_reviews.fixed_at end
           returning id::text, verdict, tags, note, fixed_at, updated_at as reviewed_at`,
          [business.id, sessionId, verdict, verdict === "good" ? [] : tags, note, staffOf(req).user.id],
        );
        return row;
      }, business.id);
      if (!saved) return res.status(404).json({ error: "not_found" });
      res.json({ review: saved });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/platform/review/:reviewId/fixed", ...admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const business = await anyBusinessById(String(req.body?.business ?? ""));
      const id = Number(req.params.reviewId);
      if (!business || !Number.isInteger(id)) return res.status(404).json({ error: "not_found" });
      const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : null;
      const { rows: [row] } = await inBusiness((_db, client) => client.query(
        `update chat_reviews set fixed_at = now(), fixed_note = $3, updated_at = now() where business_id = $1 and id = $2 and verdict = 'issue'
         returning id::text, verdict, tags, note, fixed_at, fixed_note`,
        [business.id, id, note],
      ), business.id);
      if (!row) return res.status(404).json({ error: "not_found" });
      res.json({ review: row });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/platform/review/report", ...admin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const weeks = Math.min(12, Math.max(1, Number(req.query.weeks ?? 4) || 4));
      const businesses = await chosen(req);
      const now = Date.now();
      const report = await Promise.all(businesses.map(async (business) => {
        const rows = await Promise.all(Array.from({ length: weeks }, async (_, index) => {
          const end = new Date(now - index * 7 * 86_400_000);
          const start = new Date(end.getTime() - 7 * 86_400_000);
          const week = await businessReport(business.id, { days: 7, timeZone: business.timeZone, now: end, prices: config.modelPriceUsdPerMillion, stays: business.businessType === "guesthouse" });
          const { rows: [reviews] } = await inBusiness((_db, client) => client.query<{ reviewed: number; issues: number; fixed: number; tags: Record<string, number> | null }>(
            `select count(*)::int as reviewed, count(*) filter (where r.verdict = 'issue')::int as issues, count(*) filter (where r.fixed_at is not null)::int as fixed,
               (select json_object_agg(tag, n) from (select unnest(r2.tags) as tag, count(*)::int as n from chat_reviews r2 join chat_sessions s2 on s2.business_id = r2.business_id and s2.id = r2.session_id
                 where r2.business_id = $1 and s2.created_at >= $2 and s2.created_at < $3 group by tag) t) as tags
             from chat_reviews r join chat_sessions s on s.business_id = r.business_id and s.id = r.session_id
             where r.business_id = $1 and s.created_at >= $2 and s.created_at < $3`,
            [business.id, start, end],
          ), business.id);
          return { from: start.toISOString(), to: end.toISOString(), report: week, reviews: { reviewed: reviews.reviewed, issues: reviews.issues, fixed: reviews.fixed, tags: reviews.tags ?? {} } };
        }));
        return { business: { id: business.id, name: business.name, type: business.businessType, went_live_at: business.wentLiveAt }, weeks: rows };
      }));
      res.json({ weeks, generated_at: new Date(now).toISOString(), businesses: report });
    } catch (error) {
      next(error);
    }
  });
}

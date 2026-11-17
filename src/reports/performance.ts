// src/reports/performance.ts
//
// The monthly Business Performance Report: what a business owner wants to
// know about a month, from the records themselves.
//
//   customers      how many people got in touch (new and returning)
//   paying         how many paid, and what share of those who got in touch
//   revenue        VERIFIED: payments that settled in the month, split by
//                  who confirmed them (the payment provider, or the team
//                  recording an M-Pesa code, cash or bank). Kept apart from
//                  EXPECTED amounts nobody has confirmed: pay-on-delivery
//                  orders marked delivered, balances due at the property,
//                  requests the team marked won. Chats are never money.
//   interest       which items, rooms and services customers asked about,
//                  and how many of those were booked or ordered
//   not converted  enquiries that didn't become a sale, and why
//   lost           what slipped away: unpaid, declined, unanswered
//   questions      what customers ask again and again (and what Zaina
//                  couldn't answer)
//   time saved     an estimate, with its assumptions shown
//
// A month is the business's own calendar month, in its time zone; the
// current month runs to now. Owners and managers get last month's by email
// early on the 1st (sendMonthlyReports).

import { formatMoney } from "../booking/money.ts";
import { everyBusiness } from "../businesses/registry.ts";
import { getBusinessSettings } from "../businesses/settings.ts";
import type { Business } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";
import { sendEmail, mailerConfigured } from "../platform/mailer.ts";

type Client = { query: <T = any>(text: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }> };

export type Money = { currency: string; minor: number; display: string };
export type Count = { count: number; value: Money[] };

/** The assumptions behind "time saved", shown with it. */
export const TIME_SAVED = { minutesPerChat: 4, minutesPerBookingOrOrder: 5, minutesPerUpdate: 1 } as const;
const CATALOGUE_TOOLS = ["get_prices", "check_availability", "check_times", "list_rooms", "list_services", "store_search", "store_item"];

export type PerformanceReport = {
  month: string;
  from: string;
  to: string;
  partial: boolean;
  customers: { contacted: number; identified: number; unidentified: number; new: number; returning: number };
  paying: { customers: number; payments: number; share: number | null };
  revenue: {
    verified: { total: Money[]; byProvider: Money[]; byTeam: Money[]; throughChats: Money[]; fromYourBookings: Money[] };
    expected: { payOnDeliveryDelivered: Count; dueAtTheProperty: Count; requestsMarkedWon: number };
  };
  interest: Array<{ name: string; kind: "item" | "room" | "service"; asked: number; bought: number }>;
  notConverted: Array<{ at: string; kind: "request" | "booking" | "order"; customer: string | null; customerId: string | null; what: string; why: string; value: Money | null }>;
  lost: { lapsedOrders: Count; lapsedBookings: Count; declined: Count; unansweredHandoffs: number; requestsNotFollowedUp: number; unansweredQuestions: number; browsedAndLeft: number };
  questions: Array<{ question: string; chats: number; zainaCouldntAnswer: boolean }>;
  timeSaved: { minutes: number; chatsWithoutTeam: number; bookingsAndOrders: number; automaticUpdates: number; assumptions: typeof TIME_SAVED };
  lastMonth: { contacted: number; payingCustomers: number; verified: Money[] } | null;
};

/** Adds up amounts per currency. */
export function totals(rows: Array<{ currency: string; minor: number | string }>): Money[] {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.currency, (sums.get(row.currency) ?? 0) + Number(row.minor));
  return [...sums].filter(([, minor]) => minor !== 0).sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => ({ currency, minor, display: formatMoney(minor, currency) }));
}

/** "2026-11" for the month containing `now` in the business's time zone. */
export function monthOf(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}
export function previousMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
}
const nextMonth = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
};
export const validMonth = (value: unknown): value is string => typeof value === "string" && /^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(value);
export const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const WHY: Record<string, string> = {
  "request:lost": "Your team marked it not going ahead",
  "request:new": "Not followed up yet",
  "request:contacted": "Contacted, not won yet",
  "booking:expired": "Not paid in time",
  "booking:declined": "You declined it",
  "booking:cancelled": "Cancelled",
  "order:expired": "Not paid in time",
  "order:cancelled": "Declined or cancelled",
};

async function bounds(client: Client, month: string, timeZone: string, now: Date) {
  const { rows: [row] } = await client.query<{ from: Date; to: Date }>(
    `select ($1::timestamp at time zone $3) as "from", ($2::timestamp at time zone $3) as "to"`, [`${month}-01 00:00`, `${nextMonth(month)}-01 00:00`, timeZone]);
  const partial = row.to > now;
  return { from: row.from, to: partial ? now : row.to, partial };
}

/** Who got in touch, and who paid: the core numbers, also used for last month's comparison. */
async function core(client: Client, businessId: string, from: Date, to: Date) {
  const range = [businessId, from, to];
  const { rows: [chats] } = await client.query<{ chats: number; identified: number; unidentified: number; without_team: number; new_customers: number }>(
    `with active as (
       select s.id, s.customer_id, s.first_handoff_at from chat_sessions s
       where s.business_id = $1 and not s.preview
         and exists (select 1 from chat_events e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'USER' and e.created_at >= $2 and e.created_at < $3)
     )
     select count(*)::int as chats, count(distinct customer_id)::int as identified, count(*) filter (where customer_id is null)::int as unidentified,
            count(*) filter (where first_handoff_at is null)::int as without_team,
            (select count(*)::int from customers c where c.business_id = $1 and c.first_seen_at >= $2 and c.id in (select customer_id from active)) as new_customers
     from active`, range);
  const { rows: payments } = await client.query<{ method: string; currency: string; minor: string; payer: string; via_chat: boolean }>(
    `select p.method, p.currency, p.amount_minor as minor,
            coalesce(coalesce(b.customer_id, o.customer_id)::text, 'record:' || coalesce(p.booking_id, p.order_id)::text) as payer,
            coalesce(b.session_id, o.session_id) is not null as via_chat
     from payments p
     left join bookings b on b.business_id = p.business_id and b.id = p.booking_id
     left join orders o on o.business_id = p.business_id and o.id = p.order_id
     where p.business_id = $1 and p.status = 'succeeded' and p.settled_at >= $2 and p.settled_at < $3`, range);
  return { chats, payments };
}

export async function performanceReport(business: Business, month: string, now = new Date()): Promise<PerformanceReport> {
  const timeZone = business.timeZone;
  return inBusiness(async (_db, client) => {
    const { from, to, partial } = await bounds(client, month, timeZone, now);
    const range = [business.id, from, to];
    const { chats, payments } = await core(client, business.id, from, to);

    // ── Revenue: verified (settled payments) and expected (nobody has confirmed it) ──
    const provider = payments.filter((payment) => payment.method === "paystack" || payment.method === "mpesa_express");
    const team = payments.filter((payment) => !(payment.method === "paystack" || payment.method === "mpesa_express"));
    const payers = new Set(payments.map((payment) => payment.payer));
    const { rows: onDelivery } = await client.query<{ currency: string; minor: string }>(
      `select currency, total_minor - paid_minor as minor from orders
       where business_id = $1 and status = 'completed' and pay_on_delivery and total_minor > paid_minor and completed_at >= $2 and completed_at < $3`, range);
    const { rows: atProperty } = await client.query<{ currency: string; minor: string }>(
      `select currency, total_minor - paid_minor as minor from bookings
       where business_id = $1 and status = 'confirmed' and total_minor > paid_minor
         and coalesce(starts_at, check_in::timestamp at time zone $4) >= $2 and coalesce(starts_at, check_in::timestamp at time zone $4) < $3`, [...range, timeZone]);
    const { rows: [won] } = await client.query<{ count: number }>(
      "select count(*)::int as count from leads where business_id = $1 and status = 'won' and updated_at >= $2 and updated_at < $3", range);

    // ── Interest: asked about (distinct chats) and booked or ordered ──
    const { rows: asked } = await client.query<{ key: string; name: string; kind: "item" | "room" | "service"; chats: number }>(
      `select lower(name) as key, min(name) as name, min(kind) as kind, count(distinct session_id)::int as chats from (
         select e.session_id, 'item' as kind, e.tool_response->'items'->0->>'name' as name from chat_events e
           where e.business_id = $1 and e.tool_name = 'get_prices' and e.created_at >= $2 and e.created_at < $3
         union all
         select e.session_id, 'room', e.tool_arguments->>'room_type' from chat_events e
           where e.business_id = $1 and e.tool_name in ('check_availability', 'create_booking') and e.created_at >= $2 and e.created_at < $3
         union all
         select e.session_id, 'service', e.tool_arguments->>'service' from chat_events e
           where e.business_id = $1 and e.tool_name in ('check_times', 'create_appointment') and e.created_at >= $2 and e.created_at < $3
       ) t where coalesce(btrim(name), '') <> '' group by lower(name)`, range);
    const { rows: bought } = await client.query<{ key: string; name: string; kind: "item" | "room"; n: number }>(
      `select lower(line->>'name') as key, min(line->>'name') as name, 'item' as kind, count(distinct o.id)::int as n
       from orders o cross join jsonb_array_elements(o.lines) as line
       where o.business_id = $1 and o.created_at >= $2 and o.created_at < $3 and o.status in ('confirmed', 'out_for_delivery', 'ready_for_collection', 'completed')
       group by lower(line->>'name')
       union all
       select lower(f.name), min(f.name), 'room', count(*)::int from bookings b join offerings f on f.business_id = b.business_id and f.id = b.offering_id
       where b.business_id = $1 and b.created_at >= $2 and b.created_at < $3 and b.status = 'confirmed' group by lower(f.name)`, range);
    const interest = new Map<string, PerformanceReport["interest"][number]>();
    for (const row of asked) interest.set(row.key, { name: row.name, kind: row.kind, asked: row.chats, bought: 0 });
    for (const row of bought) {
      const entry = interest.get(row.key) ?? { name: row.name, kind: row.kind, asked: 0, bought: 0 };
      entry.bought += row.n;
      interest.set(row.key, entry);
    }

    // ── Not converted, and why ──
    const { rows: unconverted } = await client.query<{ kind: "request" | "booking" | "order"; at: Date; customer: string | null; customer_id: string | null; what: string; status: string; currency: string | null; minor: string | null }>(
      `select * from (
         select 'request' as kind, l.created_at as at, l.name as customer, l.customer_id::text, coalesce(l.interest, 'Left their details') as what, l.status, null::text as currency, null::bigint as minor
         from leads l where l.business_id = $1 and l.created_at >= $2 and l.created_at < $3
           and (l.status = 'lost' or (l.status in ('new', 'contacted') and l.created_at < now() - interval '3 days'))
         union all
         select 'booking', b.created_at, b.customer_name, b.customer_id::text, coalesce(f.name, 'Booking') || ' (' || b.reference || ')', b.status, b.currency, b.total_minor
         from bookings b left join offerings f on f.business_id = b.business_id and f.id = b.offering_id
         where b.business_id = $1 and b.created_at >= $2 and b.created_at < $3 and b.status in ('expired', 'declined', 'cancelled')
         union all
         select 'order', o.created_at, o.customer_name, o.customer_id::text,
                (select string_agg((line->>'quantity') || ' × ' || (line->>'name'), ', ') from jsonb_array_elements(o.lines) as line) || ' (' || o.reference || ')',
                o.status, o.currency, o.total_minor
         from orders o where o.business_id = $1 and o.created_at >= $2 and o.created_at < $3 and o.status in ('expired', 'cancelled') and o.confirmed_at is null
       ) t order by at desc limit 20`, range);

    // ── Lost opportunities ──
    const sum = async (sql: string) => {
      const { rows } = await client.query<{ currency: string; minor: string }>(sql, range);
      return { count: rows.length, value: totals(rows) };
    };
    const lapsedOrders = await sum("select currency, total_minor as minor from orders where business_id = $1 and status = 'expired' and created_at >= $2 and created_at < $3");
    const lapsedBookings = await sum("select currency, total_minor as minor from bookings where business_id = $1 and status = 'expired' and created_at >= $2 and created_at < $3");
    const declined = await sum(
      `select currency, total_minor as minor from bookings where business_id = $1 and status = 'declined' and created_at >= $2 and created_at < $3
       union all select currency, total_minor from orders where business_id = $1 and status = 'cancelled' and confirmed_at is null and created_at >= $2 and created_at < $3`);
    const { rows: [lostCounts] } = await client.query<{ handoffs: number; not_followed: number; misses: number; browsed: number }>(
      `select
         (select count(*)::int from chat_sessions s where s.business_id = $1 and not s.preview and s.first_handoff_at >= $2 and s.first_handoff_at < $3
            and not exists (select 1 from chat_events e where e.business_id = s.business_id and e.session_id = s.id and e.actor = 'AGENT' and e.created_at >= s.first_handoff_at)) as handoffs,
         (select count(*)::int from leads where business_id = $1 and status = 'new' and created_at >= $2 and created_at < $3 and created_at < now() - interval '2 days') as not_followed,
         (select count(*)::int from knowledge_misses where business_id = $1 and created_at >= $2 and created_at < $3) as misses,
         (select count(*)::int from chat_sessions s where s.business_id = $1 and not s.preview and s.created_at >= $2 and s.created_at < $3 and s.first_handoff_at is null
            and exists (select 1 from chat_events e where e.business_id = s.business_id and e.session_id = s.id and e.tool_name = any($4::text[]))
            and not exists (select 1 from leads l where l.business_id = s.business_id and l.session_id = s.id)
            and not exists (select 1 from bookings b where b.business_id = s.business_id and b.session_id = s.id)
            and not exists (select 1 from orders o where o.business_id = s.business_id and o.session_id = s.id)) as browsed`,
      [...range, CATALOGUE_TOOLS]);

    // ── Questions asked again and again ──
    const { rows: questions } = await client.query<{ question: string; chats: number; missed: boolean }>(
      `select min(q) as question, count(distinct session_id)::int as chats, bool_or(missed) as missed from (
         select e.session_id, btrim(e.tool_arguments->>'query') as q, false as missed from chat_events e
           where e.business_id = $1 and e.tool_name = 'search_knowledge' and e.created_at >= $2 and e.created_at < $3
         union all
         select m.session_id, btrim(m.query), true from knowledge_misses m where m.business_id = $1 and m.created_at >= $2 and m.created_at < $3
       ) t where coalesce(q, '') <> ''
       group by btrim(regexp_replace(lower(q), '[^a-z0-9 ]+', ' ', 'g'))
       having count(distinct session_id) >= 2
       order by count(distinct session_id) desc, min(q) limit 10`, range);

    // ── Time saved (an estimate) ──
    const { rows: [handled] } = await client.query<{ records: number; updates: number }>(
      `select
         (select count(*)::int from bookings where business_id = $1 and source = 'chat' and status = 'confirmed' and decided_by is null and confirmed_at >= $2 and confirmed_at < $3)
         + (select count(*)::int from orders where business_id = $1 and session_id is not null and confirmed_at >= $2 and confirmed_at < $3) as records,
         (select count(*)::int from chat_events where business_id = $1 and actor = 'ZAINA_REASONING' and created_at >= $2 and created_at < $3) as updates`, range);
    const minutes = chats.without_team * TIME_SAVED.minutesPerChat + handled.records * TIME_SAVED.minutesPerBookingOrOrder + handled.updates * TIME_SAVED.minutesPerUpdate;

    // ── Last month, for comparison ──
    const before = await bounds(client, previousMonth(month), timeZone, now);
    const last = await core(client, business.id, before.from, before.to);

    const contacted = chats.identified + chats.unidentified;
    return {
      month,
      from: from.toISOString(),
      to: to.toISOString(),
      partial,
      customers: { contacted, identified: chats.identified, unidentified: chats.unidentified, new: chats.new_customers, returning: chats.identified - chats.new_customers },
      paying: { customers: payers.size, payments: payments.length, share: contacted ? Math.round((payers.size / contacted) * 1000) / 10 : null },
      revenue: {
        verified: {
          total: totals(payments),
          byProvider: totals(provider),
          byTeam: totals(team),
          throughChats: totals(payments.filter((payment) => payment.via_chat)),
          fromYourBookings: totals(payments.filter((payment) => !payment.via_chat)),
        },
        expected: {
          payOnDeliveryDelivered: { count: onDelivery.length, value: totals(onDelivery) },
          dueAtTheProperty: { count: atProperty.length, value: totals(atProperty) },
          requestsMarkedWon: won.count,
        },
      },
      interest: [...interest.values()].sort((a, b) => b.asked + b.bought - (a.asked + a.bought) || a.name.localeCompare(b.name)).slice(0, 10),
      notConverted: unconverted.map((row) => ({
        at: row.at.toISOString(), kind: row.kind, customer: row.customer, customerId: row.customer_id, what: row.what,
        why: WHY[`${row.kind}:${row.status}`] ?? row.status, value: row.currency && row.minor !== null ? totals([{ currency: row.currency, minor: row.minor }])[0] ?? null : null,
      })),
      lost: {
        lapsedOrders, lapsedBookings, declined,
        unansweredHandoffs: lostCounts.handoffs, requestsNotFollowedUp: lostCounts.not_followed, unansweredQuestions: lostCounts.misses, browsedAndLeft: lostCounts.browsed,
      },
      questions: questions.map((row) => ({ question: row.question, chats: row.chats, zainaCouldntAnswer: row.missed })),
      timeSaved: { minutes, chatsWithoutTeam: chats.without_team, bookingsAndOrders: handled.records, automaticUpdates: handled.updates, assumptions: TIME_SAVED },
      lastMonth: { contacted: last.chats.identified + last.chats.unidentified, payingCustomers: new Set(last.payments.map((payment) => payment.payer)).size, verified: totals(last.payments) },
    };
  }, business.id);
}

const money = (list: Money[]) => (list.length ? list.map((entry) => entry.display).join(" + ") : "none");
const hours = (minutes: number) => (minutes >= 90 ? `about ${Math.round(minutes / 60)} hours` : `about ${minutes} minutes`);

/** The email: the month in a few lines, the full report in the dashboard. */
export function reportEmail(report: PerformanceReport, businessName: string, link: string): { subject: string; text: string } {
  const r = report;
  const lines = [
    `${businessName}: ${monthName(r.month)} with Zaina`,
    "",
    `People who got in touch: ${r.customers.contacted} (${r.customers.new} new, ${r.customers.returning} returning${r.customers.unidentified ? `, ${r.customers.unidentified} chats without contact details` : ""})${r.lastMonth ? `. Last month: ${r.lastMonth.contacted}.` : "."}`,
    `Paying customers: ${r.paying.customers}${r.paying.share !== null ? ` (${r.paying.share}% of those who got in touch)` : ""}.`,
    "",
    `VERIFIED revenue (payments that settled): ${money(r.revenue.verified.total)}`,
    `  confirmed by Paystack or M-Pesa: ${money(r.revenue.verified.byProvider)}`,
    `  recorded by your team (M-Pesa codes, cash, bank): ${money(r.revenue.verified.byTeam)}`,
    `  from bookings and orders made in Zaina's chats: ${money(r.revenue.verified.throughChats)}`,
    "",
    "EXPECTED, not verified (nobody has confirmed the money):",
    `  pay-on-delivery orders marked delivered: ${r.revenue.expected.payOnDeliveryDelivered.count} (${money(r.revenue.expected.payOnDeliveryDelivered.value)})`,
    `  balances due at the property: ${r.revenue.expected.dueAtTheProperty.count} (${money(r.revenue.expected.dueAtTheProperty.value)})`,
    `  requests your team marked won: ${r.revenue.expected.requestsMarkedWon}`,
    "",
    `Most asked about: ${r.interest.slice(0, 5).map((entry) => `${entry.name} (${entry.asked} chats, ${entry.bought} sold)`).join("; ") || "nothing yet"}.`,
    `Slipped away: ${r.lost.lapsedOrders.count + r.lost.lapsedBookings.count} unpaid (${money(totals([...r.lost.lapsedOrders.value, ...r.lost.lapsedBookings.value].map((entry) => ({ currency: entry.currency, minor: entry.minor }))))}), ${r.lost.declined.count} declined, ${r.lost.unansweredHandoffs} chats handed to your team with no reply, ${r.lost.requestsNotFollowedUp} requests not followed up.`,
    r.questions.length ? `Asked again and again: ${r.questions.slice(0, 3).map((entry) => `"${entry.question}"${entry.zainaCouldntAnswer ? " (Zaina couldn't answer: teach her)" : ""}`).join("; ")}.` : "",
    `Time saved (estimate): ${hours(r.timeSaved.minutes)}.`,
    "",
    `The full report, with what didn't convert and why: ${link}`,
  ];
  return { subject: `${monthName(r.month)} with Zaina: ${r.customers.contacted} people, ${money(r.revenue.verified.total)} verified`, text: lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n") };
}

/**
 * The month whose report is due now, if any: last month's, from 07:00 on the
 * 1st in the business's time until the 7th (in case the service was down on
 * the 1st), for a business that was already there last month.
 */
export function reportDue(now: Date, timeZone: string, createdAt: Date): string | null {
  const local = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const day = Number(local.find((part) => part.type === "day")!.value);
  const hour = Number(local.find((part) => part.type === "hour")!.value);
  const month = previousMonth(monthOf(now, timeZone));
  if (day > 7 || (day === 1 && hour < 7) || monthOf(createdAt, timeZone) > month) return null;
  return month;
}

/**
 * Early on the 1st (from 07:00 in the business's time), last month's report
 * goes to its owners and managers, once.
 */
export async function sendMonthlyReports(now = new Date(), baseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ?? ""): Promise<number> {
  let sent = 0;
  for (const business of await everyBusiness()) {
    if (business.status !== "active" || business.businessType === "custom") continue;
    const month = reportDue(now, business.timeZone, business.createdAt);
    if (!month) continue;
    let claimed = false;
    try {
      claimed = Boolean(await inBusiness(async (_db, client) => (await client.query(
        "insert into performance_reports (business_id, month, report) values ($1, $2, '{}'::jsonb) on conflict do nothing returning month", [business.id, month])).rowCount, business.id));
      if (!claimed) continue;
      const report = await performanceReport(business, month, now);
      const settings = await getBusinessSettings(business.id);
      const email = reportEmail(report, settings?.displayName ?? business.name, `${baseUrl}/app/#/b/${encodeURIComponent(business.id)}/reports/${month}`);
      const people = await inBusiness(async (_db, client) => (await client.query<{ email: string }>(
        `select u.email from staff_memberships m join staff_users u on u.id = m.user_id
         where m.business_id = $1 and m.role in ('owner', 'manager') and u.disabled_at is null`, [business.id])).rows, business.id);
      let delivered = 0;
      if (mailerConfigured()) for (const person of people) if (await sendEmail({ to: person.email, subject: email.subject, text: email.text })) delivered += 1;
      await inBusiness((_db, client) => client.query("update performance_reports set report = $3, sent_to = $4 where business_id = $1 and month = $2", [business.id, month, JSON.stringify(report), delivered]), business.id);
      sent += 1;
    } catch (error) {
      console.error(`[reports] ${business.id}: the ${month} performance report failed:`, error);
      // Tried again on the next run.
      if (claimed) await inBusiness((_db, client) => client.query("delete from performance_reports where business_id = $1 and month = $2 and sent_to = 0", [business.id, month]), business.id).catch(() => {});
    }
  }
  return sent;
}

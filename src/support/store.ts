// src/support/store.ts
//
// Support between a business's team and the studio (migration 0017). A
// thread belongs to one business; each message is from the business's side
// or the studio's. These are the platform's own rows: only the owner
// connection reads or writes them, and every query for a business names it.
//
//   open      the studio owes an answer (a new thread, or the business wrote last)
//   answered  the studio replied
//   closed    done; a new message from either side reopens it

import { ownerPool } from "../db/platform-db.ts";

export const supportTopics = ["question", "problem", "billing", "setup", "idea"] as const;
export type SupportTopic = (typeof supportTopics)[number];
export const topicLabels: Record<SupportTopic, string> = {
  question: "A question",
  problem: "Something isn't working",
  billing: "Plan or billing",
  setup: "Help setting up",
  idea: "An idea or request",
};
export type SupportStatus = "open" | "answered" | "closed";

export type SupportThread = {
  id: string;
  businessId: string;
  businessName: string;
  subject: string;
  topic: SupportTopic;
  status: SupportStatus;
  openedByName: string | null;
  createdAt: Date;
  lastMessageAt: Date;
  /** The latest message, shortened, and which side wrote it. */
  preview: string | null;
  lastFromStudio: boolean | null;
  /** Unread for the business (the studio wrote since it last looked), and for the studio. */
  unreadForBusiness: boolean;
  unreadForStudio: boolean;
};

export type SupportMessage = { id: number; fromStudio: boolean; authorName: string | null; body: string; createdAt: Date };

export class SupportError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const THREAD = `t.id, t.business_id as "businessId", b.name as "businessName", t.subject, t.topic, t.status,
  opener.name as "openedByName", t.created_at as "createdAt", t.last_message_at as "lastMessageAt",
  last.body as preview, last.from_studio as "lastFromStudio",
  coalesce(last.from_studio and (t.business_read_at is null or t.business_read_at < last.created_at), false) as "unreadForBusiness",
  coalesce(not last.from_studio and (t.studio_read_at is null or t.studio_read_at < last.created_at), false) as "unreadForStudio"`;
const FROM = `from support_threads t
  join businesses b on b.id = t.business_id
  left join staff_users opener on opener.id = t.opened_by
  left join lateral (select left(m.body, 160) as body, m.from_studio, m.created_at from support_messages m where m.thread_id = t.id order by m.id desc limit 1) last on true`;

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "");

/** What someone typed for a new thread. */
export function validateNewThread(body: any): { ok: true; value: { subject: string; topic: SupportTopic; message: string } } | { ok: false; message: string } {
  const subject = clean(body?.subject).replace(/\s+/g, " ");
  const message = clean(body?.message);
  const topic = (body?.topic ?? "question") as SupportTopic;
  if (subject.length < 3 || subject.length > 160) return { ok: false, message: "Give it a short subject (3 to 160 characters)." };
  if (!supportTopics.includes(topic)) return { ok: false, message: `The topic is one of ${supportTopics.join(", ")}.` };
  if (message.length < 1 || message.length > 5000) return { ok: false, message: "Write your message (up to 5,000 characters)." };
  return { ok: true, value: { subject, topic, message } };
}

export function validateMessage(body: any): string | null {
  const message = clean(body?.message);
  return message.length >= 1 && message.length <= 5000 ? message : null;
}

export async function openThread(businessId: string, authorId: string, input: { subject: string; topic: SupportTopic; message: string }): Promise<SupportThread> {
  const client = await ownerPool().connect();
  try {
    await client.query("begin");
    const { rows: [thread] } = await client.query<{ id: string }>(
      "insert into support_threads (business_id, subject, topic, opened_by, business_read_at) values ($1, $2, $3, $4, now()) returning id",
      [businessId, input.subject, input.topic, authorId],
    );
    await client.query("insert into support_messages (thread_id, author_id, from_studio, body) values ($1, $2, false, $3)", [thread.id, authorId, input.message]);
    await client.query("commit");
    return (await threadById(thread.id))!;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function threadById(id: string): Promise<SupportThread | null> {
  const { rows } = await ownerPool().query<SupportThread>(`select ${THREAD} ${FROM} where t.id = $1`, [id]);
  return rows[0] ?? null;
}

/** A business's threads, newest activity first. */
export async function threadsOf(businessId: string): Promise<SupportThread[]> {
  const { rows } = await ownerPool().query<SupportThread>(`select ${THREAD} ${FROM} where t.business_id = $1 order by t.last_message_at desc limit 200`, [businessId]);
  return rows;
}

/** Every business's threads, for the studio: those waiting for an answer first. */
export async function allThreads(status: SupportStatus | "all"): Promise<SupportThread[]> {
  const { rows } = await ownerPool().query<SupportThread>(
    `select ${THREAD} ${FROM} where ($1 = 'all' or t.status = $1)
     order by (t.status = 'open') desc, t.last_message_at desc limit 300`,
    [status],
  );
  return rows;
}

export async function messagesOf(threadId: string): Promise<SupportMessage[]> {
  const { rows } = await ownerPool().query<SupportMessage>(
    `select m.id::int as id, m.from_studio as "fromStudio", u.name as "authorName", m.body, m.created_at as "createdAt"
     from support_messages m left join staff_users u on u.id = m.author_id where m.thread_id = $1 order by m.id`,
    [threadId],
  );
  return rows;
}

/** Adds a message. From the business it (re)opens the thread; from the studio it marks it answered. */
export async function addMessage(threadId: string, authorId: string, fromStudio: boolean, body: string): Promise<SupportThread> {
  const { rowCount } = await ownerPool().query(
    `with added as (insert into support_messages (thread_id, author_id, from_studio, body) values ($1, $2, $3, $4) returning created_at)
     update support_threads set status = $5, closed_at = null, last_message_at = (select created_at from added),
       business_read_at = case when $3 then business_read_at else (select created_at from added) end,
       studio_read_at = case when $3 then (select created_at from added) else studio_read_at end
     where id = $1`,
    [threadId, authorId, fromStudio, body, fromStudio ? "answered" : "open"],
  );
  if (!rowCount) throw new SupportError(404, "not_found", "That conversation wasn't found.");
  return (await threadById(threadId))!;
}

export async function markRead(threadId: string, side: "business" | "studio"): Promise<void> {
  await ownerPool().query(`update support_threads set ${side === "business" ? "business_read_at" : "studio_read_at"} = now() where id = $1`, [threadId]);
}

export async function setClosed(threadId: string, closed: boolean): Promise<SupportThread> {
  const { rowCount } = await ownerPool().query(
    closed
      ? "update support_threads set status = 'closed', closed_at = now() where id = $1"
      : "update support_threads set status = 'open', closed_at = null where id = $1",
    [threadId],
  );
  if (!rowCount) throw new SupportError(404, "not_found", "That conversation wasn't found.");
  return (await threadById(threadId))!;
}

/** How many of a business's threads have an answer it hasn't read. */
export async function unreadForBusiness(businessId: string): Promise<number> {
  const { rows: [row] } = await ownerPool().query<{ n: number }>(
    `select count(*)::int as n from support_threads t
     where t.business_id = $1 and exists (
       select 1 from support_messages m where m.thread_id = t.id and m.from_studio
         and (t.business_read_at is null or m.created_at > t.business_read_at))`,
    [businessId],
  );
  return row?.n ?? 0;
}

/** How many threads the studio owes an answer on. */
export async function openForStudio(): Promise<number> {
  const { rows: [row] } = await ownerPool().query<{ n: number }>("select count(*)::int as n from support_threads where status = 'open'");
  return row?.n ?? 0;
}

/** Who on the business's side has written in a thread (their emails): they hear about the studio's answer. */
export async function businessSideEmails(threadId: string): Promise<string[]> {
  const { rows } = await ownerPool().query<{ email: string }>(
    `select distinct u.email from staff_users u where u.id in (
       select opened_by from support_threads where id = $1
       union select author_id from support_messages where thread_id = $1 and not from_studio)`,
    [threadId],
  );
  return rows.map((row) => row.email);
}

/** The studio's own people: they hear about a business's message when no address is set for that. */
export async function platformAdminEmails(): Promise<string[]> {
  const { rows } = await ownerPool().query<{ email: string }>("select email from staff_users where is_platform_admin order by created_at limit 10");
  return rows.map((row) => row.email);
}

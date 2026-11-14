// src/support/routes.ts
//
// Support, both sides.
//
// A business's team (/v1/staff/businesses/:businessId/…):
//   GET  support                       viewer  its conversations with the studio, and how else to reach it
//   POST support                       agent   { subject, topic?, message } → a new conversation
//   GET  support/:threadId             viewer  the conversation (and marks it read)
//   POST support/:threadId/messages    agent   { message }: reopens it if it was closed
//   POST support/:threadId/close       agent   it's sorted
//
// The studio's own team:
//   GET  /v1/platform/support?status=open|answered|closed|all   every business's conversations
//   GET  /v1/platform/support/:threadId                         one (and marks it read)
//   POST /v1/platform/support/:threadId/messages                { message, close? }
//   POST /v1/platform/support/:threadId/close | reopen
//   GET  /v1/platform/attention                                 what needs the studio: support, project requests, invoices
//
// Each side hears about the other's message by email (when email is set up).

import type { Express, NextFunction, Request, Response } from "express";
import type { PlatformConfig } from "../config.ts";
import { inBusiness, runForBusiness } from "../db/tenant.ts";
import { ownerPool } from "../db/platform-db.ts";
import { sendEmail } from "../platform/mailer.ts";
import { requireBusinessRole, requirePlatformAdmin, requireStaff, staffOf } from "../staff/auth.ts";
import { STUDIO, whatsappLink } from "../studio/brand.ts";
import {
  addMessage,
  allThreads,
  businessSideEmails,
  markRead,
  messagesOf,
  openForStudio,
  openThread,
  platformAdminEmails,
  setClosed,
  SupportError,
  supportTopics,
  threadById,
  threadsOf,
  topicLabels,
  unreadForBusiness,
  validateMessage,
  validateNewThread,
  type SupportMessage,
  type SupportStatus,
  type SupportThread,
} from "./store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const threadJson = (thread: SupportThread, side: "business" | "studio") => ({
  id: thread.id,
  business_id: thread.businessId,
  business_name: thread.businessName,
  subject: thread.subject,
  topic: thread.topic,
  topic_label: topicLabels[thread.topic],
  status: thread.status,
  opened_by: thread.openedByName,
  created_at: thread.createdAt,
  last_message_at: thread.lastMessageAt,
  preview: thread.preview,
  last_from_studio: thread.lastFromStudio,
  unread: side === "business" ? thread.unreadForBusiness : thread.unreadForStudio,
});
const messageJson = (message: SupportMessage) => ({
  id: message.id,
  from_studio: message.fromStudio,
  author: message.fromStudio ? `${message.authorName ?? "The team"} · ${STUDIO.name}` : message.authorName ?? "Someone on your team",
  body: message.body,
  created_at: message.createdAt,
});

export function registerSupportRoutes(app: Express, config: PlatformConfig): void {
  const staff = requireStaff(config.sessionTokenSecret);
  const base = "/v1/staff/businesses/:businessId/support";
  const handle = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof SupportError) return void res.status(error.status).json({ error: error.code, message: error.message });
      next(error);
    }
  };

  /** The studio hears about a business's message: at STUDIO_NOTIFY_EMAIL, or its admins' own addresses. */
  async function tellStudio(thread: SupportThread, body: string, author: string) {
    const to = config.studioNotifyEmail ? [config.studioNotifyEmail] : await platformAdminEmails();
    const link = config.publicBaseUrl ? `\n\nAnswer it: ${config.publicBaseUrl}/app/#/platform/support/${thread.id}` : "";
    for (const address of to) {
      await sendEmail({ to: address, subject: `Support · ${thread.businessName}: ${thread.subject}`, text: `${author} (${thread.businessName}) wrote:\n\n${body}${link}` });
    }
  }
  /** The business's people in the conversation hear about the studio's answer. */
  async function tellBusiness(thread: SupportThread, body: string) {
    const link = config.publicBaseUrl ? `\n\nRead and reply: ${config.publicBaseUrl}/app/#/b/${encodeURIComponent(thread.businessId)}/support/${thread.id}` : "";
    for (const address of await businessSideEmails(thread.id)) {
      await sendEmail({ to: address, subject: `${STUDIO.name} replied: ${thread.subject}`, text: `${body}${link}\n\n${STUDIO.name} support` });
    }
  }
  const later = (work: Promise<unknown>) => void work.catch((error) => console.error("[support] email failed:", error));

  /** A business's own thread, or 404: a thread id from another business finds nothing. */
  async function ownThread(req: Request): Promise<SupportThread> {
    const id = String(req.params.threadId ?? "");
    const thread = UUID.test(id) ? await threadById(id) : null;
    if (!thread || thread.businessId !== staffOf(req).business!.id) throw new SupportError(404, "not_found", "That conversation wasn't found.");
    return thread;
  }

  // ── A business's team ────────────────────────────────────────────────
  app.get(base, staff, requireBusinessRole("viewer"), handle(async (req, res) => {
    const business = staffOf(req).business!;
    res.json({
      threads: (await threadsOf(business.id)).map((thread) => threadJson(thread, "business")),
      topics: supportTopics.map((id) => ({ id, label: topicLabels[id] })),
      unread: await unreadForBusiness(business.id),
      // Other ways to reach the studio, for something urgent.
      contact: {
        whatsapp: STUDIO.phoneDisplay,
        whatsapp_link: whatsappLink(`Hello Bila Matata, I need help with Zaina for ${business.name}.`),
        email: STUDIO.email,
        hours: "Monday to Saturday, 8 am to 6 pm (East Africa Time)",
      },
    });
  }));

  app.post(base, staff, requireBusinessRole("agent"), handle(async (req, res) => {
    const checked = validateNewThread(req.body);
    if (!checked.ok) return res.status(400).json({ error: "invalid_request", message: checked.message });
    const { business, user } = staffOf(req);
    const thread = await openThread(business!.id, user.id, checked.value);
    later(tellStudio(thread, checked.value.message, user.name));
    res.status(201).json({ thread: threadJson(thread, "business") });
  }));

  app.get(`${base}/:threadId`, staff, requireBusinessRole("viewer"), handle(async (req, res) => {
    const thread = await ownThread(req);
    await markRead(thread.id, "business");
    res.json({ thread: { ...threadJson(thread, "business"), unread: false }, messages: (await messagesOf(thread.id)).map(messageJson) });
  }));

  app.post(`${base}/:threadId/messages`, staff, requireBusinessRole("agent"), handle(async (req, res) => {
    const thread = await ownThread(req);
    const message = validateMessage(req.body);
    if (!message) return res.status(400).json({ error: "invalid_message", message: "Write your message (up to 5,000 characters)." });
    const updated = await addMessage(thread.id, staffOf(req).user.id, false, message);
    later(tellStudio(updated, message, staffOf(req).user.name));
    res.status(201).json({ thread: threadJson(updated, "business"), messages: (await messagesOf(thread.id)).map(messageJson) });
  }));

  app.post(`${base}/:threadId/close`, staff, requireBusinessRole("agent"), handle(async (req, res) => {
    const thread = await ownThread(req);
    res.json({ thread: threadJson(await setClosed(thread.id, true), "business") });
  }));

  // ── The studio ───────────────────────────────────────────────────────
  const anyThread = async (req: Request): Promise<SupportThread> => {
    const id = String(req.params.threadId ?? "");
    const thread = UUID.test(id) ? await threadById(id) : null;
    if (!thread) throw new SupportError(404, "not_found", "That conversation wasn't found.");
    return thread;
  };

  app.get("/v1/platform/support", staff, requirePlatformAdmin, handle(async (req, res) => {
    const status = ["open", "answered", "closed", "all"].includes(String(req.query.status)) ? (String(req.query.status) as SupportStatus | "all") : "all";
    res.json({ threads: (await allThreads(status)).map((thread) => threadJson(thread, "studio")), open: await openForStudio() });
  }));

  app.get("/v1/platform/support/:threadId", staff, requirePlatformAdmin, handle(async (req, res) => {
    const thread = await anyThread(req);
    await markRead(thread.id, "studio");
    res.json({ thread: { ...threadJson(thread, "studio"), unread: false }, messages: (await messagesOf(thread.id)).map(messageJson) });
  }));

  app.post("/v1/platform/support/:threadId/messages", staff, requirePlatformAdmin, handle(async (req, res) => {
    const thread = await anyThread(req);
    const message = validateMessage(req.body);
    if (!message) return res.status(400).json({ error: "invalid_message", message: "Write your reply (up to 5,000 characters)." });
    let updated = await addMessage(thread.id, staffOf(req).user.id, true, message);
    if (req.body?.close === true) updated = await setClosed(thread.id, true);
    later(tellBusiness(updated, message));
    res.status(201).json({ thread: threadJson(updated, "studio"), messages: (await messagesOf(thread.id)).map(messageJson) });
  }));

  app.post("/v1/platform/support/:threadId/:action(close|reopen)", staff, requirePlatformAdmin, handle(async (req, res) => {
    const thread = await anyThread(req);
    res.json({ thread: threadJson(await setClosed(thread.id, req.params.action === "close"), "studio") });
  }));

  // What needs the studio's attention, in one look.
  app.get("/v1/platform/attention", staff, requirePlatformAdmin, handle(async (_req, res) => {
    const [support, invoices, requests, waiting] = await Promise.all([
      openForStudio(),
      ownerPool().query<{ n: number }>("select count(*)::int as n from studio_invoices where status = 'open'"),
      runForBusiness(STUDIO.businessId, () => inBusiness((_db, client) => client.query<{ n: number }>(
        "select count(*)::int as n from leads where business_id = $1 and status = 'new'", [STUDIO.businessId],
      ), STUDIO.businessId)).catch(() => ({ rows: [{ n: 0 }] })),
      runForBusiness(STUDIO.businessId, () => inBusiness((_db, client) => client.query<{ n: number }>(
        "select count(*)::int as n from chat_sessions where business_id = $1 and managed_by = 'HUMAN' and assigned_agent_id is null", [STUDIO.businessId],
      ), STUDIO.businessId)).catch(() => ({ rows: [{ n: 0 }] })),
    ]);
    res.json({
      support_open: support,
      studio_invoices_open: invoices.rows[0]?.n ?? 0,
      project_requests_new: requests.rows[0]?.n ?? 0,
      site_chats_waiting: waiting.rows[0]?.n ?? 0,
      studio_business_id: STUDIO.businessId,
    });
  }));
}

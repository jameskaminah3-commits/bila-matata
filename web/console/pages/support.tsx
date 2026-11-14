// web/console/pages/support.tsx
//
// Help and support.
//
// For a business's team (SupportPage): how to do the everyday things (take
// over a chat, get alerts, find a past chat, add Zaina to a website), and
// conversations with the studio's team: ask, see the answer, reply.
//
// For the studio's team (PlatformSupport): every business's conversations,
// those waiting for an answer first; answer, close, reopen.
//
// Both use the same conversation view.

import { useEffect, useRef, useState } from "react";
import { api, businessPath } from "../api.ts";
import { go } from "../app.tsx";
import { timeAgo } from "../format.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, Tabs, useAction, useEvery, useLoad } from "../ui.tsx";

type Thread = {
  id: string;
  business_id: string;
  business_name: string;
  subject: string;
  topic: string;
  topic_label: string;
  status: "open" | "answered" | "closed";
  opened_by: string | null;
  created_at: string;
  last_message_at: string;
  preview: string | null;
  last_from_studio: boolean | null;
  unread: boolean;
};
type SupportMessage = { id: number; from_studio: boolean; author: string; body: string; created_at: string };
type BusinessSupport = {
  threads: Thread[];
  topics: Array<{ id: string; label: string }>;
  unread: number;
  contact: { whatsapp: string; whatsapp_link: string; email: string; hours: string };
};

/** How a thread stands, in each side's words. */
function statusChip(thread: Thread, side: "business" | "studio") {
  if (thread.status === "closed") return <span className="chip">Closed</span>;
  if (thread.status === "answered") return side === "business" ? <span className="chip ok">Answered</span> : <span className="chip">Answered</span>;
  return side === "business" ? <span className="chip waiting">We're on it</span> : <span className="chip waiting">Needs an answer</span>;
}

/** One conversation: its messages, a reply box, and closing it. */
function ThreadView(props: { path: string; side: "business" | "studio"; canWrite: boolean; onBack: () => void; onChanged: () => void }) {
  const loaded = useLoad(() => api<{ thread: Thread; messages: SupportMessage[] }>("GET", props.path), [props.path]);
  const [draft, setDraft] = useState("");
  const action = useAction();
  const end = useRef<HTMLDivElement | null>(null);
  useEvery(() => void loaded.reload(), 20_000, [props.path]);
  const count = loaded.data?.messages.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [count]);
  useEffect(() => { if (loaded.data) props.onChanged(); }, [loaded.data?.thread.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const thread = loaded.data?.thread;
  const send = (close: boolean) => action.run(async () => {
    await api("POST", `${props.path}/messages`, { message: draft, ...(close ? { close: true } : {}) });
    setDraft("");
    await loaded.reload();
    props.onChanged();
  });
  const setClosed = (closed: boolean) => action.run(async () => {
    await api("POST", `${props.path}/${closed ? "close" : "reopen"}`, {});
    await loaded.reload();
    props.onChanged();
  });
  return (
    <section className="support-thread">
      <div className="support-thread-head">
        <button type="button" className="link" onClick={props.onBack}><Icon name="back" size={15} /> All conversations</button>
        {thread ? (
          <div className="page-head">
            <h2>{thread.subject}</h2>
            <p className="muted">
              {props.side === "studio" ? <><strong>{thread.business_name}</strong> · </> : null}
              {thread.topic_label} · started {timeAgo(thread.created_at)}{thread.opened_by ? ` by ${thread.opened_by}` : ""} {statusChip(thread, props.side)}
            </p>
          </div>
        ) : null}
      </div>
      <ErrorLine error={loaded.error} />
      <div className="support-messages" aria-live="polite">
        {loaded.data?.messages.map((message) => {
          const mine = message.from_studio === (props.side === "studio");
          return (
            <div key={message.id} className={`bubble-row ${mine ? "team" : "customer"}`}>
              <span className="bubble-who">{message.author} · {timeAgo(message.created_at)}</span>
              <div className="bubble">{message.body}</div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {props.canWrite && thread ? (
        <form className="support-reply" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) void send(false); }}>
          <label className="sr-only" htmlFor="support-reply">Your message</label>
          <textarea id="support-reply" rows={3} maxLength={5000} placeholder={thread.status === "closed" ? "Write to reopen this conversation…" : "Write a reply…"} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <Message message={action.message} />
          <div className="actions">
            {thread.status !== "closed"
              ? <Button kind="ghost" busy={action.busy} onClick={() => void setClosed(true)}>{props.side === "business" ? "It's sorted: close" : "Close"}</Button>
              : props.side === "studio" ? <Button kind="ghost" busy={action.busy} onClick={() => void setClosed(false)}>Reopen</Button> : null}
            {props.side === "studio" && thread.status !== "closed" ? <Button busy={action.busy} disabled={!draft.trim()} onClick={() => void send(true)}>Send and close</Button> : null}
            <Button kind="primary" type="submit" busy={action.busy} disabled={!draft.trim()}><Icon name="send" size={15} /> Send</Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ThreadList(props: { threads: Thread[]; side: "business" | "studio"; onOpen: (thread: Thread) => void }) {
  return (
    <ul className="support-list">
      {props.threads.map((thread) => (
        <li key={thread.id}>
          <button type="button" className={`support-item${thread.unread ? " unread" : ""}`} onClick={() => props.onOpen(thread)}>
            <span className="support-item-main">
              <strong>{thread.subject}</strong>
              <span className="muted small">
                {props.side === "studio" ? `${thread.business_name} · ` : ""}
                {thread.preview ? `${thread.last_from_studio ? (props.side === "studio" ? "You: " : "Bila Matata: ") : ""}${thread.preview}` : thread.topic_label}
              </span>
            </span>
            <span className="support-item-side">
              {statusChip(thread, props.side)}
              <span className="muted small">{timeAgo(thread.last_message_at)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── A business's team ─────────────────────────────────────────────────

const GUIDES: Array<{ icon: string; title: string; text: string; page: string; id?: string; action: string }> = [
  { icon: "inbox", title: "Take over a chat from Zaina", text: "Open the chat in your Inbox and press “Take over from Zaina”. She stays quiet while you reply, on the website or WhatsApp. Press “Hand back to Zaina” when you're done.", page: "inbox", action: "Open the Inbox" },
  { icon: "bell", title: "Get told when a customer needs you", text: "Press the bell at the top of the page: turn on alerts for this phone or computer, and email alerts for waiting chats and callbacks. Each person on your team sets their own.", page: "team", action: "See your team" },
  { icon: "search", title: "Find a past conversation", text: "Every chat is kept in your Inbox under “All chats”, with what Zaina said, what your team said and what was booked. Chats are deleted after your retention period.", page: "inbox", action: "See all chats" },
  { icon: "globe", title: "Put Zaina on your website", text: "One line of code, on any website. Copy it from Settings, and add the address of each website that may show the chat.", page: "settings", id: "widget", action: "Get the code" },
  { icon: "tag", title: "Keep prices and answers right", text: "Zaina only quotes your price list and answers from your knowledge. Update them and she uses the new information straight away.", page: "prices", action: "Open your prices" },
  { icon: "card", title: "Your plan and invoices", text: "See what your plan includes, pay an invoice by M-Pesa or card, or change plan.", page: "settings", id: "billing", action: "Open plan & billing" },
];

export function SupportPage(props: { businessId: string; role: Role; threadId: string | null; onChanged: () => void }) {
  const base = businessPath(props.businessId, "/support");
  const loaded = useLoad(() => api<BusinessSupport>("GET", base), [props.businessId]);
  const [asking, setAsking] = useState(false);
  const canWrite = atLeast(props.role, "agent");
  const open = (id: string | null) => go({ businessId: props.businessId, page: "support", id });
  const changed = () => { void loaded.reload(); props.onChanged(); };
  // Back on the list, and every so often: what the studio has answered since.
  useEffect(() => { if (!props.threadId) void loaded.reload(); }, [props.threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEvery(() => { if (!props.threadId) void loaded.reload(); }, 30_000, [props.threadId]);

  if (props.threadId) {
    return <div className="page"><ThreadView path={`${base}/${props.threadId}`} side="business" canWrite={canWrite} onBack={() => open(null)} onChanged={changed} /></div>;
  }
  const data = loaded.data;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Help &amp; support</h1>
        <p className="muted">How to do the everyday things, and a direct line to the Bila Matata team.</p>
      </div>
      <ErrorLine error={loaded.error} />

      <section className="stack">
        <div className="room-head">
          <h2>Talk to us</h2>
          {canWrite ? <Button kind="primary" onClick={() => setAsking(true)}><Icon name="plus" size={15} /> Ask a question</Button> : null}
        </div>
        {data?.threads.length ? <ThreadList threads={data.threads} side="business" onOpen={(thread) => open(thread.id)} />
          : data ? <Empty title="No conversations yet">Ask anything: setting up, a wrong answer from Zaina, your plan. We reply here and by email.</Empty> : null}
        {data ? (
          <p className="muted small">
            Urgent? WhatsApp or call <a href={data.contact.whatsapp_link} target="_blank" rel="noreferrer">{data.contact.whatsapp}</a>, or email <a href={`mailto:${data.contact.email}`}>{data.contact.email}</a>. {data.contact.hours}.
          </p>
        ) : null}
      </section>

      <section className="stack">
        <h2>How do I…</h2>
        <div className="guide-grid">
          {GUIDES.map((guide) => (
            <article key={guide.title} className="card guide">
              <h3><Icon name={guide.icon} size={16} /> {guide.title}</h3>
              <p className="muted">{guide.text}</p>
              <Button small onClick={() => go({ businessId: props.businessId, page: guide.page, id: guide.id ?? null })}>{guide.action}</Button>
            </article>
          ))}
        </div>
      </section>

      {asking && data ? <Ask base={base} topics={data.topics} onClose={() => setAsking(false)} onSent={(id) => { setAsking(false); changed(); open(id); }} /> : null}
    </div>
  );
}

function Ask(props: { base: string; topics: BusinessSupport["topics"]; onClose: () => void; onSent: (threadId: string) => void }) {
  const [form, setForm] = useState({ subject: "", topic: props.topics[0]?.id ?? "question", message: "" });
  const action = useAction();
  return (
    <Modal title="Ask the Bila Matata team" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            const created = await api<{ thread: Thread }>("POST", props.base, form);
            props.onSent(created.thread.id);
          });
        }}
      >
        <Field label="What is it about?">
          <select value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })}>
            {props.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}
          </select>
        </Field>
        <Field label="Subject"><input required minLength={3} maxLength={160} placeholder="For example: Zaina gave the wrong price for delivery" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></Field>
        <Field label="Your message" hint="If it's about a chat, say roughly when it happened: we can find it."><textarea required rows={5} maxLength={5000} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></Field>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Send</Button></div>
      </form>
    </Modal>
  );
}

// ── The studio's team ─────────────────────────────────────────────────

export function PlatformSupport(props: { threadId: string | null; onOpen: (threadId: string | null) => void; onChanged: () => void }) {
  const [status, setStatus] = useState<"open" | "answered" | "closed" | "all">("open");
  const loaded = useLoad(() => api<{ threads: Thread[]; open: number }>("GET", `/v1/platform/support?status=${status}`), [status]);
  useEvery(() => void loaded.reload(), 30_000, [status]);
  const changed = () => { void loaded.reload(); props.onChanged(); };
  useEffect(() => { if (!props.threadId) void loaded.reload(); }, [props.threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (props.threadId) {
    return <ThreadView path={`/v1/platform/support/${props.threadId}`} side="studio" canWrite onBack={() => props.onOpen(null)} onChanged={changed} />;
  }
  return (
    <section className="stack">
      <div className="page-head">
        <h2>Support</h2>
        <p className="muted">What businesses have asked. They get your answer in their dashboard and by email.</p>
      </div>
      <Tabs
        label="Which conversations"
        active={status}
        onChange={setStatus}
        tabs={[{ id: "open", label: "Need an answer", count: loaded.data?.open }, { id: "answered", label: "Answered" }, { id: "closed", label: "Closed" }, { id: "all", label: "All" }]}
      />
      <ErrorLine error={loaded.error} />
      {loaded.data?.threads.length ? <ThreadList threads={loaded.data.threads} side="studio" onOpen={(thread) => props.onOpen(thread.id)} />
        : loaded.data ? <Empty title={status === "open" ? "Nothing waiting" : "Nothing here"}>{status === "open" ? "Every question has an answer." : "No conversations with this status."}</Empty> : null}
    </section>
  );
}

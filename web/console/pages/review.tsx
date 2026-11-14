// web/console/pages/review.tsx
//
// Platform → Review: the studio reads real chats every week (failures,
// handovers and unanswered questions first), marks each good or an issue
// with what went wrong, and tracks the fix. The pilot report counts what
// really happened, week by week, per business.

import { useState } from "react";
import { api } from "../api.ts";
import { clock, timeAgo } from "../format.ts";
import { Button, ErrorLine, Field, Message, Modal, Tabs, useAction, useLoad } from "../ui.tsx";

type ReviewInfo = { id: string; verdict: "good" | "issue"; tags: string[]; note: string | null; fixed_at: string | null; reviewed_at: string };
type QueueChat = {
  business: { id: string; name: string };
  session_id: string;
  started_at: string;
  channel: string;
  customer_messages: number;
  first_message: string | null;
  outcomes: { lead: boolean; booking: boolean; handed_off: boolean; failed_turns: number; unanswered: number };
  reasons: string[];
  review: ReviewInfo | null;
};
type Queue = { days: number; total_chats: number; reviewed: number; open_issues: number; chats: QueueChat[]; tags: string[] };
type Event = { id: number; actor: string; content: string | null; toolName: string | null; createdAt: string; authorName: string | null };
type WeekRow = {
  from: string;
  to: string;
  report: { chats: { total: number }; resolvedWithoutStaff: { chats: number; share: number | null }; handoffs: { total?: number; count?: number }; outcomes: { bookings: number; leads: number }; unanswered: { total: number } };
  reviews: { reviewed: number; issues: number; fixed: number; tags: Record<string, number> };
};
type Report = { weeks: number; generated_at: string; businesses: Array<{ business: { id: string; name: string; type: string; went_live_at: string | null }; weeks: WeekRow[] }> };

const TAG_LABELS: Record<string, string> = {
  wrong_info: "Wrong information",
  invented: "Made something up",
  missed_sale: "Missed a sale",
  should_handoff: "Should have brought in the team",
  slow_team: "The team was slow",
  tone: "Tone",
  language: "Language",
  privacy: "Privacy",
  payment: "Payment",
  other: "Other",
};

export function ReviewSection() {
  const [view, setView] = useState<"queue" | "report">("queue");
  return (
    <div className="stack">
      <Tabs label="Review" active={view} onChange={setView} tabs={[{ id: "queue", label: "Chats to read" }, { id: "report", label: "Pilot report" }]} />
      {view === "queue" ? <ReviewQueue /> : <PilotReport />}
    </div>
  );
}

function ReviewQueue() {
  const [show, setShow] = useState<"unreviewed" | "issues" | "all">("unreviewed");
  const [days, setDays] = useState(7);
  const queue = useLoad(() => api<Queue>("GET", `/v1/platform/review/queue?show=${show}&days=${days}`), [show, days]);
  const [open, setOpen] = useState<QueueChat | null>(null);
  return (
    <section className="card">
      <div className="review-head">
        <div>
          <h2>Chats to read</h2>
          {queue.data ? <p className="muted small">Last {queue.data.days} days: {queue.data.total_chats} customer chats, {queue.data.reviewed} read, {queue.data.open_issues} open {queue.data.open_issues === 1 ? "issue" : "issues"}.</p> : null}
        </div>
        <div className="review-filters">
          <select aria-label="Which chats" value={show} onChange={(event) => setShow(event.target.value as typeof show)}>
            <option value="unreviewed">Not read yet</option>
            <option value="issues">Open issues</option>
            <option value="all">All</option>
          </select>
          <select aria-label="Period" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
      </div>
      <ErrorLine error={queue.error} />
      {queue.data && !queue.data.chats.length ? <p className="muted">{show === "issues" ? "No open issues." : "Nothing left to read for this period."}</p> : null}
      <ul className="review-list">
        {queue.data?.chats.map((chat) => (
          <li key={chat.session_id}>
            <button type="button" className="review-item" onClick={() => setOpen(chat)}>
              <span className="review-item-top">
                <strong>{chat.business.name}</strong>
                <span className="muted small">{timeAgo(chat.started_at)} · {chat.channel === "whatsapp" ? "WhatsApp" : "Website"} · {chat.customer_messages} {chat.customer_messages === 1 ? "message" : "messages"}</span>
              </span>
              <span className="review-first">{chat.first_message ?? "(no text)"}</span>
              <span className="review-chips">
                {chat.reasons.map((reason) => <span key={reason} className={`chip${/failed|unanswered/.test(reason) ? " warn" : /handed/.test(reason) ? " waiting" : /lead|booking/.test(reason) ? " ok" : ""}`}>{reason}</span>)}
                {chat.review ? <span className={`chip${chat.review.verdict === "good" ? " ok" : chat.review.fixed_at ? "" : " warn"}`}>{chat.review.verdict === "good" ? "Good" : chat.review.fixed_at ? "Fixed" : `Issue: ${chat.review.tags.map((tag) => TAG_LABELS[tag] ?? tag).join(", ")}`}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open ? <ReadChat chat={open} tags={queue.data?.tags ?? Object.keys(TAG_LABELS)} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void queue.reload(); }} /> : null}
    </section>
  );
}

function ReadChat(props: { chat: QueueChat; tags: string[]; onClose: () => void; onSaved: () => void }) {
  const detail = useLoad(() => api<{ transcript: Event[] }>("GET", `/v1/staff/businesses/${props.chat.business.id}/sessions/${props.chat.session_id}`), [props.chat.session_id]);
  const [verdict, setVerdict] = useState<"good" | "issue">(props.chat.review?.verdict ?? "good");
  const [tags, setTags] = useState<string[]>(props.chat.review?.tags ?? []);
  const [note, setNote] = useState(props.chat.review?.note ?? "");
  const [fixNote, setFixNote] = useState("");
  const save = useAction();
  const review = props.chat.review;
  return (
    <Modal title={`${props.chat.business.name} · ${timeAgo(props.chat.started_at)}`} onClose={props.onClose}>
      <div className="review-read">
        <div className="review-transcript" aria-label="Transcript">
          <ErrorLine error={detail.error} />
          {detail.data?.transcript.filter((event) => event.actor !== "SYSTEM_TOOL" || event.toolName).map((event) => {
            if (event.actor === "SYSTEM_TOOL") return <p key={event.id} className="review-step">Used {event.toolName}</p>;
            if (event.actor === "SYSTEM") return <p key={event.id} className="system-note">{event.content}</p>;
            const side = event.actor === "USER" ? "customer" : event.actor === "AGENT" ? "team" : "zaina";
            return (
              <div key={event.id} className={`bubble-row ${side}`}>
                <span className="bubble-who">{side === "customer" ? "Customer" : side === "team" ? event.authorName ?? "Team" : "Zaina"} · {clock(event.createdAt)}</span>
                <div className="bubble">{event.content}</div>
              </div>
            );
          })}
        </div>
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            await save.run(async () => {
              await api("PUT", `/v1/platform/review/sessions/${props.chat.session_id}`, { business: props.chat.business.id, verdict, tags: verdict === "issue" ? tags : [], note: note.trim() || null });
              props.onSaved();
            });
          }}
        >
          <fieldset className="choice">
            <legend>How did Zaina do?</legend>
            <label className="check"><input type="radio" name="verdict" checked={verdict === "good"} onChange={() => setVerdict("good")} /><span>Good</span></label>
            <label className="check"><input type="radio" name="verdict" checked={verdict === "issue"} onChange={() => setVerdict("issue")} /><span>Something to fix</span></label>
          </fieldset>
          {verdict === "issue" ? (
            <fieldset className="choice review-tags">
              <legend>What went wrong</legend>
              {props.tags.map((tag) => (
                <label key={tag} className="check"><input type="checkbox" checked={tags.includes(tag)} onChange={(event) => setTags(event.target.checked ? [...tags, tag] : tags.filter((entry) => entry !== tag))} /><span>{TAG_LABELS[tag] ?? tag}</span></label>
              ))}
            </fieldset>
          ) : null}
          <Field label="Note (optional)" hint="What to change: knowledge, the setup interview, a setting, the instructions.">
            <textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <Message message={save.message} />
          <div className="actions"><Button onClick={props.onClose}>Close</Button><Button kind="primary" type="submit" busy={save.busy} disabled={verdict === "issue" && !tags.length}>Save</Button></div>
        </form>
        {review?.verdict === "issue" && !review.fixed_at ? (
          <form
            className="form review-fix"
            onSubmit={async (event) => {
              event.preventDefault();
              await save.run(async () => {
                await api("POST", `/v1/platform/review/${review.id}/fixed`, { business: props.chat.business.id, note: fixNote.trim() || null });
                props.onSaved();
              });
            }}
          >
            <Field label="Fixed? What changed"><input maxLength={500} value={fixNote} onChange={(event) => setFixNote(event.target.value)} placeholder="Added the generator to knowledge." /></Field>
            <div className="actions"><Button type="submit" busy={save.busy}>Mark fixed</Button></div>
          </form>
        ) : null}
      </div>
    </Modal>
  );
}

const share = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);
const shortDate = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function PilotReport() {
  const [weeks, setWeeks] = useState(4);
  const report = useLoad(() => api<Report>("GET", `/v1/platform/review/report?weeks=${weeks}`), [weeks]);
  const csv = () => {
    if (!report.data) return;
    const rows = [["business", "week from", "week to", "chats", "resolved without staff", "leads", "bookings", "unanswered questions", "chats read", "issues", "fixed"]];
    for (const entry of report.data.businesses) {
      for (const week of entry.weeks) {
        rows.push([entry.business.name, week.from.slice(0, 10), week.to.slice(0, 10), String(week.report.chats.total), String(week.report.resolvedWithoutStaff.chats), String(week.report.outcomes.leads), String(week.report.outcomes.bookings), String(week.report.unanswered.total), String(week.reviews.reviewed), String(week.reviews.issues), String(week.reviews.fixed)]);
      }
    }
    const blob = new Blob([rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `pilot-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  return (
    <section className="card">
      <div className="review-head">
        <div>
          <h2>Pilot report</h2>
          <p className="muted small">Counted from each business's own chats, leads and bookings, week by week (the newest first). Nothing is estimated.</p>
        </div>
        <div className="review-filters">
          <select aria-label="Weeks" value={weeks} onChange={(event) => setWeeks(Number(event.target.value))}>
            <option value={4}>4 weeks</option>
            <option value={8}>8 weeks</option>
            <option value={12}>12 weeks</option>
          </select>
          <Button small onClick={csv} disabled={!report.data}>Download CSV</Button>
        </div>
      </div>
      <ErrorLine error={report.error} />
      {report.data?.businesses.map((entry) => (
        <div key={entry.business.id} className="pilot-business">
          <h3>{entry.business.name}{entry.business.went_live_at ? <span className="muted small"> · live since {shortDate(entry.business.went_live_at)}</span> : null}</h3>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Week</th><th className="num">Chats</th><th className="num">No staff needed</th><th className="num">Leads</th><th className="num">Bookings</th><th className="num">Unanswered</th><th className="num">Read</th><th className="num">Issues (fixed)</th></tr></thead>
              <tbody>
                {entry.weeks.map((week) => (
                  <tr key={week.from}>
                    <td>{shortDate(week.from)} – {shortDate(week.to)}</td>
                    <td className="num">{week.report.chats.total}</td>
                    <td className="num">{share(week.report.resolvedWithoutStaff.share)}</td>
                    <td className="num">{week.report.outcomes.leads}</td>
                    <td className="num">{week.report.outcomes.bookings}</td>
                    <td className="num">{week.report.unanswered.total}</td>
                    <td className="num">{week.reviews.reviewed}</td>
                    <td className="num">{week.reviews.issues}{week.reviews.issues ? ` (${week.reviews.fixed})` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

// web/console/pages/outreach.tsx
//
// Outreach: what Zaina sends customers who aren't chatting, within their
// consent and WhatsApp's rules. Service messages (reminders, follow-ups on
// enquiries, feedback requests) the business turns on; offers go only to
// customers who said yes, and only after a manager approves the message and
// how many it goes to. Every message, sent or not, is in the log with why.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import { Button, ErrorLine, Field, Message, Toggle, useAction, useLoad } from "../ui.tsx";

type Settings = {
  reminders: boolean; reminder_hours: number; follow_ups: boolean; feedback: boolean; feedback_hours: number; offers: boolean;
  templates: { reminder: string | null; feedback: string | null; offer: string | null; language: string };
};
type Campaign = { id: string; title: string; message: string; audience: string; status: "draft" | "sending" | "sent" | "cancelled"; created_at: string; sent: number; skipped: number };
type Suggestion = { audience: string; label: string; eligible: number; inWindow: number; needTemplate: number; noWhatsapp: number };
type Data = {
  settings: Settings; whatsapp_connected: boolean;
  consent: { offers: number; stopped: number; customers: number };
  ratings: { count: number; average: number | null; low: number };
  recent: Array<{ kind: string; status: string; channel: string | null; reason: string | null; text: string | null; rating: number | null; created_at: string; customer: string | null; customer_id: string | null }>;
  campaigns: Campaign[];
  suggestions: Suggestion[];
};
type Preview = { eligible: number; reachable: number; inWindow: number; needTemplate: number; noWhatsapp: number; template: string | null; offers_on: boolean; sample: string };

const KIND: Record<string, string> = { reminder: "Reminder", follow_up: "Follow-up", feedback: "Feedback", offer: "Offer" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", whatsapp_template: "WhatsApp template", email: "Email" };
const customers = (n: number) => `${n} ${n === 1 ? "customer" : "customers"}`;

export function OutreachPage(props: { businessId: string }) {
  const loaded = useLoad(() => api<Data>("GET", businessPath(props.businessId, "/outreach")), [props.businessId]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<{ title: string; message: string; audience: string } | null>(null);
  const [preview, setPreview] = useState<{ id: string; data: Preview } | null>(null);
  const action = useAction();
  const data = loaded.data;
  if (!data) return <div className="page"><h1>Outreach</h1><ErrorLine error={loaded.error} /></div>;
  const s = settings ?? data.settings;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...s, [key]: value });
  const path = (route: string) => businessPath(props.businessId, route);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Outreach</h1>
        <p className="muted">Zaina can reach customers who aren't chatting: a reminder before their booking, a nudge when they asked and didn't buy, a thank-you that asks how it went, and offers you approve. Anyone who replies STOP gets nothing more.</p>
      </div>
      <Message message={action.message} />

      <form className="card stack" onSubmit={(event) => { event.preventDefault(); void action.run(async () => { setSettings(await api<Settings>("PUT", path("/outreach/settings"), s)); await loaded.reload(); }, "Saved."); }}>
        <h2>What Zaina sends</h2>
        <div className="stack-tight">
          <Toggle checked={s.reminders} onChange={(next) => set("reminders", next)} label="Reminders before a booking" />
          {s.reminders ? <Field label="Hours before"><input type="number" min={2} max={72} value={s.reminder_hours} onChange={(event) => set("reminder_hours", Number(event.target.value))} /></Field> : null}
        </div>
        <div className="stack-tight">
          <Toggle checked={s.follow_ups} onChange={(next) => set("follow_ups", next)} label="Follow up on enquiries that didn't book or order" />
          <p className="muted small">WhatsApp only, once, while the customer's chat is still open (within a day of their last message).</p>
        </div>
        <div className="stack-tight">
          <Toggle checked={s.feedback} onChange={(next) => set("feedback", next)} label="Ask for feedback after an order or visit" />
          {s.feedback ? <Field label="Hours after"><input type="number" min={1} max={72} value={s.feedback_hours} onChange={(event) => set("feedback_hours", Number(event.target.value))} /></Field> : null}
          <p className="muted small">Customers reply 1 to 5. A 3 or less becomes a request for your team.</p>
        </div>
        <div className="stack-tight">
          <Toggle checked={s.offers} onChange={(next) => set("offers", next)} label="Offers, to customers who say yes" />
          <p className="muted small">Zaina asks a WhatsApp customer once, after she's helped them, if they'd like offers. Only a clear yes counts. You approve every offer before it goes.</p>
        </div>
        <details className="more-details">
          <summary>WhatsApp templates (for when a customer's chat has closed)</summary>
          <p className="muted small">After 24 hours without a message from the customer, WhatsApp only allows templates Meta has approved, and may charge for them. Create them in your Meta account with these values, then enter their names here. Without one, Zaina uses email for reminders and feedback, or skips.</p>
          <div className="form-grid">
            <Field label="Reminder template" hint="{{1}} their name, {{2}} what and when"><input value={s.templates.reminder ?? ""} onChange={(event) => set("templates", { ...s.templates, reminder: event.target.value })} placeholder="booking_reminder" /></Field>
            <Field label="Feedback template" hint="{{1}} their name, {{2}} what they had"><input value={s.templates.feedback ?? ""} onChange={(event) => set("templates", { ...s.templates, feedback: event.target.value })} placeholder="feedback_request" /></Field>
            <Field label="Offer template" hint="{{1}} their name, {{2}} your message"><input value={s.templates.offer ?? ""} onChange={(event) => set("templates", { ...s.templates, offer: event.target.value })} placeholder="occasional_offer" /></Field>
            <Field label="Language code"><input value={s.templates.language} onChange={(event) => set("templates", { ...s.templates, language: event.target.value })} placeholder="en" /></Field>
          </div>
        </details>
        <div className="actions start"><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
      </form>

      <div className="kpis">
        <div className="kpi"><p className="kpi-label">Said yes to offers</p><p className="kpi-value">{data.consent.offers}</p><p className="kpi-detail">of {customers(data.consent.customers)}</p></div>
        <div className="kpi"><p className="kpi-label">Replied STOP</p><p className="kpi-value">{data.consent.stopped}</p><p className="kpi-detail">They get nothing more</p></div>
        <div className="kpi"><p className="kpi-label">Average rating</p><p className="kpi-value">{data.ratings.average ?? "—"}</p><p className="kpi-detail">{data.ratings.count} {data.ratings.count === 1 ? "rating" : "ratings"} · {data.ratings.low} of 3 or less (last 90 days)</p></div>
      </div>

      <section className="card stack-tight">
        <h2>Offers</h2>
        {!s.offers ? <p className="muted small">Turn on offers above to send them.</p> : null}
        <ul className="plain-list">
          {data.suggestions.map((entry) => (
            <li key={entry.audience} className="offer-suggestion">
              <span>{entry.label}: <strong>{entry.eligible}</strong></span>
              <Button small disabled={!s.offers || !entry.eligible} onClick={() => setDraft({ title: entry.label, message: entry.audience === "lapsed" ? "Hi {name}, we miss you! Come back this week and …" : entry.audience === "regulars" ? "Hi {name}, time for your usual? Reply here and we'll have it ready." : "Hi {name}, this week only: …", audience: entry.audience })}>Write a message</Button>
            </li>
          ))}
        </ul>
        {draft ? (
          <form className="stack-tight" onSubmit={(event) => { event.preventDefault(); void action.run(async () => { await api("POST", path("/campaigns"), draft); setDraft(null); await loaded.reload(); }, "Draft saved. Preview it to approve."); }}>
            <Field label="Name (for you)"><input value={draft.title} maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field>
            <Field label="Message" hint="{name} becomes their first name. 700 characters at most."><textarea rows={4} maxLength={700} value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} /></Field>
            <div className="actions start"><Button small onClick={() => setDraft(null)}>Cancel</Button><Button small kind="primary" type="submit">Save draft</Button></div>
          </form>
        ) : null}
        {data.campaigns.length ? (
          <ul className="customer-history">
            {data.campaigns.map((campaign) => (
              <li key={campaign.id}>
                <span className={`chip ${campaign.status === "sent" ? "ok" : campaign.status === "sending" ? "waiting" : ""}`}>{campaign.status === "draft" ? "Draft" : campaign.status === "sending" ? "Sending" : campaign.status === "sent" ? "Sent" : "Cancelled"}</span>
                <span><strong>{campaign.title}</strong> · {campaign.message}</span>
                <span className="muted small">
                  {campaign.sent ? `${campaign.sent} sent · ` : ""}{campaign.skipped ? `${campaign.skipped} skipped · ` : ""}{timeAgo(campaign.created_at)}{" "}
                  {campaign.status === "draft" ? <button type="button" className="link" onClick={() => void action.run(async () => setPreview({ id: campaign.id, data: await api<Preview>("GET", path(`/campaigns/${campaign.id}/preview`)) }))}>Preview and approve</button> : null}
                  {campaign.status === "draft" || campaign.status === "sending" ? <> · <button type="button" className="link" onClick={() => void action.run(async () => { await api("POST", path(`/campaigns/${campaign.id}/cancel`)); await loaded.reload(); }, "Cancelled.")}>Cancel</button></> : null}
                </span>
                {preview?.id === campaign.id ? (
                  <div className="card stack-tight campaign-preview">
                    <p className="small"><strong>Goes to {customers(preview.data.reachable)}</strong> who said yes to offers: {preview.data.inWindow} in an open WhatsApp chat, {preview.data.template ? `${preview.data.needTemplate} by your offer template` : `${preview.data.needTemplate} can't be reached without an offer template`}{preview.data.noWhatsapp ? `, ${preview.data.noWhatsapp} without WhatsApp (not sent)` : ""}.</p>
                    <p className="small muted">They'll read: "{preview.data.sample}"</p>
                    <div className="actions start">
                      <Button small onClick={() => setPreview(null)}>Not yet</Button>
                      <Button small kind="primary" disabled={!preview.data.reachable || !preview.data.offers_on} busy={action.busy} onClick={() => void action.run(async () => { await api("POST", path(`/campaigns/${campaign.id}/approve`), { confirm: preview.data.reachable }); setPreview(null); await loaded.reload(); }, "Approved: it goes out between 08:00 and 20:00, a few at a time.")}>Send to {customers(preview.data.reachable)}</Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card stack-tight">
        <h2>Recent messages</h2>
        {data.recent.length ? (
          <ul className="customer-history">
            {data.recent.map((entry, index) => (
              <li key={index}>
                <span className={`chip ${entry.status === "sent" ? "ok" : entry.status === "failed" ? "warn" : ""}`}>{KIND[entry.kind] ?? entry.kind}</span>
                <span>{entry.customer_id ? <a href={`#/b/${encodeURIComponent(props.businessId)}/customers/${entry.customer_id}`}>{entry.customer ?? "Customer"}</a> : entry.customer ?? "Customer"}: {entry.status === "sent" ? `sent by ${CHANNEL[entry.channel ?? ""] ?? entry.channel}` : `${entry.status}, ${entry.reason}`}{entry.rating ? ` · rated ${entry.rating}/5` : ""}</span>
                <span className="muted small">{timeAgo(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">Nothing sent yet. Messages go out between 08:00 and 20:00.</p>}
      </section>
    </div>
  );
}

// web/console/pages/leads.tsx
//
// People who want the team to get back to them: the details Zaina took in
// a chat (only what the customer typed), what they want, and how the team is
// following each up (new, contacted, won, lost), with a note of its own.
// The team is alerted as each one comes in.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import type { Role } from "../types.ts";
import { Button, Empty, ErrorLine, Message, Tabs, useAction, useLoad } from "../ui.tsx";

type LeadStatus = "new" | "contacted" | "won" | "lost";
type Lead = {
  id: number; sessionId: string | null; name: string; email: string | null; phone: string | null; interest: string | null; notes: string | null;
  createdAt: string; status: LeadStatus; teamNote: string | null; updatedAt: string | null; channel: "web" | "whatsapp" | null;
  kind?: "lead" | "request" | "callback" | "order"; callbackAt?: string | null; callbackWindow?: string | null;
  details?: OrderDetails | null;
};
type OrderDetails = {
  reference: string;
  lines: Array<{ itemId: string; name: string; quantity: number; priceText: string; lineTotalMinor: number | null }>;
  currency: string; totalMinor: number | null; totalText: string;
  fulfilment: "delivery" | "collection" | null; area: string | null; when: string | null;
};

/** When a callback is due, in the reader's own words of time. */
const callTime = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
type Filter = "open" | LeadStatus | "all";

const STATUS_TEXT: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", won: "Became a customer", lost: "Not going ahead" };
// An order's steps: the team confirms it with the customer, then it's delivered or collected, or cancelled.
const ORDER_STATUS_TEXT: Record<LeadStatus, string> = { new: "New order", contacted: "Confirmed", won: "Delivered or collected", lost: "Cancelled" };
const statusText = (lead: Lead) => (lead.kind === "order" ? ORDER_STATUS_TEXT : STATUS_TEXT);

/** What a customer ordered through Zaina: its lines, total and how it reaches them. */
function OrderLines(props: { order: OrderDetails }) {
  const { order } = props;
  const money = (minor: number) => `${order.currency === "USD" ? "$" : "KSh "}${(minor / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
  return (
    <div className="order-lines">
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Item</th><th className="number">Qty</th><th>Price</th><th className="number">Total</th></tr></thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.itemId}><td>{line.name}</td><td className="number">{line.quantity}</td><td>{line.priceText}</td><td className="number">{line.lineTotalMinor !== null ? money(line.lineTotalMinor) : "—"}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><th colSpan={3}>Total</th><th className="number">{order.totalText}</th></tr></tfoot>
        </table>
      </div>
      <p className="small">{order.fulfilment === "delivery" ? <><strong>Deliver to:</strong> {order.area}</> : order.fulfilment === "collection" ? <strong>They'll collect it</strong> : null}{order.when ? <> · <strong>When:</strong> {order.when}</> : null}</p>
      <p className="muted small">Confirm it with the customer, with any delivery charge, and tell them how to pay you. Zaina never takes payment.</p>
    </div>
  );
}

/** A phone number as WhatsApp's link wants it: digits, Kenyan numbers with 254. */
function whatsappDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const full = /^0[17]\d{8}$/.test(digits) ? `254${digits.slice(1)}` : /^[17]\d{8}$/.test(digits) ? `254${digits}` : digits;
  return full.length >= 10 && full.length <= 15 ? full : null;
}

export function LeadsPage(props: { businessId: string; role: Role; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>("open");
  const leads = useLoad(() => api<{ leads: Lead[]; counts: Record<LeadStatus, number> }>("GET", businessPath(props.businessId, `/leads?status=${filter}`)), [props.businessId, filter]);
  const counts = leads.data?.counts;
  const action = useAction();
  const update = (lead: Lead, patch: { status?: LeadStatus; team_note?: string | null }, done: string) => void action.run(async () => {
    await api("PATCH", businessPath(props.businessId, `/leads/${lead.id}`), patch);
    await leads.reload();
    props.onChanged();
  }, done);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Leads</h1>
        <p className="muted">Customers who want you to get back to them. Zaina takes their details in the chat (only what they typed) and you're alerted as each one comes in.</p>
      </div>
      <Tabs
        label="Leads"
        active={filter}
        onChange={setFilter}
        tabs={[
          { id: "open", label: "To follow up", count: counts ? counts.new + counts.contacted : undefined },
          { id: "new", label: "New", count: counts?.new },
          { id: "won", label: "Became customers" },
          { id: "lost", label: "Not going ahead" },
          { id: "all", label: "All" },
        ]}
      />
      <ErrorLine error={leads.error} />
      <Message message={action.message} />
      {leads.data && leads.data.leads.length === 0 ? (
        <Empty title={filter === "open" || filter === "new" ? "Nobody to follow up" : "No leads here"}>
          <p>When a customer wants you to get back to them, Zaina asks for their name and a phone number or email, and they appear here.</p>
        </Empty>
      ) : null}
      <div className="lead-list">
        {leads.data?.leads.map((lead) => <LeadCard key={lead.id} lead={lead} businessId={props.businessId} busy={action.busy} onUpdate={update} />)}
      </div>
    </div>
  );
}

function LeadCard(props: { lead: Lead; businessId: string; busy: boolean; onUpdate: (lead: Lead, patch: { status?: LeadStatus; team_note?: string | null }, done: string) => void }) {
  const { lead } = props;
  const [note, setNote] = useState<string | null>(null);
  const whatsapp = lead.phone ? whatsappDigits(lead.phone) : null;
  return (
    <article className={`card lead ${lead.status}`}>
      <div className="lead-head">
        <div>
          <h2>{lead.name}{lead.kind === "request" ? <span className="chip warn lead-kind">Request</span> : lead.kind === "callback" ? <span className="chip ok lead-kind">Call back</span> : lead.kind === "order" ? <span className="chip ok lead-kind">Order {lead.details?.reference ?? ""}</span> : null}</h2>
          <p className="muted small">
            {timeAgo(lead.createdAt)}{lead.channel ? ` · ${lead.channel === "whatsapp" ? "WhatsApp" : "website chat"}` : ""}
            {lead.updatedAt && lead.status !== "new" ? ` · ${statusText(lead)[lead.status].toLowerCase()} ${timeAgo(lead.updatedAt)}` : ""}
          </p>
        </div>
        <label>
          <span className="visually-hidden">Status of {lead.name}</span>
          <select value={lead.status} disabled={props.busy} onChange={(event) => props.onUpdate(lead, { status: event.target.value as LeadStatus }, `${lead.name}: ${statusText(lead)[event.target.value as LeadStatus].toLowerCase()}.`)}>
            {(Object.keys(STATUS_TEXT) as LeadStatus[]).map((status) => <option key={status} value={status}>{statusText(lead)[status]}</option>)}
          </select>
        </label>
      </div>
      {lead.kind === "callback" ? <p className="lead-callback"><strong>Call {lead.callbackAt ? callTime(lead.callbackAt) : lead.callbackWindow ?? "soon"}</strong>{lead.callbackAt && lead.callbackWindow ? <span className="muted"> ({lead.callbackWindow})</span> : null}</p> : null}
      {lead.kind === "order" && lead.details ? <OrderLines order={lead.details} /> : lead.interest ? <p><strong>{lead.kind === "request" ? "Asks for:" : lead.kind === "callback" ? "About:" : "Wants:"}</strong> {lead.interest}</p> : null}
      {lead.notes ? <p className="muted lead-notes">{lead.notes}</p> : null}
      <div className="lead-contact">
        {lead.phone ? <a className="button secondary small" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>Call {lead.phone}</a> : null}
        {whatsapp ? <a className="button secondary small" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
        {lead.email ? <a className="button secondary small" href={`mailto:${lead.email}`}>Email {lead.email}</a> : null}
        {lead.sessionId ? <a className="button ghost small" href={`#/b/${encodeURIComponent(props.businessId)}/inbox/${lead.sessionId}`}>Open the chat</a> : null}
      </div>
      {note === null ? (
        <p className="small">
          {lead.teamNote ? <><strong>Note:</strong> {lead.teamNote} </> : null}
          <button type="button" className="link" onClick={() => setNote(lead.teamNote ?? "")}>{lead.teamNote ? "Change the note" : "Add a note"}</button>
        </p>
      ) : (
        <form
          className="stack-tight"
          onSubmit={(event) => {
            event.preventDefault();
            props.onUpdate(lead, { team_note: note.trim() || null }, "Note saved.");
            setNote(null);
          }}
        >
          <label className="visually-hidden" htmlFor={`note-${lead.id}`}>Note about {lead.name}</label>
          <textarea id={`note-${lead.id}`} rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Called on Tuesday; sending a quote." />
          <div className="actions start"><Button small onClick={() => setNote(null)}>Cancel</Button><Button small kind="primary" type="submit">Save note</Button></div>
        </form>
      )}
    </article>
  );
}

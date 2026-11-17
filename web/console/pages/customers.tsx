// web/console/pages/customers.tsx
//
// Each customer in one place: every chat, request, booking and order they've
// made, what they prefer, what's still open, and when a follow-up would help.
// Chats, requests, bookings and orders are filed under a customer by their
// phone (or email), within a minute. Zaina recognises a returning customer
// only on WhatsApp or when they're signed in on the business's own site.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { date, timeAgo } from "../format.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Message, Tabs, Toggle, useAction, useLoad } from "../ui.tsx";

type Summary = {
  id: string; name: string | null; phone: string | null; email: string | null; signed_in: boolean; whatsapp: boolean;
  first_seen_at: string; last_seen_at: string; counts: { chats: number; requests: number; bookings: number; orders: number };
  paid: string[]; open: number; follow_ups: string[];
};
type Detail = Summary & {
  preferences: Array<{ text: string; by: "zaina" | "team"; at: string }>; team_note: string | null; followed_up_at: string | null;
  open_items: Array<{ kind: string; ref: string; text: string; at: string }>;
  history: Array<{ kind: "chat" | "request" | "callback" | "booking" | "order"; id: string; at: string; text: string; status?: string; channel?: string }>;
};
type Filter = "all" | "follow_up" | "open";

const whatsappDigits = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
};
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function CustomersPage(props: { businessId: string; role: Role; customerId: string | null }) {
  if (props.customerId) return <CustomerDetail businessId={props.businessId} role={props.role} customerId={props.customerId} />;
  return <CustomerList businessId={props.businessId} role={props.role} />;
}

function CustomerList(props: { businessId: string; role: Role }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const list = useLoad(
    () => api<{ customers: Summary[]; counts: Record<Filter, number>; recognition: boolean }>("GET", businessPath(props.businessId, `/customers?filter=${filter}${query ? `&q=${encodeURIComponent(query)}` : ""}`)),
    [props.businessId, filter, query],
  );
  const action = useAction();
  const counts = list.data?.counts;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Customers</h1>
        <p className="muted">Everyone who has chatted, asked, booked or ordered, each with their whole history. Chats with the same phone number are filed together.</p>
      </div>
      {list.data && atLeast(props.role, "manager") ? (
        <div className="card stack-tight">
          <Toggle
            checked={list.data.recognition}
            disabled={action.busy}
            label="Zaina recognises returning customers"
            onChange={(next) => void action.run(async () => {
              await api("PUT", businessPath(props.businessId, "/customer-settings"), { recognition: next });
              await list.reload();
            }, next ? "Zaina will greet returning customers." : "Zaina will treat every chat as new.")}
          />
          <p className="muted small">Only on WhatsApp, where the number proves who they are, or when they're signed in on your site. In the website chat, typing a number never shows anyone's history.</p>
          <Message message={action.message} />
        </div>
      ) : null}
      <form className="search-row" onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}>
        <label className="visually-hidden" htmlFor="customer-search">Find a customer</label>
        <input id="customer-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, phone or email" />
        <Button type="submit" small>Find</Button>
      </form>
      <Tabs
        label="Customers"
        active={filter}
        onChange={setFilter}
        tabs={[
          { id: "all", label: "All", count: counts?.all },
          { id: "follow_up", label: "Follow up", count: counts?.follow_up },
          { id: "open", label: "Something open", count: counts?.open },
        ]}
      />
      <ErrorLine error={list.error} />
      {list.data && list.data.customers.length === 0 ? (
        <Empty title={query ? "Nobody matches" : filter === "follow_up" ? "No follow-ups right now" : filter === "open" ? "Nothing open" : "No customers yet"}>
          <p>{filter === "follow_up" ? "Customers who asked and didn't buy, let something lapse, or haven't been back in a while appear here." : "Customers appear here once they leave a phone number or email, or write on WhatsApp."}</p>
        </Empty>
      ) : null}
      <div className="lead-list">
        {list.data?.customers.map((customer) => (
          <a key={customer.id} className="card lead customer-row" href={`#/b/${encodeURIComponent(props.businessId)}/customers/${customer.id}`}>
            <div className="lead-head">
              <div>
                <h2>{customer.name ?? customer.phone ?? customer.email ?? "A customer"}{customer.open ? <span className="chip warn">{customer.open} open</span> : null}</h2>
                <p className="muted small">{[customer.name ? customer.phone : null, `last in touch ${timeAgo(customer.last_seen_at)}`].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <p className="small">
              {[plural(customer.counts.chats, "chat"), customer.counts.bookings ? plural(customer.counts.bookings, "booking") : null, customer.counts.orders ? plural(customer.counts.orders, "order") : null, customer.paid.length ? `paid ${customer.paid.join(" + ")}` : null].filter(Boolean).join(" · ")}
            </p>
            {customer.follow_ups.map((text) => <p key={text} className="small customer-follow"><strong>Follow up:</strong> {text}</p>)}
          </a>
        ))}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { chat: "Chat", request: "Request", callback: "Call back", booking: "Booking", order: "Order" };

function CustomerDetail(props: { businessId: string; role: Role; customerId: string }) {
  const loaded = useLoad(() => api<Detail>("GET", businessPath(props.businessId, `/customers/${props.customerId}`)), [props.businessId, props.customerId]);
  const [data, setData] = useState<Detail | null>(null);
  const [preference, setPreference] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const action = useAction();
  const customer = data ?? loaded.data;
  const back = `#/b/${encodeURIComponent(props.businessId)}/customers`;
  if (!customer) return <div className="page"><p><a href={back}>← Customers</a></p><ErrorLine error={loaded.error} /></div>;
  const patch = (body: Record<string, unknown>, done: string) => void action.run(async () => setData(await api<Detail>("PATCH", businessPath(props.businessId, `/customers/${customer.id}`), body)), done);
  const whatsapp = customer.phone ? whatsappDigits(customer.phone) : null;
  const linkFor = (item: { kind: string; id: string }) => {
    const b = `#/b/${encodeURIComponent(props.businessId)}`;
    return item.kind === "chat" ? `${b}/inbox/${item.id}` : item.kind === "booking" ? `${b}/bookings/${item.id}` : item.kind === "order" ? `${b}/orders` : `${b}/leads`;
  };
  return (
    <div className="page">
      <p><a href={back}>← Customers</a></p>
      <div className="page-head">
        <h1>{customer.name ?? customer.phone ?? customer.email ?? "A customer"}</h1>
        <p className="muted">
          {[customer.phone, customer.email].filter(Boolean).join(" · ")}
          {customer.whatsapp ? " · on WhatsApp" : ""}{customer.signed_in ? " · signed in on your site" : ""}
        </p>
        <p className="muted small">First in touch {date(customer.first_seen_at)}, last {timeAgo(customer.last_seen_at)}{customer.paid.length ? ` · paid ${customer.paid.join(" + ")} so far` : ""}</p>
      </div>
      <Message message={action.message} />
      <div className="lead-contact">
        {customer.phone ? <a className="button secondary small" href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`}>Call {customer.phone}</a> : null}
        {whatsapp ? <a className="button secondary small" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
        {customer.email ? <a className="button secondary small" href={`mailto:${customer.email}`}>Email</a> : null}
      </div>

      {customer.follow_ups.length ? (
        <section className="card stack-tight">
          <h2>Worth a follow-up</h2>
          {customer.follow_ups.map((text) => <p key={text}>{text}</p>)}
          <p className="muted small">Zaina doesn't message customers on her own: reach out yourself, then mark it done.</p>
          <div className="actions start"><Button small kind="primary" busy={action.busy} onClick={() => patch({ followed_up: true }, "Marked as followed up.")}>Followed up</Button></div>
        </section>
      ) : null}

      {customer.open_items.length ? (
        <section className="card stack-tight">
          <h2>Still open</h2>
          <ul className="plain-list">{customer.open_items.map((item) => <li key={`${item.kind}-${item.ref}`}><a href={linkFor({ kind: item.kind, id: item.ref })}>{item.text}</a> <span className="muted small">{timeAgo(item.at)}</span></li>)}</ul>
        </section>
      ) : null}

      <section className="card stack-tight">
        <h2>What they prefer</h2>
        {customer.preferences.length ? (
          <ul className="plain-list">
            {customer.preferences.map((entry) => (
              <li key={entry.text}>
                {entry.text} <span className="muted small">{entry.by === "zaina" ? "told Zaina" : "added by the team"}</span>{" "}
                <button type="button" className="link" disabled={action.busy} onClick={() => patch({ preferences: customer.preferences.filter((other) => other.text !== entry.text).map((other) => other.text) }, "Removed.")}>Remove</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">Nothing yet. Zaina keeps what customers tell her on WhatsApp ("ground-floor room", "delivery after 5pm"); you can add your own.</p>}
        <form className="search-row" onSubmit={(event) => { event.preventDefault(); if (!preference.trim()) return; patch({ preferences: [...customer.preferences.map((entry) => entry.text), preference.trim()] }, "Added."); setPreference(""); }}>
          <label className="visually-hidden" htmlFor="new-preference">Add a preference</label>
          <input id="new-preference" maxLength={120} value={preference} onChange={(event) => setPreference(event.target.value)} placeholder="Likes a table by the window" />
          <Button small type="submit">Add</Button>
        </form>
      </section>

      <section className="card stack-tight">
        <h2>Your note</h2>
        {note === null ? (
          <p className="small">{customer.team_note ?? <span className="muted">No note.</span>} <button type="button" className="link" onClick={() => setNote(customer.team_note ?? "")}>{customer.team_note ? "Change" : "Add a note"}</button></p>
        ) : (
          <form className="stack-tight" onSubmit={(event) => { event.preventDefault(); patch({ team_note: note.trim() || null }, "Note saved."); setNote(null); }}>
            <label className="visually-hidden" htmlFor="customer-note">Note about this customer</label>
            <textarea id="customer-note" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Regular since 2024; prefers to pay by M-Pesa." />
            <div className="actions start"><Button small onClick={() => setNote(null)}>Cancel</Button><Button small kind="primary" type="submit">Save note</Button></div>
          </form>
        )}
        <p className="muted small">Only your team sees this note. Zaina doesn't.</p>
      </section>

      <section className="card stack-tight">
        <h2>History</h2>
        {customer.history.length === 0 ? <p className="muted small">Nothing yet.</p> : (
          <ul className="customer-history">
            {customer.history.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <span className="chip">{KIND_LABEL[item.kind] ?? item.kind}{item.kind === "chat" && item.channel === "whatsapp" ? " · WhatsApp" : ""}</span>
                <a href={linkFor(item)}>{item.text}</a>
                <span className="muted small">{date(item.at)}{item.status ? ` · ${item.status.replace(/_/g, " ")}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {atLeast(props.role, "manager") ? (
        <section className="card stack-tight">
          <h2>Forget this customer</h2>
          <p className="muted small">When they ask you to delete their data: their chats, requests and this record are deleted; bookings and orders stay for your accounts, without their name, phone or email. This can't be undone.</p>
          {forgetting ? (
            <div className="actions start">
              <Button small onClick={() => setForgetting(false)}>Keep them</Button>
              <Button small kind="danger" busy={action.busy} onClick={() => void action.run(async () => {
                await api("DELETE", businessPath(props.businessId, `/customers/${customer.id}`));
                location.hash = back;
              })}>Yes, forget them</Button>
            </div>
          ) : <div className="actions start"><Button small kind="danger" onClick={() => setForgetting(true)}>Forget this customer</Button></div>}
        </section>
      ) : null}
    </div>
  );
}

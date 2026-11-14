// web/console/pages/notifications.tsx
//
// Settings → Notifications: the email addresses a business adds to hear about
// its chats, on top of each team member's own alerts (the bell). Each address
// gets what it chose: an alert with a link to open the chat and take over,
// the conversation written out, or both. How many addresses a plan includes
// is shown, with what the Full plan adds.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { go } from "../app.tsx";
import { atLeast, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Toggle, useAction, useLoad } from "../ui.tsx";

type Recipient = { id: string; email: string; label: string | null; alerts: boolean; transcripts: boolean; added_at: string };
type Notifications = { recipients: Recipient[]; limit: number; used: number; plan: string | null; tier: "starter" | "full"; full_limit: number };

export function NotificationEmails(props: { businessId: string; role: Role }) {
  const base = businessPath(props.businessId, "/notification-emails");
  const loaded = useLoad(() => api<Notifications>("GET", base), [props.businessId]);
  const [form, setForm] = useState({ email: "", label: "", alerts: true, transcripts: false });
  const action = useAction();
  const canEdit = atLeast(props.role, "manager");
  const data = loaded.data;
  const full = data?.used !== undefined && data.used >= data.limit;
  return (
    <div className="stack">
      <section className="card">
        <h2>Notification emails</h2>
        <p className="muted">
          Add the addresses that should hear about your chats: the owner, reception, a manager, a shared inbox.
          Each gets an email when a customer is waiting (with a link to open the chat and take over), wants a callback,
          leaves their details or books, and can also get the whole conversation written out.
          Team members' own alerts (the bell at the top) are separate.
        </p>
        {data ? (
          <div className="allowance">
            <div className="allowance-bar" role="img" aria-label={`${data.used} of ${data.limit} used`}><span style={{ width: `${data.limit ? Math.min(100, (data.used / data.limit) * 100) : 100}%` }} /></div>
            <p className="small">
              <strong>{data.used} of {data.limit}</strong> used · {data.plan ?? (data.tier === "full" ? "Full" : "Starter")} plan
              {data.tier === "starter" && data.limit < data.full_limit ? <> · <button type="button" className="link" onClick={() => go({ businessId: props.businessId, page: "support" })}>The Full plan allows {data.full_limit}</button></> : null}
            </p>
          </div>
        ) : null}
        <ErrorLine error={loaded.error} />
        {data && data.recipients.length === 0 ? <Empty title="No extra addresses yet">Add one below. It's emailed to say you added it.</Empty> : null}
        {data?.recipients.length ? (
          <ul className="recipient-list">
            {data.recipients.map((row, index) => (
              <li key={row.id} className="recipient">
                <div className="recipient-who">
                  <strong>{row.label || row.email}</strong>
                  {row.label ? <span className="muted small">{row.email}</span> : null}
                  {index >= data.limit ? <span className="chip waiting">Over your plan: paused</span> : null}
                </div>
                <div className="recipient-toggles">
                  <Toggle
                    checked={row.alerts}
                    disabled={!canEdit || action.busy || (row.alerts && !row.transcripts)}
                    label="Alerts and takeover links"
                    onChange={(value) => void action.run(async () => { await api("PATCH", `${base}/${row.id}`, { alerts: value }); await loaded.reload(); })}
                  />
                  <Toggle
                    checked={row.transcripts}
                    disabled={!canEdit || action.busy || (row.transcripts && !row.alerts)}
                    label="Conversation transcripts"
                    onChange={(value) => void action.run(async () => { await api("PATCH", `${base}/${row.id}`, { transcripts: value }); await loaded.reload(); })}
                  />
                </div>
                {canEdit ? (
                  <div className="recipient-actions">
                    <Button small busy={action.busy} onClick={() => void action.run(async () => { const result = await api<{ sent: boolean }>("POST", `${base}/${row.id}/test`); if (!result.sent) throw new Error("not sent"); }, `A test email is on its way to ${row.email}.`)}>Send a test</Button>
                    <Button small kind="ghost" busy={action.busy} onClick={() => {
                      if (!window.confirm(`Stop emailing ${row.email}?`)) return;
                      void action.run(async () => { await api("DELETE", `${base}/${row.id}`); await loaded.reload(); }, `${row.email} was removed.`);
                    }}>Remove</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <Message message={action.message} />
      </section>

      {canEdit && data ? (
        <form
          className="card form"
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await action.run(async () => {
              await api("POST", base, { email: form.email, label: form.label || undefined, alerts: form.alerts, transcripts: form.transcripts });
              setForm({ email: "", label: "", alerts: true, transcripts: false });
              await loaded.reload();
            }, `Added. We emailed ${form.email} to say so.`);
            if (!ok) return;
          }}
        >
          <h3>Add an address</h3>
          {full ? (
            <p className="message error">You've used all {data.limit} on your plan. Remove one, or <button type="button" className="link" onClick={() => go({ businessId: props.businessId, page: "support" })}>ask the Bila Matata team</button> about a bigger plan.</p>
          ) : null}
          <div className="form-row">
            <Field label="Email"><input type="email" required maxLength={200} disabled={full} placeholder="reception@yourbusiness.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
            <Field label="Name or role" hint="Optional: so you remember whose it is."><input maxLength={60} disabled={full} placeholder="Front desk" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" disabled={full} checked={form.alerts} onChange={(event) => setForm({ ...form, alerts: event.target.checked })} /><span><Icon name="bell" size={14} /> Alerts, with a link to open the chat and take over</span></label>
          <label className="check"><input type="checkbox" disabled={full} checked={form.transcripts} onChange={(event) => setForm({ ...form, transcripts: event.target.checked })} /><span><Icon name="book" size={14} /> The conversation written out, with each alert and when a chat is closed</span></label>
          <div className="actions"><Button kind="primary" type="submit" busy={action.busy} disabled={full || (!form.alerts && !form.transcripts)}><Icon name="plus" size={15} /> Add address</Button></div>
        </form>
      ) : null}
      {!canEdit ? <p className="muted small">Managers and owners can change these.</p> : null}
    </div>
  );
}

// web/console/pages/integration.tsx
//
// Settings → Your system: connect the business's own shop, booking system
// or back office, so Zaina answers from it live (docs/INTEGRATION.md). The
// studio switches it on per business; the manager gives the address, makes
// the secret, chooses what Zaina may ask, tests it and sees how calls went.

import { useEffect, useState } from "react";
import { api, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, ErrorLine, Field, Message, Toggle, useAction, useLoad } from "../ui.tsx";

type Call = { at: string; action: string; ok: boolean; ms: number | null; error: string | null };
type View = {
  available: boolean;
  connected: boolean;
  endpoint: string | null;
  label: string | null;
  actions: string[];
  allow_writes: boolean;
  events_url: string | null;
  events: string[];
  has_secret: boolean;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  calls: Call[];
};

const ACTION_LABELS: Array<[string, string, string]> = [
  ["catalog.search", "Search what you sell", "Names, prices, stock and links, live."],
  ["catalog.item", "Open one item", "Sizes, colours, options and full details."],
  ["availability", "Check what's free", "Times, dates, rooms or quantities."],
  ["order.status", "Order status", "Where a customer's order stands: only to the customer it belongs to."],
  ["checkout.link", "Send customers to your checkout", "A link to your own checkout with their basket. Customers pay you there, never Zaina."],
  ["booking.create", "Book in your system", "Zaina books once the customer agrees. Needs \"Let Zaina write\"."],
  ["order.create", "Place orders in your system", "Zaina places the order once the customer confirms it; your system says the total and how to pay. Needs \"Let Zaina write\"."],
];
const EVENT_LABELS: Array<[string, string]> = [
  ["lead.created", "A customer left their details (or asked for a call back)"],
  ["booking.requested", "A booking request to answer"],
  ["booking.confirmed", "A confirmed booking"],
  ["order.confirmed", "An order from the catalogue, paid or to be paid on delivery"],
  ["chat.handoff", "A chat needs a person"],
];

export function Integration(props: { businessId: string; role: Role; admin?: boolean }) {
  const loaded = useLoad(() => api<{ integration: View }>("GET", businessPath(props.businessId, "/integration")).then((result) => result.integration), [props.businessId]);
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState({ endpoint: "", label: "", actions: [] as string[], allowWrites: false, eventsUrl: "", events: [] as string[] });
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"secret" | "disconnect" | null>(null);
  const [tested, setTested] = useState<{ ok: boolean; ms: number; system?: string | null; error?: string } | null>(null);
  const save = useAction();
  const act = useAction();
  // The address, choices and secret are set up by Bila Matata's admins; the business's managers see them and test.
  const canEdit = props.admin === true;
  const canTest = atLeast(props.role, "manager");

  const take = (next: View) => {
    setView(next);
    setForm({ endpoint: next.endpoint ?? "", label: next.label ?? "", actions: next.actions, allowWrites: next.allow_writes, eventsUrl: next.events_url ?? "", events: next.events });
  };
  useEffect(() => { if (loaded.data) take(loaded.data); }, [loaded.data]);
  if (!view) return <ErrorLine error={loaded.error} />;

  if (!view.available) {
    return (
      <section className="card integration-offer">
        <h2>Zaina inside your own system</h2>
        <p>Already run an online shop, a booking system or a back office? Zaina can work inside it, so every answer is live:</p>
        <ul className="ticks">
          <li>Prices, stock and what's free come straight from your system, never out of date.</li>
          <li>Customers ask "where's my order?" and get the real answer, privately.</li>
          <li>Ready to buy? She sends them to your own checkout. The money goes to you, as it does today.</li>
          <li>New leads and bookings arrive in your system as they happen.</li>
        </ul>
        <p className="muted">Connecting your system is set up with the Bila Matata studio, so it fits how you already work. Ask us under <a href={`#/b/${props.businessId}/support`}>Help &amp; support</a>.</p>
      </section>
    );
  }

  const toggle = (list: string[], value: string, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((entry) => entry !== value));
  const recent = view.calls.slice(0, 12);
  const failed = view.calls.filter((call) => !call.ok).length;

  return (
    <div className="stack">
      <section className="card">
        <div className="integration-status">
          <span className={`chip${view.connected && view.has_secret ? " ok" : ""}`}>{view.connected && view.has_secret ? "Connected" : "Not connected yet"}</span>
          {view.last_ok_at ? <span className="muted small">Last answered {timeAgo(view.last_ok_at)}</span> : null}
        </div>
        <h2>Your system</h2>
        <p className="muted">Zaina asks your system for live answers, signed with a secret only your system and Zaina know. Bila Matata sets up the connection and its secret with your developer; to change what she may ask, or switch it off, ask under <a href={`#/b/${props.businessId}/support`}>Help &amp; support</a>.</p>
        <p className="small">For your developer: <a href="/api/zaina/integration/zaina-connector.ts" download>zaina-connector.ts</a>, a ready TypeScript file (Express or Next.js) that checks Zaina's signature and answers her; they fill in search, stock, order status and placing orders from your system.</p>
        {view.last_error && (!view.last_ok_at || (view.last_error_at && view.last_error_at > view.last_ok_at)) ? <p className="message error" role="alert">Last problem{view.last_error_at ? ` (${timeAgo(view.last_error_at)})` : ""}: {view.last_error}</p> : null}
      </section>

      <form
        className="form card"
        onSubmit={async (event) => {
          event.preventDefault();
          await save.run(async () => take((await api<{ integration: View }>("PUT", businessPath(props.businessId, "/integration"), {
            endpoint: form.endpoint.trim(),
            label: form.label.trim() || null,
            actions: form.actions,
            allow_writes: form.allowWrites,
            events_url: form.eventsUrl.trim() || null,
            events: form.events,
          })).integration), "Saved. Zaina uses it from the next message.");
        }}
      >
        <h2>Address and what Zaina may ask</h2>
        <div className="form-row">
          <Field label="Your system's address" hint="The https address your developer set up for Zaina.">
            <input type="url" inputMode="url" required disabled={!canEdit} placeholder="https://shop.example.co.ke/zaina" value={form.endpoint} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} />
          </Field>
          <Field label="What customers know it as (optional)" hint="For example: our online shop.">
            <input maxLength={60} disabled={!canEdit} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
          </Field>
        </div>
        <fieldset className="choice">
          <legend>Zaina may</legend>
          {ACTION_LABELS.map(([id, label, hint]) => (
            <label key={id} className="check">
              <input type="checkbox" disabled={!canEdit || ((id === "booking.create" || id === "order.create") && !form.allowWrites)} checked={form.actions.includes(id)} onChange={(event) => setForm({ ...form, actions: toggle(form.actions, id, event.target.checked) })} />
              <span><strong>{label}</strong> <span className="muted">{hint}</span></span>
            </label>
          ))}
        </fieldset>
        <Toggle label="Let Zaina write: create bookings and orders in your system" checked={form.allowWrites} disabled={!canEdit} onChange={(value) => setForm({ ...form, allowWrites: value, actions: value ? form.actions : form.actions.filter((id) => id !== "booking.create" && id !== "order.create") })} />
        <p className="muted small">Off until you're happy with how she reads your system. Reading never changes anything.</p>
        <fieldset className="choice">
          <legend>Tell your system when</legend>
          {EVENT_LABELS.map(([id, label]) => (
            <label key={id} className="check">
              <input type="checkbox" disabled={!canEdit} checked={form.events.includes(id)} onChange={(event) => setForm({ ...form, events: toggle(form.events, id, event.target.checked) })} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {form.events.length ? (
          <Field label="Send them to" hint="An https address in your system that receives Zaina's events.">
            <input type="url" inputMode="url" disabled={!canEdit} placeholder="https://shop.example.co.ke/zaina/events" value={form.eventsUrl} onChange={(event) => setForm({ ...form, eventsUrl: event.target.value })} />
          </Field>
        ) : null}
        <Message message={save.message} />
        {canEdit ? <div className="actions"><Button kind="primary" type="submit" busy={save.busy}>Save</Button></div> : null}
      </form>

      <section className="card">
        <h2>Connection secret</h2>
        {secret ? (
          <div className="secret-once">
            <p><strong>Copy it now:</strong> it's shown only this once. Give it to your developer to put in your system.</p>
            <div className="secret-row">
              <code>{secret}</code>
              <Button small onClick={() => { void navigator.clipboard?.writeText(secret).catch(() => undefined); }}>Copy</Button>
            </div>
          </div>
        ) : (
          <p className="muted">{canEdit
            ? (view.has_secret ? "A secret is set. Make a new one if it may have been seen by someone else: the old one stops working at once." : "Make a secret, then give it to the business's developer. Zaina signs every request with it, and their system checks it.")
            : (view.has_secret ? "A secret is set. Bila Matata keeps it; if it may have been seen by someone else, ask them for a new one." : "Bila Matata makes the secret and gives it to your developer.")}</p>
        )}
        {confirm === "secret" ? (
          <div className="confirm-row">
            <span>Your system stops accepting Zaina until it has the new secret. Make a new one?</span>
            <Button small onClick={() => setConfirm(null)}>Keep the old one</Button>
            <Button small kind="danger" busy={act.busy} onClick={() => void act.run(async () => { setSecret((await api<{ secret: string }>("POST", businessPath(props.businessId, "/integration/secret"))).secret); setConfirm(null); setView({ ...view, has_secret: true }); })}>Make a new secret</Button>
          </div>
        ) : canTest ? (
          <div className="actions">
            {canEdit ? <Button busy={act.busy} onClick={() => (view.has_secret ? setConfirm("secret") : void act.run(async () => { setSecret((await api<{ secret: string }>("POST", businessPath(props.businessId, "/integration/secret"))).secret); setView({ ...view, has_secret: true }); }))}>{view.has_secret ? "Make a new secret" : "Make the secret"}</Button> : null}
            <Button kind="primary" busy={act.busy} onClick={() => void act.run(async () => setTested(await api("POST", businessPath(props.businessId, "/integration/test"))))}>Test the connection</Button>
          </div>
        ) : null}
        {tested ? (
          <p className={`message ${tested.ok ? "success" : "error"}`} role="status">
            {tested.ok ? `Connected${tested.system ? ` to ${tested.system}` : ""}: it answered in ${tested.ms} ms.` : `Not working yet: ${tested.error ?? "no answer"}`}
          </p>
        ) : null}
        <Message message={act.message} />
      </section>

      <section className="card">
        <h2>Recent requests</h2>
        {recent.length ? (
          <>
            <p className="muted small">The last {view.calls.length} requests{failed ? `: ${failed} didn't go through` : ", all answered"}.</p>
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>When</th><th>What</th><th>Result</th><th className="num">Time</th></tr></thead>
                <tbody>
                  {recent.map((call, index) => (
                    <tr key={`${call.at}-${index}`}>
                      <td>{timeAgo(call.at)}</td>
                      <td><code>{call.action}</code></td>
                      <td>{call.ok ? <span className="chip ok">Answered</span> : <span className="chip warn" title={call.error ?? undefined}>{call.error ?? "Failed"}</span>}</td>
                      <td className="num">{call.ms !== null ? `${call.ms} ms` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <p className="muted">No requests yet. Test the connection, then ask Zaina about something you sell.</p>}
      </section>

      {canEdit && view.endpoint ? (
        <section className="card">
          <h2>Disconnect</h2>
          <p className="muted">Zaina stops asking your system at once and the secret is deleted. Your system keeps everything it already has.</p>
          {confirm === "disconnect" ? (
            <div className="confirm-row">
              <span>Disconnect your system?</span>
              <Button small onClick={() => setConfirm(null)}>Cancel</Button>
              <Button small kind="danger" busy={act.busy} onClick={() => void act.run(async () => { take((await api<{ integration: View }>("DELETE", businessPath(props.businessId, "/integration"))).integration); setSecret(null); setTested(null); setConfirm(null); }, "Disconnected.")}>Disconnect</Button>
            </div>
          ) : <div className="actions"><Button kind="danger" onClick={() => setConfirm("disconnect")}>Disconnect…</Button></div>}
        </section>
      ) : null}
    </div>
  );
}

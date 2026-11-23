// web/console/pages/whats-on.tsx
//
// What's on: today's special, tonight's karaoke, a live band on Friday,
// happy hour every weekday. Posted here (or by WhatsApp: "Karaoke tonight
// from 8pm"), it shows above the menu on the business's page and Zaina
// mentions it to guests, at once.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, ErrorLine, Field, Message, useAction, useLoad } from "../ui.tsx";

type Entry = { id: string; text: string; date: string | null; until: string | null; weekday: number | null };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const plusDays = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function when(entry: Entry, today: string): string {
  if (entry.weekday !== null) return `Every ${WEEKDAYS[entry.weekday]}`;
  const one = (day: string) => (day === today ? "Today" : day === plusDays(today, 1) ? "Tomorrow" : label(day));
  return entry.until ? `${one(entry.date!)} to ${one(entry.until).toLowerCase() === "tomorrow" ? "tomorrow" : one(entry.until)}` : one(entry.date!);
}

export function WhatsOnPage(props: { businessId: string; role: Role }) {
  const list = useLoad(() => api<{ today: string; entries: Entry[] }>("GET", businessPath(props.businessId, "/whats-on")), [props.businessId]);
  const [form, setForm] = useState({ text: "", when: "today", date: "", weekday: "5" });
  const action = useAction();
  const canEdit = atLeast(props.role, "manager");
  if (!list.data) return <ErrorLine error={list.error} />;
  const { today, entries } = list.data;
  const post = () => void action.run(async () => {
    const body = form.when === "weekly" ? { text: form.text, weekday: Number(form.weekday) }
      : { text: form.text, date: form.when === "today" ? today : form.when === "tomorrow" ? plusDays(today, 1) : form.date };
    await api("POST", businessPath(props.businessId, "/whats-on"), body);
    setForm({ ...form, text: "" });
    await list.reload();
  }, "Posted: it's on your page, and Zaina knows.");
  const remove = (entry: Entry) => void action.run(async () => {
    await api("DELETE", businessPath(props.businessId, `/whats-on/${entry.id}`));
    await list.reload();
  }, "Taken down.");
  const todays = entries.filter((entry) => (entry.weekday === null ? entry.date! <= today && (entry.until ?? entry.date!) >= today : new Date(`${today}T12:00:00Z`).getUTCDay() === entry.weekday));
  const rest = entries.filter((entry) => !todays.includes(entry));
  return (
    <div className="stack">
      <section className="card stack-tight">
        <h2>What's on</h2>
        <p>Today's special, tonight's karaoke, a live band on Friday, happy hour every weekday. Post it here and it shows above your menu, and Zaina tells guests about it, at once.</p>
        <p className="muted small">From your phone too: write to your business's WhatsApp number, like "Karaoke tonight from 8pm" (Settings → Manage from WhatsApp).</p>
        {canEdit ? (
          <form className="form" onSubmit={(event) => { event.preventDefault(); post(); }}>
            <Field label="What's on" hint="In your words, as guests should read it: “Karaoke from 8pm”, “Today's special: grilled tilapia, KSh 1,200”.">
              <input value={form.text} maxLength={200} required placeholder="Karaoke from 8pm" onChange={(event) => setForm({ ...form, text: event.target.value })} />
            </Field>
            <div className="form-row">
              <Field label="When">
                <select value={form.when} onChange={(event) => setForm({ ...form, when: event.target.value })}>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="date">On a date</option>
                  <option value="weekly">Every week</option>
                </select>
              </Field>
              {form.when === "date" ? (
                <Field label="Date"><input type="date" min={today} required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></Field>
              ) : form.when === "weekly" ? (
                <Field label="On">
                  <select value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>
                    {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}s</option>)}
                  </select>
                </Field>
              ) : null}
            </div>
            <Message message={action.message} />
            <div className="actions start"><Button kind="primary" type="submit" busy={action.busy}>Post</Button></div>
          </form>
        ) : <p className="muted small">Managers and owners can post here.</p>}
      </section>
      <section className="card stack-tight">
        <h2>Today</h2>
        <EntryList entries={todays} today={today} canEdit={canEdit} onRemove={remove} empty="Nothing posted for today." />
      </section>
      {rest.length ? (
        <section className="card stack-tight">
          <h2>Coming up and every week</h2>
          <EntryList entries={rest} today={today} canEdit={canEdit} onRemove={remove} empty="" />
        </section>
      ) : null}
    </div>
  );
}

function EntryList(props: { entries: Entry[]; today: string; canEdit: boolean; onRemove: (entry: Entry) => void; empty: string }) {
  if (!props.entries.length) return <p className="muted small">{props.empty}</p>;
  return (
    <ul className="customer-history">
      {props.entries.map((entry) => (
        <li key={entry.id}>
          <span className="chip">{when(entry, props.today)}</span>
          <span>{entry.text}</span>
          {props.canEdit ? <span><Button small kind="ghost" onClick={() => props.onRemove(entry)}>Take down</Button></span> : null}
        </li>
      ))}
    </ul>
  );
}

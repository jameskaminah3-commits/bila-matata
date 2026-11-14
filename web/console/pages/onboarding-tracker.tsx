// web/console/pages/onboarding-tracker.tsx
//
// Platform → Onboarding: each client's path (docs/ONBOARDING.md) and its
// steps. Most steps are read from the business's real setup; the studio
// ticks the few only a person can confirm.

import { useState } from "react";
import { api } from "../api.ts";
import { timeAgo } from "../format.ts";
import { Button, ErrorLine, Field, Message, useAction, useLoad } from "../ui.tsx";

type Step = { id: string; label: string; done: boolean; auto: boolean; fix: string | null };
type Tracker = {
  business: { id: string; name: string; type: string; tier: string; status: string };
  path: string;
  path_chosen: boolean;
  steps: Step[];
  done: number;
  total: number;
  note: string | null;
  updated_at: string | null;
};
type Overview = { paths: Record<string, string>; businesses: Tracker[] };

export function OnboardingTracker() {
  const loaded = useLoad(() => api<Overview>("GET", "/v1/platform/onboarding"), []);
  const [open, setOpen] = useState<string | null>(null);
  if (!loaded.data) return <ErrorLine error={loaded.error} />;
  const { paths, businesses } = loaded.data;
  return (
    <section className="card">
      <h2>Onboarding</h2>
      <p className="muted small">Each client's path to going live (docs/ONBOARDING.md). Steps marked "checked" are read from the business's real setup.</p>
      <ul className="tracker-list">
        {businesses.map((tracker) => {
          const percent = Math.round((tracker.done / Math.max(1, tracker.total)) * 100);
          const expanded = open === tracker.business.id;
          return (
            <li key={tracker.business.id} className="tracker-item">
              <button type="button" className="tracker-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : tracker.business.id)}>
                <span className="tracker-name">
                  <strong>{tracker.business.name}</strong>
                  <span className="muted small">{paths[tracker.path]}{tracker.path_chosen ? "" : " (guessed)"}</span>
                </span>
                <span className="tracker-progress" aria-label={`${tracker.done} of ${tracker.total} steps done`}>
                  <span className="tracker-bar"><span ref={(node) => node?.style.setProperty("width", `${percent}%`)} /></span>
                  <span className="small">{tracker.done}/{tracker.total}</span>
                </span>
                <span className={`chip${tracker.business.status === "active" ? " ok" : tracker.business.status === "paused" ? " warn" : ""}`}>{tracker.business.status === "active" ? "Live" : tracker.business.status === "paused" ? "Paused" : "Setting up"}</span>
              </button>
              {expanded ? <TrackerDetail tracker={tracker} paths={paths} onSaved={() => void loaded.reload()} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TrackerDetail(props: { tracker: Tracker; paths: Record<string, string>; onSaved: () => void }) {
  const [note, setNote] = useState(props.tracker.note ?? "");
  const save = useAction();
  const put = (body: Record<string, unknown>, message?: string) => save.run(async () => {
    await api("PUT", `/v1/platform/onboarding/${props.tracker.business.id}`, body);
    props.onSaved();
  }, message);
  return (
    <div className="tracker-detail">
      <Field label="Path">
        <select value={props.tracker.path} onChange={(event) => void put({ path: event.target.value })}>
          {Object.entries(props.paths).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </Field>
      <ol className="tracker-steps">
        {props.tracker.steps.map((step) => (
          <li key={step.id} className={step.done ? "done" : ""}>
            {step.auto ? (
              <span className="tracker-step">
                <span className="tracker-mark" aria-hidden="true">{step.done ? "✓" : "○"}</span>
                <span>{step.label} <span className="muted small">· checked{step.done ? "" : ", not yet"}</span></span>
                {!step.done && step.fix ? <a className="small" href={step.fix}>Open</a> : null}
              </span>
            ) : (
              <label className="check">
                <input type="checkbox" checked={step.done} disabled={save.busy} onChange={(event) => void put({ ticks: { [step.id]: event.target.checked } })} />
                <span>{step.label}</span>
              </label>
            )}
          </li>
        ))}
      </ol>
      <form className="form" onSubmit={(event) => { event.preventDefault(); void put({ note }, "Saved."); }}>
        <Field label="Notes" hint={props.tracker.updated_at ? `Last changed ${timeAgo(props.tracker.updated_at)}` : "What's agreed, what's waiting, who to call."}>
          <textarea rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Message message={save.message} />
        <div className="actions"><Button type="submit" busy={save.busy}>Save notes</Button></div>
      </form>
    </div>
  );
}

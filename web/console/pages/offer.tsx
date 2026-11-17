// web/console/pages/offer.tsx
//
// What a business offers through Zaina, and setting it up in plain words:
//
//   What you offer     the capabilities it switches on: rooms, table
//                      reservations, appointments (booked here), and things
//                      its team arranges (transfers, activities, orders,
//                      jobs). A hotel can have several.
//   Describe it        the owner writes how they work; Zaina drafts the
//                      settings from their words; the owner checks each item,
//                      fills in what's missing and approves. Nothing is saved
//                      before that.
//
// On the Setup page while a business sets up, and in Settings → What you offer.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { atLeast, type OfferView, type Role } from "../types.ts";
import { Button, ErrorLine, Field, Message, useAction, useLoad } from "../ui.tsx";

type Capability = { key: string; quote: string };
type Room = { name: string; sleeps: number | null; rooms: number | null; price_per_night: number | null; quote: string };
type Service = { kind: "service" | "table"; name: string; minutes: number | null; price: number | null; max_party: number | null; quote: string };
type Extra = { name: string; price: number | null; unit: string | null; capability: string | null; quote: string };
type Deposit = { type: "none" | "percent" | "fixed" | "full"; percent: number | null; amount: number | null; quote: string };
type Draft = {
  capabilities: Capability[];
  rooms: Room[];
  services: Service[];
  extras: Extra[];
  deposit: Deposit | null;
  cancellation: { text: string; quote: string } | null;
  check_in: { time: string; quote: string } | null;
  check_out: { time: string; quote: string } | null;
  facts: Array<{ text: string; quote: string }>;
};
type Drafted = { draft: Draft; dropped: number; questions: string[]; currency: "KES" | "USD" };
type Applied = { saved: { capabilities: string[]; rooms: string[]; services: string[]; prices: string[]; rules: string[]; facts: number }; skipped: Array<{ item: string; reason: string }>; questions: string[] };

const BOOKED_HERE = new Set(["rooms", "tables", "appointments"]);
const EXAMPLE = "We offer three types of rooms. Standard rooms accommodate two guests. Breakfast is included. Airport transfers are available at an additional cost. Reservations require a 30% deposit.";

export function OfferSetup(props: { businessId: string; role: Role; onChanged?: () => void }) {
  const manager = atLeast(props.role, "manager");
  const offer = useLoad(() => api<OfferView>("GET", businessPath(props.businessId, "/capabilities")), [props.businessId]);
  const changed = () => {
    void offer.reload();
    props.onChanged?.();
  };
  return (
    <div className="stack">
      {offer.data ? <WhatYouOffer businessId={props.businessId} offer={offer.data} manager={manager} onSaved={changed} /> : <ErrorLine error={offer.error} />}
      {manager && offer.data ? <DescribeYourBusiness businessId={props.businessId} offer={offer.data} onApplied={changed} /> : null}
    </div>
  );
}

function WhatYouOffer(props: { businessId: string; offer: OfferView; manager: boolean; onSaved: () => void }) {
  const [enabled, setEnabled] = useState<string[]>(props.offer.enabled);
  const action = useAction();
  const toggle = (key: string, on: boolean) => setEnabled((list) => (on ? [...list, key] : list.filter((entry) => entry !== key)));
  // Usual for its industry first; nothing is ticked for the business.
  const ordered = [...props.offer.catalog].sort((left, right) => Number(right.usual) - Number(left.usual));
  const groups = [
    { title: "Booked through Zaina", hint: "She checks what's free, gives the exact price and books, under your rules.", items: ordered.filter((entry) => BOOKED_HERE.has(entry.key)) },
    { title: "Arranged by your team", hint: "She quotes your listed prices and passes each request to you.", items: ordered.filter((entry) => !BOOKED_HERE.has(entry.key)) },
  ];
  const starter = props.offer.enabled.some((key) => BOOKED_HERE.has(key)) && !props.offer.books.rooms && !props.offer.books.services && !props.offer.books.tables;
  const same = enabled.length === props.offer.enabled.length && enabled.every((key) => props.offer.enabled.includes(key));
  return (
    <section className="card stack-tight" data-testid="what-you-offer">
      <h2>What you offer through Zaina</h2>
      <p className="small muted">Tick everything customers can ask Zaina for. A hotel can have rooms, a restaurant, spa appointments and transfers. She only offers what's ticked, and follows your own rules for each.</p>
      {groups.map((group) => (
        <fieldset key={group.title} className="offer-group">
          <legend>{group.title}</legend>
          <p className="small muted">{group.hint}</p>
          {group.items.map((entry) => (
            <label key={entry.key} className="offer-option">
              <input type="checkbox" checked={enabled.includes(entry.key)} disabled={!props.manager} onChange={(event) => toggle(entry.key, event.target.checked)} data-testid={`offer-${entry.key}`} />
              <span>
                <strong>{entry.label}</strong>
                {entry.usual ? <span className="chip">Usual for you</span> : null}
                <span className="small muted block">{entry.what}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ))}
      {starter ? <p className="small muted">On the Starter plan Zaina takes these as requests for your team. Booking them in the chat comes with the Full plan.</p> : null}
      {props.manager ? (
        <div className="actions start">
          <Button kind="primary" disabled={same} busy={action.busy} onClick={() => void action.run(async () => {
            await api("PUT", businessPath(props.businessId, "/capabilities"), { enabled });
            props.onSaved();
          }, "Saved. Zaina works this way from her next message.")}>Save what you offer</Button>
        </div>
      ) : null}
      <Message message={action.message} />
    </section>
  );
}

const numberOrNull = (value: string) => (value.trim() === "" || !Number.isFinite(Number(value.replace(/,/g, ""))) ? null : Number(value.replace(/,/g, "")));
const show = (value: number | null) => (value === null ? "" : String(value));

function Quote(props: { text: string }) {
  return props.text ? <p className="quote small">“{props.text}”</p> : null;
}

function DescribeYourBusiness(props: { businessId: string; offer: OfferView; onApplied: () => void }) {
  const [text, setText] = useState("");
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // What the owner keeps: each item can be left out before approving.
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [applied, setApplied] = useState<Applied | null>(null);
  const action = useAction();
  const label = (key: string) => props.offer.catalog.find((entry) => entry.key === key)?.label ?? key;
  const keep = (id: string) => kept[id] !== false;
  const set = (id: string, on: boolean) => setKept((current) => ({ ...current, [id]: on }));

  const read = () => void action.run(async () => {
    const result = await api<Drafted>("POST", businessPath(props.businessId, "/setup/describe"), { text });
    setDrafted(result);
    setDraft(result.draft);
    setKept({});
    setApplied(null);
  });

  const approve = () => {
    if (!draft) return;
    const approved: Draft = {
      capabilities: draft.capabilities.filter((_, index) => keep(`cap${index}`)),
      rooms: draft.rooms.filter((_, index) => keep(`room${index}`)),
      services: draft.services.filter((_, index) => keep(`service${index}`)),
      extras: draft.extras.filter((_, index) => keep(`extra${index}`)),
      deposit: draft.deposit && keep("deposit") ? draft.deposit : null,
      cancellation: draft.cancellation && keep("cancellation") ? draft.cancellation : null,
      check_in: draft.check_in && keep("check_in") ? draft.check_in : null,
      check_out: draft.check_out && keep("check_out") ? draft.check_out : null,
      facts: draft.facts.filter((_, index) => keep(`fact${index}`)),
    };
    void action.run(async () => {
      const result = await api<Applied>("POST", businessPath(props.businessId, "/setup/apply"), { draft: approved });
      setApplied(result);
      setDrafted(null);
      setDraft(null);
      props.onApplied();
    });
  };

  const update = <K extends "rooms" | "services" | "extras">(list: K, index: number, patch: Partial<Draft[K][number]>) =>
    setDraft((current) => (current ? { ...current, [list]: current[list].map((entry, at) => (at === index ? { ...entry, ...patch } : entry)) } : current));
  const currency = drafted?.currency === "USD" ? "US$" : "KSh";
  const missing = (value: number | null) => (value === null ? "needed" : undefined);

  return (
    <section className="card stack-tight" data-testid="describe-business">
      <h2>Describe how you work</h2>
      <p className="small muted">
        In your own words: what you offer, what it costs, and your rules (deposits, cancellations, times). Zaina drafts your settings from what you write. She never adds a price or a rule you didn't write. Nothing is saved until you check it and approve.
      </p>
      {!draft ? (
        <>
          <Field label="How your business works">
            <textarea rows={6} maxLength={6000} value={text} onChange={(event) => setText(event.target.value)} placeholder={EXAMPLE} data-testid="describe-text" />
          </Field>
          <div className="actions start">
            <Button kind="primary" disabled={text.trim().length < 20} busy={action.busy} onClick={read}>Draft my setup</Button>
          </div>
        </>
      ) : (
        <div className="stack-tight" data-testid="draft-review">
          <p className="message">Check each item. Untick anything that's wrong, fill in what's missing, then approve.{drafted && drafted.dropped > 0 ? ` ${drafted.dropped} suggestion${drafted.dropped === 1 ? " was" : "s were"} left out because your words didn't say ${drafted.dropped === 1 ? "it" : "them"}.` : ""}</p>

          {draft.capabilities.length ? (
            <fieldset className="offer-group">
              <legend>What you offer</legend>
              {draft.capabilities.map((entry, index) => (
                <label key={entry.key} className="offer-option">
                  <input type="checkbox" checked={keep(`cap${index}`)} onChange={(event) => set(`cap${index}`, event.target.checked)} />
                  <span><strong>{label(entry.key)}</strong><Quote text={entry.quote} /></span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {draft.rooms.map((room, index) => (
            <fieldset key={`room${index}`} className="offer-group draft-item">
              <legend><label><input type="checkbox" checked={keep(`room${index}`)} onChange={(event) => set(`room${index}`, event.target.checked)} /> Room type</label></legend>
              <Quote text={room.quote} />
              <div className="form">
                <Field label="Name"><input value={room.name} maxLength={120} onChange={(event) => update("rooms", index, { name: event.target.value })} /></Field>
                <Field label="Guests one room sleeps" hint={missing(room.sleeps)}><input type="number" inputMode="numeric" min={1} max={50} value={show(room.sleeps)} onChange={(event) => update("rooms", index, { sleeps: numberOrNull(event.target.value) })} /></Field>
                <Field label="How many of these rooms" hint={missing(room.rooms)}><input type="number" inputMode="numeric" min={1} max={500} value={show(room.rooms)} onChange={(event) => update("rooms", index, { rooms: numberOrNull(event.target.value) })} /></Field>
                <Field label={`Price a night (${currency})`} hint={missing(room.price_per_night)}><input inputMode="decimal" value={show(room.price_per_night)} onChange={(event) => update("rooms", index, { price_per_night: numberOrNull(event.target.value) })} /></Field>
              </div>
            </fieldset>
          ))}

          {draft.services.map((service, index) => (
            <fieldset key={`service${index}`} className="offer-group draft-item">
              <legend><label><input type="checkbox" checked={keep(`service${index}`)} onChange={(event) => set(`service${index}`, event.target.checked)} /> {service.kind === "table" ? "Table reservation" : "Appointment"}</label></legend>
              <Quote text={service.quote} />
              <div className="form">
                <Field label="Name"><input value={service.name} maxLength={120} onChange={(event) => update("services", index, { name: event.target.value })} /></Field>
                <Field label={service.kind === "table" ? "Table held for (minutes)" : "Takes (minutes)"} hint={missing(service.minutes)}><input type="number" inputMode="numeric" min={5} max={720} value={show(service.minutes)} onChange={(event) => update("services", index, { minutes: numberOrNull(event.target.value) })} /></Field>
                {service.kind === "table" ? <Field label="Largest party" hint={missing(service.max_party)}><input type="number" inputMode="numeric" min={1} max={50} value={show(service.max_party)} onChange={(event) => update("services", index, { max_party: numberOrNull(event.target.value) })} /></Field> : null}
                <Field label={`Price (${currency})`} hint={service.kind === "service" ? missing(service.price) : "empty: no charge to book"}><input inputMode="decimal" value={show(service.price)} onChange={(event) => update("services", index, { price: numberOrNull(event.target.value) })} /></Field>
              </div>
            </fieldset>
          ))}

          {draft.extras.map((extra, index) => (
            <fieldset key={`extra${index}`} className="offer-group draft-item">
              <legend><label><input type="checkbox" checked={keep(`extra${index}`)} onChange={(event) => set(`extra${index}`, event.target.checked)} /> Price list{extra.capability ? `: ${label(extra.capability)}` : ""}</label></legend>
              <Quote text={extra.quote} />
              <div className="form">
                <Field label="Name"><input value={extra.name} maxLength={120} onChange={(event) => update("extras", index, { name: event.target.value })} /></Field>
                <Field label={`Price (${currency})`} hint={extra.price === null ? "needed, or Zaina says the team will confirm it" : undefined}><input inputMode="decimal" value={show(extra.price)} onChange={(event) => update("extras", index, { price: numberOrNull(event.target.value) })} /></Field>
                <Field label="Per" hint="Optional, like per car"><input value={extra.unit ?? ""} maxLength={40} onChange={(event) => update("extras", index, { unit: event.target.value || null })} /></Field>
              </div>
            </fieldset>
          ))}

          {draft.deposit || draft.check_in || draft.check_out || draft.cancellation ? (
            <fieldset className="offer-group">
              <legend>Your rules</legend>
              {draft.deposit ? (
                <label className="offer-option">
                  <input type="checkbox" checked={keep("deposit")} onChange={(event) => set("deposit", event.target.checked)} />
                  <span>
                    <strong>To confirm a booking: {draft.deposit.type === "percent" ? `${draft.deposit.percent}% deposit` : draft.deposit.type === "fixed" ? `${currency} ${draft.deposit.amount?.toLocaleString("en")} deposit` : draft.deposit.type === "full" ? "paid in full" : "nothing before arrival"}</strong>
                    <Quote text={draft.deposit.quote} />
                  </span>
                </label>
              ) : null}
              {draft.check_in ? <label className="offer-option"><input type="checkbox" checked={keep("check_in")} onChange={(event) => set("check_in", event.target.checked)} /><span><strong>Check-in from {draft.check_in.time}</strong><Quote text={draft.check_in.quote} /></span></label> : null}
              {draft.check_out ? <label className="offer-option"><input type="checkbox" checked={keep("check_out")} onChange={(event) => set("check_out", event.target.checked)} /><span><strong>Check-out by {draft.check_out.time}</strong><Quote text={draft.check_out.quote} /></span></label> : null}
              {draft.cancellation ? <label className="offer-option"><input type="checkbox" checked={keep("cancellation")} onChange={(event) => set("cancellation", event.target.checked)} /><span><strong>Cancellation</strong><Quote text={draft.cancellation.text} /></span></label> : null}
            </fieldset>
          ) : null}

          {draft.facts.length ? (
            <fieldset className="offer-group">
              <legend>For Zaina to know</legend>
              {draft.facts.map((fact, index) => (
                <label key={`fact${index}`} className="offer-option">
                  <input type="checkbox" checked={keep(`fact${index}`)} onChange={(event) => set(`fact${index}`, event.target.checked)} />
                  <span>{fact.text}</span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {drafted?.questions.length ? (
            <div className="offer-notes">
              <strong>Still to tell Zaina</strong>
              <ul className="small">{drafted.questions.map((question) => <li key={question}>{question}</li>)}</ul>
            </div>
          ) : null}

          <div className="actions start">
            <Button kind="primary" busy={action.busy} onClick={approve}>Approve and save</Button>
            <Button kind="ghost" onClick={() => { setDraft(null); setDrafted(null); }}>Start again</Button>
          </div>
        </div>
      )}

      {applied ? (
        <div className="stack-tight" data-testid="draft-applied">
          <p className="message success">
            Saved{[
              applied.saved.rooms.length ? `${applied.saved.rooms.length} room type${applied.saved.rooms.length === 1 ? "" : "s"}` : "",
              applied.saved.services.length ? `${applied.saved.services.length} service${applied.saved.services.length === 1 ? "" : "s"}` : "",
              applied.saved.prices.length ? `${applied.saved.prices.length} price${applied.saved.prices.length === 1 ? "" : "s"}` : "",
              applied.saved.rules.length ? applied.saved.rules.join(", ") : "",
              applied.saved.facts ? `${applied.saved.facts} thing${applied.saved.facts === 1 ? "" : "s"} for Zaina to know` : "",
            ].filter(Boolean).join("; ").replace(/^/, ": ") || "."}
          </p>
          {applied.skipped.length ? (
            <div className="offer-notes"><strong>Not saved</strong><ul className="small">{applied.skipped.map((entry) => <li key={entry.item + entry.reason}>{entry.item}: {entry.reason}.</li>)}</ul></div>
          ) : null}
          {applied.questions.length ? (
            <div className="offer-notes"><strong>Still to tell Zaina</strong><ul className="small">{applied.questions.map((question) => <li key={question}>{question}</li>)}</ul></div>
          ) : null}
        </div>
      ) : null}
      <Message message={action.message} />
    </section>
  );
}

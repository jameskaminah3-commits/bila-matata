// web/console/pages/business-cards.tsx
//
// Settings → Business cards: premium cards with the business's brand on the
// front and its QR code on the back. A scan of a card goes wherever the
// business's Zaina works (Settings → QR code & link), and card scans are
// counted on their own.
//
// The details are saved with the business; the cards print ten to an A4
// sheet at the standard 85 × 55 mm, fronts on one page and backs on the
// next (print both sides, flipping on the long edge), with crop marks and a
// bleed so coloured edges cut clean. The studio can print them instead.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, businessPath } from "../api.ts";
import { go } from "../app.tsx";
import { atLeast, type Role } from "../types.ts";
import { Button, ErrorLine, Field, Message, useAction, useLoad } from "../ui.tsx";
import { svgUri, type CardDetails, type Door } from "./front-door.tsx";

type Design = CardDetails["design"];
const DESIGNS: Array<{ id: Design; name: string; text: string }> = [
  { id: "signature", name: "Signature", text: "Clean white front, your colour on the back." },
  { id: "minimal", name: "Minimal", text: "White on both sides, with a fine line of your colour." },
  { id: "bold", name: "Bold", text: "Your colour across the front, a white back." },
];
const blank = (contact: Door["contact"]): CardDetails => ({
  design: "signature", personName: null, personTitle: null, phone: contact.phone, email: contact.email, website: contact.website?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null, address: null,
});

const lettersOf = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
};

export function BusinessCards(props: { businessId: string; role: Role }) {
  const loaded = useLoad(() => api<Door>("GET", businessPath(props.businessId, "/front-door")), [props.businessId]);
  const [card, setCard] = useState<CardDetails | null>(null);
  const [printing, setPrinting] = useState(false);
  const save = useAction();
  const order = useAction();
  const canEdit = atLeast(props.role, "manager");
  useEffect(() => {
    if (loaded.data) setCard(loaded.data.card ?? blank(loaded.data.contact));
  }, [loaded.data]);
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done, { once: true });
    const timer = setTimeout(() => window.print(), 200);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);
  const door = loaded.data;
  if (!door || !card) return <ErrorLine error={loaded.error} />;
  const set = <K extends keyof CardDetails>(key: K, value: CardDetails[K]) => setCard({ ...card, [key]: value });
  const text = (key: Exclude<keyof CardDetails, "design">) => card[key] ?? "";
  const persist = () => api("PATCH", businessPath(props.businessId, "/settings"), { cardDetails: card });

  return (
    <div className="stack">
      <section className="card">
        <h2>Premium business cards</h2>
        <p className="muted">Your brand on the front, your QR code on the back. Whoever scans it reaches {door.assistant}, your {door.role}, wherever you've chosen ({door.destination.effective === "page" ? "your page here" : door.destination.effective === "website" ? "your website" : "your WhatsApp"}): every card you hand out keeps working day and night.</p>
        <div className="bcard-preview">
          <figure><CardFront door={door} card={card} /><figcaption>Front</figcaption></figure>
          <figure><CardBack door={door} card={card} /><figcaption>Back</figcaption></figure>
        </div>
        <fieldset className="bcard-designs">
          <legend>Design</legend>
          {DESIGNS.map((design) => (
            <label key={design.id} className={`bcard-design${card.design === design.id ? " on" : ""}`}>
              <input type="radio" name="design" className="visually-hidden" checked={card.design === design.id} disabled={!canEdit} onChange={() => set("design", design.id)} />
              <span className={`bcard-swatch ${design.id}`} ref={(node) => node?.style.setProperty("--card-brand", door.color)} aria-hidden="true"><i /><i /></span>
              <strong>{design.name}</strong>
              <span className="muted small">{design.text}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <form
        className="form card"
        onSubmit={async (event) => {
          event.preventDefault();
          await save.run(persist, "Saved. Your cards are ready to print.");
        }}
      >
        <h2>What the card says</h2>
        <p className="muted small">Leave a line empty and it isn't printed. Your name, logo and colour come from Brand.</p>
        <div className="form-row">
          <Field label="Name on the card" hint="Optional: a person, for example the owner or a manager."><input maxLength={60} disabled={!canEdit} value={text("personName")} onChange={(event) => set("personName", event.target.value || null)} /></Field>
          <Field label="Their title"><input maxLength={60} disabled={!canEdit} value={text("personTitle")} onChange={(event) => set("personTitle", event.target.value || null)} placeholder="Owner" /></Field>
        </div>
        <div className="form-row">
          <Field label="Phone"><input maxLength={40} disabled={!canEdit} value={text("phone")} onChange={(event) => set("phone", event.target.value || null)} placeholder="+254 700 000 000" /></Field>
          <Field label="Email"><input type="email" maxLength={120} disabled={!canEdit} value={text("email")} onChange={(event) => set("email", event.target.value || null)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Website"><input maxLength={120} disabled={!canEdit} value={text("website")} onChange={(event) => set("website", event.target.value || null)} placeholder="yourbusiness.co.ke" /></Field>
          <Field label="Address"><input maxLength={120} disabled={!canEdit} value={text("address")} onChange={(event) => set("address", event.target.value || null)} placeholder="Links Road, Nyali, Mombasa" /></Field>
        </div>
        <Message message={save.message} />
        {canEdit ? <div className="actions"><Button kind="primary" type="submit" busy={save.busy}>Save</Button></div> : <p className="muted small">Managers and owners can change these.</p>}
      </form>

      <section className="card">
        <h2>Print them</h2>
        <div className="print-choices">
          <div className="print-choice">
            <h3>Print them yourself</h3>
            <p className="muted small">Ten cards to an A4 sheet at the standard 85 × 55 mm. Print both sides on thick card (300 gsm or more), flipping on the long edge, then cut along the marks. Choose "Save as PDF" to take it to a print shop.</p>
            <Button small kind="primary" onClick={() => void (canEdit ? save.run(persist) : Promise.resolve(true)).then(() => setPrinting(true))}>Print the sheet</Button>
          </div>
          <div className="print-choice">
            <h3>Let us print them</h3>
            <p className="muted small">We print them for you on premium card and deliver them. Tell us how many, and we'll come back with a price before anything is printed.</p>
            {atLeast(props.role, "agent") ? (
              <Button
                small
                busy={order.busy}
                onClick={() => void order.run(async () => {
                  if (canEdit) await persist();
                  const lines = [
                    `Please print our business cards (${DESIGNS.find((design) => design.id === card.design)!.name} design).`,
                    "How many: (for example 100, 250 or 500)",
                    "Deliver to:",
                    "",
                    "The card says:",
                    ...[card.personName && `${card.personName}${card.personTitle ? `, ${card.personTitle}` : ""}`, card.phone, card.email, card.website, card.address].filter(Boolean) as string[],
                  ];
                  const thread = await api<{ thread: { id: string } }>("POST", businessPath(props.businessId, "/support"), { subject: "Printed business cards", topic: "idea", message: lines.join("\n") });
                  // Open the new conversation, so they can say how many and where to.
                  go({ businessId: props.businessId, page: "support", id: thread.thread.id });
                })}
              >
                Ask us to print them
              </Button>
            ) : null}
            <Message message={order.message} />
          </div>
        </div>
      </section>

      {printing ? createPortal(<CardSheets door={door} card={card} />, document.body) : null}
    </div>
  );
}

function Logo(props: { door: Door; light?: boolean }) {
  const { door } = props;
  return <span className={`bc-logo${door.logo_url ? "" : " letters"}${props.light ? " light" : ""}`}>{door.logo_url ? <img src={door.logo_url} alt="" /> : lettersOf(door.name)}</span>;
}

const ICON: Record<string, ReactNode> = {
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  website: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  address: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
};

function Lines(props: { card: CardDetails }) {
  const rows = (["phone", "email", "website", "address"] as const).filter((key) => props.card[key]);
  return (
    <ul className="bc-lines">
      {rows.map((key) => (
        <li key={key}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[key]}</svg><span>{props.card[key]}</span></li>
      ))}
    </ul>
  );
}

/** The front: the business, a person (if any), how to reach them. */
export function CardFront(props: { door: Door; card: CardDetails }) {
  const { door, card } = props;
  return (
    <div className={`bc bc-front ${card.design}`} ref={(node) => node?.style.setProperty("--card-brand", door.color)}>
      <div className="bc-top">
        <Logo door={door} light={card.design === "bold"} />
        <div className="bc-brand">
          <p className="bc-name">{door.name}</p>
          {door.tagline ? <p className="bc-tagline">{door.tagline}</p> : null}
        </div>
      </div>
      <div className="bc-bottom">
        {card.personName ? <div className="bc-person"><p className="bc-person-name">{card.personName}</p>{card.personTitle ? <p className="bc-person-title">{card.personTitle}</p> : null}</div> : null}
        <Lines card={card} />
      </div>
    </div>
  );
}

/** The back: the QR code, and what it does. */
export function CardBack(props: { door: Door; card: CardDetails }) {
  const { door, card } = props;
  return (
    <div className={`bc bc-back ${card.design}`} ref={(node) => node?.style.setProperty("--card-brand", door.color)}>
      <div className="bc-qr"><img src={svgUri(door.card_qr_svg)} alt="" /></div>
      <div className="bc-call">
        <p className="bc-call-title">Scan to chat with us</p>
        <p className="bc-call-text">Ask, check what's available or book: {door.assistant}, our {door.role}, answers day and night.</p>
      </div>
    </div>
  );
}

/** Two A4 pages: ten fronts, then ten backs, with crop marks and a bleed. */
function CardSheets(props: { door: Door; card: CardDetails }) {
  const cuts = { x: [20, 105, 190], y: [11, 66, 121, 176, 231, 286] };
  const marks = (
    <>
      {cuts.x.map((x) => <span key={`t${x}`} className="crop v" ref={(node) => { node?.style.setProperty("left", `${x}mm`); node?.style.setProperty("top", "0"); }} />)}
      {cuts.x.map((x) => <span key={`b${x}`} className="crop v" ref={(node) => { node?.style.setProperty("left", `${x}mm`); node?.style.setProperty("top", "289mm"); }} />)}
      {cuts.y.map((y) => <span key={`l${y}`} className="crop h" ref={(node) => { node?.style.setProperty("top", `${y}mm`); node?.style.setProperty("left", "0"); }} />)}
      {cuts.y.map((y) => <span key={`r${y}`} className="crop h" ref={(node) => { node?.style.setProperty("top", `${y}mm`); node?.style.setProperty("left", "202mm"); }} />)}
    </>
  );
  const page = (side: "front" | "back") => (
    <div className={`bc-page ${side} ${props.card.design}`} ref={(node) => node?.style.setProperty("--card-brand", props.door.color)}>
      {marks}
      <div className="bc-grid">
        {Array.from({ length: 10 }, (_, index) => (side === "front" ? <CardFront key={index} door={props.door} card={props.card} /> : <CardBack key={index} door={props.door} card={props.card} />))}
      </div>
    </div>
  );
  return <div className="print-root cards">{page("front")}{page("back")}</div>;
}


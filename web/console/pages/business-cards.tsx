// web/console/pages/business-cards.tsx
//
// Settings → Business cards: premium cards that come with every active Zaina
// plan. The business's brand on the front; on the back, its QR code, which
// sends each scan wherever its Zaina works (Settings → QR code & link).
//
// What is shown is exactly what is printed: the server draws each side as a
// vector picture (real typefaces, the business's colour and logo), and the
// downloads are made from those same pictures: an A4 sheet of ten to print
// at home or the office, a print shop's file with bleed, pictures of each
// side, and one to share on WhatsApp. The studio can also print them, as a
// service.

import { useEffect, useRef, useState } from "react";
import { api, ApiError, businessPath } from "../api.ts";
import { go } from "../app.tsx";
import { cardPng, printSheetPdf, printShopPdf, shareImage, shareOrSave } from "../card-export.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, ErrorLine, Field, Message, useAction } from "../ui.tsx";
import { download, svgUri, type CardDetails } from "./front-door.tsx";

type Design = CardDetails["design"];
type Rendered = { name: string; design: Design; details: CardDetails; front: string; back: string; thumbnails?: Record<Design, string> };

const DESIGNS: Array<{ id: Design; name: string; text: string }> = [
  { id: "signature", name: "Signature", text: "Deep and refined, with a serif name." },
  { id: "minimal", name: "Minimal", text: "Crisp white, with your colour on the back." },
  { id: "bold", name: "Bold", text: "A panel of your colour, modern and confident." },
];

export function BusinessCards(props: { businessId: string; role: Role }) {
  const path = businessPath(props.businessId, "/business-card");
  const [card, setCard] = useState<CardDetails | null>(null);
  const [view, setView] = useState<Rendered | null>(null);
  const [thumbs, setThumbs] = useState<Record<Design, string> | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const save = useAction();
  const files = useAction();
  const order = useAction();
  const canEdit = atLeast(props.role, "manager");
  const typed = useRef(false);

  // The saved card, and every design's front to choose from.
  useEffect(() => {
    let live = true;
    api<Rendered>("POST", path, { thumbnails: true })
      .then((result) => {
        if (!live) return;
        setCard(result.details);
        setView(result);
        setThumbs(result.thumbnails ?? null);
      })
      .catch((problem) => {
        if (!live) return;
        if (problem instanceof ApiError && problem.status === 402) setLocked(problem.message);
        else setError(problem instanceof ApiError ? problem.message : "The card couldn't be drawn.");
      });
    return () => {
      live = false;
    };
  }, [path]);

  // As the details change, the card is drawn again (a moment after typing stops).
  useEffect(() => {
    if (!card || !typed.current) return;
    setDrawing(true);
    const timer = setTimeout(() => {
      api<Rendered>("POST", path, { details: card, thumbnails: true })
        .then((result) => {
          setView(result);
          setThumbs(result.thumbnails ?? null);
        })
        .catch((problem) => setError(problem instanceof ApiError ? problem.message : "The card couldn't be drawn."))
        .finally(() => setDrawing(false));
    }, 380);
    return () => clearTimeout(timer);
  }, [card, path]);

  if (locked) {
    return (
      <section className="card bc-locked">
        <h2>Premium business cards</h2>
        <p className="muted">{locked}</p>
        <p className="muted small">Every active plan includes them: your brand on the front, your QR code on the back, ready to print or share.</p>
        <div className="actions start"><Button kind="primary" onClick={() => go({ businessId: props.businessId, page: "settings", id: "billing" })}>Plan &amp; billing</Button></div>
      </section>
    );
  }
  if (!card || !view) return error ? <ErrorLine error={error} /> : <p className="muted">Drawing your card…</p>;

  const set = <K extends keyof CardDetails>(key: K, value: CardDetails[K]) => {
    typed.current = true;
    setCard({ ...card, [key]: value });
  };
  const text = (key: Exclude<keyof CardDetails, "design">) => card[key] ?? "";
  const file = props.businessId;
  const title = `${view.name}: business cards`;
  /** The current card with its 3 mm print margin, for the print files. */
  const withBleed = () => api<Rendered>("POST", path, { details: card, bleed: true });
  const make = (label: string, task: () => Promise<unknown>, done: string) => {
    setWorking(label);
    void files.run(task, done).finally(() => setWorking(null));
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="bc-head">
          <div>
            <h2>Your business card</h2>
            <p className="muted">Your brand on the front. On the back, your QR code: whoever scans it reaches your Zaina, day and night. Included with your plan.</p>
          </div>
          {drawing ? <span className="bc-drawing" role="status">Updating…</span> : null}
        </div>
        <div className={`bc-stage${drawing ? " busy" : ""}`}>
          <figure><img src={svgUri(view.front)} alt="The front of your business card" /><figcaption>Front</figcaption></figure>
          <figure><img src={svgUri(view.back)} alt="The back of your business card, with its QR code" /><figcaption>Back</figcaption></figure>
        </div>
        <fieldset className="bc-designs">
          <legend>Design</legend>
          {DESIGNS.map((design) => (
            <label key={design.id} className={`bc-design${card.design === design.id ? " on" : ""}`}>
              <input type="radio" name="design" className="visually-hidden" checked={card.design === design.id} onChange={() => set("design", design.id)} />
              {thumbs?.[design.id] ? <img src={svgUri(thumbs[design.id])} alt="" /> : <span className="bc-thumb-empty" />}
              <span className="bc-design-text"><strong>{design.name}</strong><span className="muted small">{design.text}</span></span>
            </label>
          ))}
        </fieldset>
      </section>

      <form
        className="form card"
        onSubmit={async (event) => {
          event.preventDefault();
          await save.run(() => api("PATCH", businessPath(props.businessId, "/settings"), { cardDetails: card }), "Saved. This is now your card.");
        }}
      >
        <h2>What it says</h2>
        <p className="muted small">Your name, logo, colour and welcome line come from Brand. Leave a line empty and it isn't printed.</p>
        <div className="form-row">
          <Field label="Name on the card" hint="Optional: a person, such as the owner or a manager."><input maxLength={60} value={text("personName")} onChange={(event) => set("personName", event.target.value || null)} /></Field>
          <Field label="Their title"><input maxLength={60} value={text("personTitle")} onChange={(event) => set("personTitle", event.target.value || null)} placeholder="Owner" /></Field>
        </div>
        <div className="form-row">
          <Field label="Phone"><input maxLength={40} value={text("phone")} onChange={(event) => set("phone", event.target.value || null)} placeholder="+254 700 000 000" /></Field>
          <Field label="Email"><input type="email" maxLength={120} value={text("email")} onChange={(event) => set("email", event.target.value || null)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Website"><input maxLength={120} value={text("website")} onChange={(event) => set("website", event.target.value || null)} placeholder="yourbusiness.co.ke" /></Field>
          <Field label="Address"><input maxLength={120} value={text("address")} onChange={(event) => set("address", event.target.value || null)} placeholder="Links Road, Nyali, Mombasa" /></Field>
        </div>
        <Message message={save.message} />
        {canEdit ? <div className="actions"><Button kind="primary" type="submit" busy={save.busy}>Save as our card</Button></div> : <p className="muted small">You can try changes and download them; managers and owners can save them as the business's card.</p>}
      </form>

      <section className="card">
        <h2>Download and share</h2>
        <div className="bc-files">
          <div className="bc-file">
            <h3>Print at home or the office</h3>
            <p className="muted small">A4 PDF with ten cards a sheet and cut marks. Print both sides on 300 gsm card, flipping on the long edge.</p>
            <Button kind="primary" small busy={working === "sheet"} onClick={() => make("sheet", async () => {
              const bled = await withBleed();
              download(`${file}-business-cards-a4.pdf`, await printSheetPdf(bled.front, bled.back, title));
            }, "Your A4 sheet is downloaded.")}>Download A4 PDF</Button>
          </div>
          <div className="bc-file">
            <h3>For a print shop</h3>
            <p className="muted small">The front and back at 85 × 55 mm with 3 mm bleed, 600 dpi: the file print shops ask for.</p>
            <Button small busy={working === "shop"} onClick={() => make("shop", async () => {
              const bled = await withBleed();
              download(`${file}-business-card-print.pdf`, await printShopPdf(bled.front, bled.back, title));
            }, "Your print shop file is downloaded.")}>Download print file</Button>
          </div>
          <div className="bc-file">
            <h3>Share it</h3>
            <p className="muted small">Both sides in one picture: send it on WhatsApp, post it on your status or social media.</p>
            <Button small busy={working === "share"} onClick={() => make("share", async () => {
              const picture = await shareImage(view.front, view.back);
              const outcome = await shareOrSave(new File([picture], `${file}-business-card.png`, { type: "image/png" }), `${view.name}: scan the code to chat with us.`, download);
              if (outcome === "saved") files.setMessage({ kind: "success", text: "Your card picture is downloaded, ready to share." });
            }, "Shared.")}>Share</Button>
          </div>
          <div className="bc-file">
            <h3>Pictures</h3>
            <p className="muted small">Each side as a high-resolution picture, for your website, email signature or a designer.</p>
            <div className="actions start">
              <Button small busy={working === "front"} onClick={() => make("front", async () => download(`${file}-card-front.png`, await cardPng(view.front)), "The front is downloaded.")}>Front</Button>
              <Button small busy={working === "back"} onClick={() => make("back", async () => download(`${file}-card-back.png`, await cardPng(view.back)), "The back is downloaded.")}>Back</Button>
            </div>
          </div>
        </div>
        <Message message={files.message} />
      </section>

      <section className="card bc-service">
        <div>
          <h2>Let us print them</h2>
          <p className="muted">We print your cards on premium card stock and deliver them. Tell us how many, and we'll send you a price before anything is printed.</p>
        </div>
        {atLeast(props.role, "agent") ? (
          <Button
            busy={order.busy}
            onClick={() => void order.run(async () => {
              const lines = [
                `Please print our business cards (${DESIGNS.find((design) => design.id === card.design)!.name} design).`,
                "How many: (for example 100, 250 or 500)",
                "Deliver to:",
                "",
                "The card says:",
                ...[card.personName && `${card.personName}${card.personTitle ? `, ${card.personTitle}` : ""}`, card.phone, card.email, card.website, card.address].filter(Boolean) as string[],
              ];
              const thread = await api<{ thread: { id: string } }>("POST", businessPath(props.businessId, "/support"), { subject: "Printed business cards", topic: "idea", message: lines.join("\n") });
              // The conversation opens, so they can say how many and where to.
              go({ businessId: props.businessId, page: "support", id: thread.thread.id });
            })}
          >
            Ask us to print them
          </Button>
        ) : null}
        <Message message={order.message} />
      </section>
    </div>
  );
}

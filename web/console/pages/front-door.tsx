// web/console/pages/front-door.tsx
//
// Settings → QR code & link: the business's own page on this service, for a
// business with no website (and a handy link for one that has): its address,
// the QR code that opens it, three things to print (a poster, table cards,
// stickers), and how many people came through it and started a chat.
//
// What is printed is drawn here and shown only to the printer: the page's
// own print styles hide the dashboard and show the sheet.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, businessPath } from "../api.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, ErrorLine, Field, Message, Toggle, useAction, useLoad } from "../ui.tsx";

type Destination = "page" | "website" | "whatsapp";
export type Door = {
  url: string;
  scan_url: string;
  card_url: string;
  qr_svg: string;
  qr_classic_svg: string;
  card_qr_svg: string;
  destination: {
    chosen: Destination;
    effective: Destination;
    website: { url: string | null; problem?: string };
    whatsapp: { number: string | null; problem?: string };
  };
  card: CardDetails | null;
  contact: { phone: string | null; email: string | null; website: string | null };
  open: boolean;
  live: boolean;
  name: string;
  tagline: string | null;
  assistant: string;
  role: string;
  color: string;
  logo_url: string | null;
  stats: { days: number; qr: { visits: number; chats: number }; link: { visits: number; chats: number }; card: { visits: number; chats: number } };
};
export type CardDetails = { design: "signature" | "minimal" | "bold"; personName: string | null; personTitle: string | null; phone: string | null; email: string | null; website: string | null; address: string | null };
type Sheet = "poster" | "cards" | "stickers";

export const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function download(name: string, blob: Blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

/** The QR code as a PNG big enough to print well. */
export async function qrPng(svg: string, pixels = 2400): Promise<Blob> {
  const image = new Image();
  image.src = svgUri(svg);
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = pixels;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, pixels, pixels);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no picture"))), "image/png"));
}

export function FrontDoor(props: { businessId: string; role: Role }) {
  const loaded = useLoad(() => api<Door>("GET", businessPath(props.businessId, "/front-door")), [props.businessId]);
  const [door, setDoor] = useState<Door | null>(null);
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // Numbered table cards: each with its own code, which tells Zaina where the customer is ("Table 5").
  const [numbering, setNumbering] = useState({ label: "Table", count: 10 });
  const [numbered, setNumbered] = useState<Array<{ spot: string; svg: string }> | null>(null);
  const numberedAction = useAction();
  const [classic, setClassic] = useState(false);
  const action = useAction();
  const route = useAction();
  const canEdit = atLeast(props.role, "manager");
  useEffect(() => setDoor(loaded.data), [loaded.data]);
  // Print once the sheet is on the page, then put the dashboard back.
  useEffect(() => {
    if (!sheet) return;
    const done = () => {
      setSheet(null);
      setNumbered(null);
    };
    window.addEventListener("afterprint", done, { once: true });
    const timer = setTimeout(() => window.print(), 150);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", done);
    };
  }, [sheet]);
  if (!door) return <ErrorLine error={loaded.error} />;
  const file = props.businessId;
  const svg = classic ? door.qr_classic_svg : door.qr_svg;
  const where: Record<Destination, string> = {
    page: "your page here, with the chat open",
    website: "your website, with the chat open",
    whatsapp: "your WhatsApp, with a first message ready",
  };
  const scans = door.stats.qr.visits;
  const visits = door.stats.link.visits;
  const chats = door.stats.qr.chats + door.stats.link.chats + door.stats.card.chats;

  return (
    <div className="stack">
      <section className="card">
        <h2>Your QR code and link</h2>
        <p className="muted">
          No website? This is your business's own page: your name, your logo and {door.assistant}, your {door.role}, ready to answer.
          Put the QR code where your customers are (the counter, the door, tables, receipts, flyers) and share the link on WhatsApp, Instagram or Facebook.
        </p>
        {!door.live ? <p className="message error">Customers can open this page once your business is live. You can print the code now: it won't change.</p> : null}
        {!door.open ? <p className="message error">Your page is closed: people who scan the code see "This page isn't available".</p> : null}
        <div className="door-grid">
          <div className="door-qr-col">
            <div className={`door-qr${classic ? "" : " premium"}`}><img src={svgUri(svg)} alt={`QR code for ${door.name}`} width={220} height={220} /></div>
            <div className="segmented" role="group" aria-label="Style">
              <button type="button" aria-pressed={!classic} onClick={() => setClassic(false)}>Branded</button>
              <button type="button" aria-pressed={classic} onClick={() => setClassic(true)}>Classic</button>
            </div>
          </div>
          <div className="door-side">
            <p className="door-link"><a href={door.url} target="_blank" rel="noreferrer">{door.url.replace(/^https?:\/\//, "")}</a></p>
            <div className="actions start">
              <Button small onClick={() => void navigator.clipboard.writeText(door.url).then(() => setCopied(true))}>{copied ? "Copied" : "Copy the link"}</Button>
              <Button small onClick={() => void qrPng(svg).then((blob) => download(`${file}-qr${classic ? "-classic" : ""}.png`, blob))}>Download PNG</Button>
              <Button small onClick={() => download(`${file}-qr${classic ? "-classic" : ""}.svg`, new Blob([svg], { type: "image/svg+xml" }))}>Download SVG</Button>
            </div>
            <p className="muted small">
              {classic ? "Classic is plain black and white: the most widely readable, for faxed, photocopied or very small prints." : "Branded carries your colour and your logo, and stays fully readable: the code is built to recover what the logo covers."}
              {" "}The code never changes, so anything you print stays good. PNG suits documents and social posts; SVG stays sharp at any size for a printer or designer. Print it at least 2 cm wide.
            </p>
            {canEdit ? (
              <Toggle
                checked={door.open}
                label={door.open ? "The page is open" : "The page is closed"}
                disabled={action.busy}
                onChange={(open) => void action.run(async () => {
                  await api("PATCH", businessPath(props.businessId, "/settings"), { frontDoor: open });
                  setDoor({ ...door, open });
                }, open ? "Your page is open." : "Your page is closed.")}
              />
            ) : null}
            <Message message={action.message} />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Where a scan goes</h2>
        <p className="muted">Wherever your {door.assistant} works for you. Change it any time: codes you've already printed follow your choice.</p>
        <fieldset className="choice">
          <legend className="visually-hidden">Where a scan goes</legend>
          {(["page", "website", "whatsapp"] as Destination[]).map((kind) => {
            const problem = kind === "website" ? door.destination.website.problem : kind === "whatsapp" ? door.destination.whatsapp.problem : undefined;
            const detail = kind === "page" ? door.url.replace(/^https?:\/\//, "") : kind === "website" ? door.destination.website.url : door.destination.whatsapp.number;
            return (
              <label className={`check destination${problem ? " unavailable" : ""}`} key={kind}>
                <input
                  type="radio"
                  name="destination"
                  disabled={!canEdit || Boolean(problem) || route.busy}
                  checked={door.destination.chosen === kind}
                  onChange={() => void route.run(async () => {
                    await api("PATCH", businessPath(props.businessId, "/settings"), { qrDestination: kind });
                    setDoor({ ...door, destination: { ...door.destination, chosen: kind, effective: kind } });
                  }, `Scans now go to ${where[kind]}.`)}
                />
                <span>
                  <strong>{kind === "page" ? "Your page here" : kind === "website" ? "Your website" : "Your WhatsApp"}</strong>
                  {detail ? <span className="muted small"> · {detail}</span> : null}
                  <br /><span className="muted small">{problem ?? `Opens ${where[kind]}.`}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {door.destination.chosen !== door.destination.effective ? <p className="message error">Your chosen destination isn't ready, so scans go to your page here for now.</p> : null}
        <Message message={route.message} />
      </section>

      <section className="card">
        <h2>Print it</h2>
        <p className="muted">Each prints on ordinary A4 paper, with your name, logo and colour. Choose "Save as PDF" in the print window to send it to a print shop.</p>
        <div className="print-choices">
          <PrintChoice title="Poster" text="One A4 page for the door, the wall or the counter." onPrint={() => setSheet("poster")} />
          <PrintChoice title="Table cards" text="Two cards to a page: cut along the line and stand them on tables." onPrint={() => { setNumbered(null); setSheet("cards"); }} />
          <PrintChoice title="Stickers" text="Twelve small codes to a page, for menus, bags and receipts." onPrint={() => setSheet("stickers")} />
        </div>
        <form className="print-numbered" onSubmit={(event) => {
          event.preventDefault();
          const label = numbering.label.replace(/\s+/g, " ").trim();
          const count = Math.round(numbering.count);
          void numberedAction.run(async () => {
            if (!/^[\p{L}\p{N}][\p{L}\p{N} #.\-\/']{0,24}$/u.test(label)) throw new Error("Use a short word for the label, like Table, Room or Chair.");
            if (!(count >= 1 && count <= 60)) throw new Error("Print 1 to 60 cards at a time.");
            const cards = await Promise.all(Array.from({ length: count }, async (_, index) => {
              const spot = `${label} ${index + 1}`;
              const response = await fetch(`/c/${encodeURIComponent(props.businessId)}/qr.svg?spot=${encodeURIComponent(spot).replace(/%20/g, "+")}`);
              if (!response.ok) throw new Error("Couldn't make the codes. Please try again.");
              return { spot, svg: await response.text() };
            }));
            setNumbered(cards);
            setSheet("cards");
          });
        }}>
          <h3>Numbered table cards</h3>
          <p className="muted small">Each card has its own code. When a customer scans {numbering.label || "Table"} 5's card, {door.assistant} knows they're at {numbering.label || "Table"} 5: an order is brought to them, with no address or delivery fee, and the team sees where.</p>
          <div className="form-grid">
            <Field label="Label"><input value={numbering.label} maxLength={25} onChange={(event) => setNumbering({ ...numbering, label: event.target.value })} placeholder="Table" /></Field>
            <Field label="How many"><input type="number" min={1} max={60} value={numbering.count} onChange={(event) => setNumbering({ ...numbering, count: Number(event.target.value) })} /></Field>
          </div>
          <Message message={numberedAction.message} />
          <div className="actions start"><Button small kind="primary" type="submit" busy={numberedAction.busy}>Print numbered cards</Button></div>
        </form>
      </section>

      <section className="card">
        <h2>Who came through it</h2>
        <p className="muted">The last {door.stats.days} days. Counts only: nothing about who.</p>
        <div className="kpis">
          <div className="kpi"><span className="kpi-label">QR code scans</span><span className="kpi-value">{scans}</span><span className="kpi-detail">Posters, table cards and stickers</span></div>
          <div className="kpi"><span className="kpi-label">Business card scans</span><span className="kpi-value">{door.stats.card.visits}</span><span className="kpi-detail">{door.stats.card.chats} started a chat on your page</span></div>
          <div className="kpi"><span className="kpi-label">Link visits</span><span className="kpi-value">{visits}</span><span className="kpi-detail">People who opened the link</span></div>
          <div className="kpi"><span className="kpi-label">Chats started</span><span className="kpi-value">{chats}</span><span className="kpi-detail">On your page: {door.stats.qr.chats} from codes, {door.stats.card.chats} from cards, {door.stats.link.chats} from the link</span></div>
        </div>
      </section>

      {sheet ? createPortal(<PrintSheet door={door} sheet={sheet} numbered={sheet === "cards" ? numbered : null} />, document.body) : null}
    </div>
  );
}

function PrintChoice(props: { title: string; text: string; onPrint: () => void }) {
  return (
    <div className="print-choice">
      <h3>{props.title}</h3>
      <p className="muted small">{props.text}</p>
      <Button small kind="primary" onClick={props.onPrint}>Print {props.title.toLowerCase()}</Button>
    </div>
  );
}

const lettersOf = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
};

/** What goes to the printer: one A4 page in the business's own colours. */
const POWERED = "Powered by Bila Matata · bilamatata.com";

function PrintSheet(props: { door: Door; sheet: Sheet; numbered?: Array<{ spot: string; svg: string }> | null }) {
  const { door, sheet } = props;
  const qr = <img className="print-qr premium" src={svgUri(door.qr_svg)} alt="" />;
  const logo = <span className={`print-logo${door.logo_url ? "" : " letters"}`}>{door.logo_url ? <img src={door.logo_url} alt="" /> : lettersOf(door.name)}</span>;
  const address = door.url.replace(/^https?:\/\//, "");
  const card = (key: number, numbered?: { spot: string; svg: string }) => (
    <div className={numbered ? "print-card numbered" : "print-card"} key={key}>
      <div className="print-card-text">
        {logo}
        <p className="print-name">{door.name}</p>
        {numbered ? <p className="print-spot">{numbered.spot}</p> : null}
        <p className="print-call">{numbered ? "Scan to see what we offer and order" : "Scan to chat with us"}</p>
        <p className="print-small">{numbered ? `Order here and it comes to you. ${door.assistant} answers day and night.` : `Ask a question, check what's available or book. ${door.assistant} answers day and night.`}</p>
        <p className="print-powered">{POWERED}</p>
      </div>
      {numbered ? <img className="print-qr premium" src={svgUri(numbered.svg)} alt="" /> : qr}
    </div>
  );
  const numbered = props.numbered ?? null;
  const pages = numbered ? Array.from({ length: Math.ceil(numbered.length / 2) }, (_, index) => numbered.slice(index * 2, index * 2 + 2)) : null;
  return (
    <div className={`print-root ${sheet}`} ref={(node) => node?.style.setProperty("--print-brand", door.color)}>
      {sheet === "poster" ? (
        <div className="print-poster">
          <div className="print-band">{logo}<div><p className="print-name">{door.name}</p>{door.tagline ? <p className="print-tagline">{door.tagline}</p> : null}</div></div>
          <p className="print-headline">Scan to chat with us</p>
          <p className="print-sub">Ask a question, check what's available or book: {door.assistant}, our {door.role}, answers day and night.</p>
          {qr}
          <p className="print-steps">1. Open your phone's camera&nbsp;&nbsp;·&nbsp;&nbsp;2. Point it at the code&nbsp;&nbsp;·&nbsp;&nbsp;3. Tap the link</p>
          <p className="print-address">{address}</p>
          <p className="print-powered">{POWERED}</p>
        </div>
      ) : null}
      {sheet === "cards" && pages ? pages.map((pair, page) => <div className="print-cards" key={page}>{pair.map((entry, index) => card(page * 2 + index, entry))}</div>) : null}
      {sheet === "cards" && !pages ? <div className="print-cards">{[0, 1].map((key) => card(key))}</div> : null}
      {sheet === "stickers" ? (
        <div className="print-stickers">
          {Array.from({ length: 12 }, (_, index) => (
            <div className="print-sticker" key={index}>{qr}<p>Scan to chat with {door.name}</p></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

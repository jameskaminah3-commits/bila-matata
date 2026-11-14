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
import { Button, ErrorLine, Message, Toggle, useAction, useLoad } from "../ui.tsx";

type Door = {
  url: string;
  qr_svg: string;
  open: boolean;
  live: boolean;
  name: string;
  tagline: string | null;
  assistant: string;
  role: string;
  color: string;
  logo_url: string | null;
  stats: { days: number; qr: { visits: number; chats: number }; link: { visits: number; chats: number } };
};
type Sheet = "poster" | "cards" | "stickers";

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function download(name: string, blob: Blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

/** The QR code as a PNG big enough to print well. */
async function qrPng(svg: string, pixels = 1200): Promise<Blob> {
  const image = new Image();
  image.src = svgUri(svg);
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = pixels;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, pixels, pixels);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no picture"))), "image/png"));
}

export function FrontDoor(props: { businessId: string; role: Role }) {
  const loaded = useLoad(() => api<Door>("GET", businessPath(props.businessId, "/front-door")), [props.businessId]);
  const [door, setDoor] = useState<Door | null>(null);
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const action = useAction();
  const canEdit = atLeast(props.role, "manager");
  useEffect(() => setDoor(loaded.data), [loaded.data]);
  // Print once the sheet is on the page, then put the dashboard back.
  useEffect(() => {
    if (!sheet) return;
    const done = () => setSheet(null);
    window.addEventListener("afterprint", done, { once: true });
    const timer = setTimeout(() => window.print(), 150);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", done);
    };
  }, [sheet]);
  if (!door) return <ErrorLine error={loaded.error} />;
  const file = props.businessId;
  const scans = door.stats.qr.visits;
  const visits = door.stats.link.visits;
  const chats = door.stats.qr.chats + door.stats.link.chats;

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
          <div className="door-qr"><img src={svgUri(door.qr_svg)} alt={`QR code for ${door.name}`} width={220} height={220} /></div>
          <div className="door-side">
            <p className="door-link"><a href={door.url} target="_blank" rel="noreferrer">{door.url.replace(/^https?:\/\//, "")}</a></p>
            <div className="actions start">
              <Button small onClick={() => void navigator.clipboard.writeText(door.url).then(() => setCopied(true))}>{copied ? "Copied" : "Copy the link"}</Button>
              <Button small onClick={() => void qrPng(door.qr_svg).then((blob) => download(`${file}-qr.png`, blob))}>Download PNG</Button>
              <Button small onClick={() => download(`${file}-qr.svg`, new Blob([door.qr_svg], { type: "image/svg+xml" }))}>Download SVG</Button>
            </div>
            <p className="muted small">The code never changes, so anything you print stays good. PNG suits documents and social posts; SVG stays sharp at any size for a printer or designer.</p>
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
        <h2>Print it</h2>
        <p className="muted">Each prints on ordinary A4 paper, with your name, logo and colour. Choose "Save as PDF" in the print window to send it to a print shop.</p>
        <div className="print-choices">
          <PrintChoice title="Poster" text="One A4 page for the door, the wall or the counter." onPrint={() => setSheet("poster")} />
          <PrintChoice title="Table cards" text="Two cards to a page: cut along the line and stand them on tables." onPrint={() => setSheet("cards")} />
          <PrintChoice title="Stickers" text="Twelve small codes to a page, for menus, bags and receipts." onPrint={() => setSheet("stickers")} />
        </div>
      </section>

      <section className="card">
        <h2>Who came through it</h2>
        <p className="muted">The last {door.stats.days} days. Counts only: nothing about who.</p>
        <div className="kpis">
          <div className="kpi"><span className="kpi-label">QR code scans</span><span className="kpi-value">{scans}</span><span className="kpi-detail">People who scanned your printed code</span></div>
          <div className="kpi"><span className="kpi-label">Link visits</span><span className="kpi-value">{visits}</span><span className="kpi-detail">People who opened the link</span></div>
          <div className="kpi"><span className="kpi-label">Chats started</span><span className="kpi-value">{chats}</span><span className="kpi-detail">{door.stats.qr.chats} from the code, {door.stats.link.chats} from the link</span></div>
        </div>
      </section>

      {sheet ? createPortal(<PrintSheet door={door} sheet={sheet} />, document.body) : null}
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
function PrintSheet(props: { door: Door; sheet: Sheet }) {
  const { door, sheet } = props;
  const qr = <img className="print-qr" src={svgUri(door.qr_svg)} alt="" />;
  const logo = <span className={`print-logo${door.logo_url ? "" : " letters"}`}>{door.logo_url ? <img src={door.logo_url} alt="" /> : lettersOf(door.name)}</span>;
  const address = door.url.replace(/^https?:\/\//, "");
  const card = (key: number) => (
    <div className="print-card" key={key}>
      <div className="print-card-text">
        {logo}
        <p className="print-name">{door.name}</p>
        <p className="print-call">Scan to chat with us</p>
        <p className="print-small">Ask a question, check what's available or book. {door.assistant} answers day and night.</p>
      </div>
      {qr}
    </div>
  );
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
        </div>
      ) : null}
      {sheet === "cards" ? <div className="print-cards">{[0, 1].map(card)}</div> : null}
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

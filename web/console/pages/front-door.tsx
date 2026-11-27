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
  pay: { till: string | null; paybill: string | null; account: string | null; name: string | null } | null;
  /** What the printed codes look like and say: the page's lettering, its light or dark, the business's kind, and whether it chats. */
  print?: { font_family: string; font_weight: number; font_url: string; menu_style: string; kind: string; chat: boolean };
  contact: { phone: string | null; email: string | null; website: string | null };
  open: boolean;
  live: boolean;
  name: string;
  tagline: string | null;
  assistant: string;
  role: string;
  color: string;
  on_color: string;
  logo_url: string | null;
  browse: string | null;
  stats: { days: number; qr: { visits: number; chats: number }; link: { visits: number; chats: number }; card: { visits: number; chats: number } };
};
export type CardDetails = { design: "signature" | "minimal" | "bold"; personName: string | null; personTitle: string | null; phone: string | null; email: string | null; website: string | null; address: string | null };
type Sheet = "poster" | "cards" | "stickers";
/** The printed look: ivory for a daytime café, a dark lounge card for a dark menu. */
type Look = "ivory" | "lounge";

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
  const [look, setLook] = useState<Look | null>(null);
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
    let cancelled = false;
    void (async () => {
      // The venue's own lettering and every picture are ready before the print window opens.
      await loadPrintFont(door?.print);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await Promise.all(Array.from(document.querySelectorAll<HTMLImageElement>(".print-root img")).map((image) => image.decode().catch(() => undefined)));
      fitPoster();
      if (!cancelled) window.print();
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", done);
    };
  }, [sheet]);
  if (!door) return <ErrorLine error={loaded.error} />;
  const file = props.businessId;
  const printLook: Look = look ?? (door.print?.menu_style === "dark" ? "lounge" : "ivory");
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
        <p className="muted">Each prints on one A4 page, with your logo, colour and lettering. Choose "Save as PDF" in the print window to send it to a print shop.</p>
        <div className="print-look">
          <span className="small muted">Look</span>
          <div className="segmented" role="group" aria-label="Printed look">
            <button type="button" aria-pressed={printLook === "ivory"} onClick={() => setLook("ivory")}>Ivory</button>
            <button type="button" aria-pressed={printLook === "lounge"} onClick={() => setLook("lounge")}>Dark lounge</button>
          </div>
          <span className="small muted">{printLook === "lounge" ? "A dark card with your colour as the accent, for a lounge or a dark menu." : "Warm white, for a café, a daytime menu or a lighter print."}</span>
        </div>
        <div className="print-choices">
          <PrintChoice title="Poster" text="One A4 page for the door, the wall or the counter." onPrint={() => { setNumbered(null); setSheet("poster"); }} />
          <PrintChoice title="Table cards" text="Two to a page: cut along the line and stand them on tables." onPrint={() => { setNumbered(null); setSheet("cards"); }} />
          <PrintChoice title="Table stickers" text="Six 85 mm squares to a page, with trim marks: ready for matte vinyl." onPrint={() => { setNumbered(null); setSheet("stickers"); }} />
        </div>
        <form className="print-numbered" onSubmit={(event) => {
          event.preventDefault();
          const target: Sheet = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "stickers" ? "stickers" : "cards";
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
            setSheet(target);
          });
        }}>
          <h3>Numbered table cards and stickers</h3>
          <p className="muted small">Each card has its own code. When a customer scans {numbering.label || "Table"} 5's card, {door.assistant} knows they're at {numbering.label || "Table"} 5: an order is brought to them, with no address or delivery fee, and the team sees where.</p>
          <div className="form-grid">
            <Field label="Label"><input value={numbering.label} maxLength={25} onChange={(event) => setNumbering({ ...numbering, label: event.target.value })} placeholder="Table" /></Field>
            <Field label="How many"><input type="number" min={1} max={60} value={numbering.count} onChange={(event) => setNumbering({ ...numbering, count: Number(event.target.value) })} /></Field>
          </div>
          <Message message={numberedAction.message} />
          <div className="actions start">
            <button type="submit" value="cards" className="button primary small" disabled={numberedAction.busy}>Print numbered cards</button>
            <button type="submit" value="stickers" className="button secondary small" disabled={numberedAction.busy}>Print numbered stickers</button>
          </div>
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

      {sheet ? createPortal(<PrintSheet door={door} sheet={sheet} look={printLook} numbered={numbered} />, document.body) : null}
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

/** What a printed code invites people to do, in the words of the page it opens. */
export function callFor(browse: string | null, chat = true): string {
  if (browse === "Browse Menu") return "Scan to view our menu";
  if (browse === "Rooms & Rates") return "Scan for rooms & rates";
  if (browse === "Services & Prices") return "Scan for services & prices";
  if (!chat) return "Scan to view our page";
  return browse ? "Scan to browse & connect" : "Scan to chat with us";
}

/** The short line under a printed code: what scanning it opens. A restaurant's says "Scan for menu". */
export function captionFor(browse: string | null, kind: string | undefined, chat = true): string {
  if (browse === "Browse Menu" || kind === "restaurant") return "Scan for menu";
  if (browse === "Rooms & Rates") return "Scan for rooms";
  if (browse === "Services & Prices") return "Scan for prices";
  return chat ? "Scan to chat" : "Scan to view";
}

/**
 * The poster always ends on its own page with its footer showing: a wide
 * lettering (Cinzel) or a long tagline can take two lines, so the code
 * shrinks a step at a time (never below 64mm, still easily scanned) until
 * everything fits.
 */
function fitPoster(): void {
  const poster = document.querySelector<HTMLElement>(".print-root .print-poster");
  const qr = poster?.querySelector<HTMLElement>(".print-qr");
  if (!poster || !qr) return;
  for (let size = 100; poster.scrollHeight > poster.clientHeight + 1 && size > 64; ) {
    size -= 4;
    qr.style.width = qr.style.height = `${size}mm`;
  }
}

/** The venue's own lettering (Playfair Display, Cinzel, Cormorant Garamond or Jost), loaded for the print; a serif stands in if it's slow. */
async function loadPrintFont(print: Door["print"]): Promise<void> {
  if (!print || typeof FontFace === "undefined") return;
  try {
    const face = new FontFace("Print Display", `url(${print.font_url})`, { weight: String(print.font_weight) });
    const loaded = await Promise.race([face.load(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), 2500))]);
    document.fonts.add(loaded);
  } catch {
    // The serif fallback prints.
  }
}

const channels = (hex: string): [number, number, number] => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = match ? parseInt(match[1], 16) : 0x0f766e;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const luminance = (rgb: [number, number, number]) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The accent on paper: the business's colour where it reads, deepened on ivory, or gold on a dark card. */
export function printAccent(color: string, look: Look): string {
  const base = channels(color);
  if (look === "lounge") return contrast(base, [18, 18, 18]) >= 3 ? toHex(base) : "#c9a227";
  let accent = base;
  for (let step = 0; step < 6 && contrast(accent, [255, 255, 255]) < 3; step++) accent = accent.map((v) => v * 0.82) as [number, number, number];
  return toHex(accent);
}

/** "Pay with M-Pesa · Buy Goods till 5123456", or the Paybill and its account, for the printed cards and poster. */
function PrintPay(props: { pay: Door["pay"] }) {
  const pay = props.pay;
  if (!pay || (!pay.till && !pay.paybill)) return null;
  return (
    <p className="print-pay">
      <span className="print-pay-label">Pay with M-Pesa</span>
      {pay.till ? <span>Buy Goods till <b>{pay.till}</b></span> : <span>Paybill <b>{pay.paybill}</b>{pay.account ? <> · Account <b>{pay.account}</b></> : null}</span>}
      {pay.name ? <span className="print-pay-name">Shows as {pay.name}</span> : null}
    </p>
  );
}

/** Small marks outside a sticker's corners, for the cutter. */
const TrimMarks = () => <>{["tl", "tr", "bl", "br"].map((corner) => <i key={corner} className={`print-trim ${corner}`} aria-hidden="true" />)}</>;

function PrintSheet(props: { door: Door; sheet: Sheet; look: Look; numbered?: Array<{ spot: string; svg: string }> | null }) {
  const { door, sheet, look } = props;
  const chat = door.print?.chat !== false;
  const logo = <span className={`print-logo${door.logo_url ? "" : " letters"}`}>{door.logo_url ? <img src={door.logo_url} alt="" /> : lettersOf(door.name)}</span>;
  const address = door.url.replace(/^https?:\/\//, "");
  const call = callFor(door.browse, chat);
  const caption = captionFor(door.browse, door.print?.kind, chat);
  const menu = door.browse === "Browse Menu" || door.print?.kind === "restaurant";
  const sub = menu
    ? chat ? `Our menu, today's specials and what's on, and ${door.assistant}, our ${door.role}, to answer anything, day and night.` : "Our full menu, today's specials and what's on, on your phone."
    : chat ? `Ask a question, check what's available or book: ${door.assistant}, our ${door.role}, answers day and night.` : "Everything we offer, on your phone.";
  const frame = (svg: string) => <div className="print-frame"><img className="print-qr" src={svgUri(svg)} alt="" /><span className="print-caption">{caption}</span></div>;
  const numbered = props.numbered ?? null;
  const card = (key: number, entry?: { spot: string; svg: string }) => (
    <div className="print-card" key={key}>
      <div className="print-card-head">
        {logo}
        <div className="print-card-names"><p className="print-name">{door.name}</p>{door.tagline ? <p className="print-tagline">{door.tagline}</p> : null}</div>
      </div>
      <div className="print-card-main">
        <div className="print-card-copy">
          {entry ? <p className="print-spot">{entry.spot}</p> : null}
          <p className="print-call">{call}</p>
          <ol className="print-steps-row"><li><b>1</b>Scan</li><li><b>2</b>{door.browse ?? (chat ? `Ask ${door.assistant}` : "View")}</li><li><b>3</b>Enjoy</li></ol>
          <PrintPay pay={door.pay} />
        </div>
        {frame(entry ? entry.svg : door.qr_svg)}
      </div>
      <p className="print-powered">{POWERED}</p>
    </div>
  );
  const sticker = (key: number, entry?: { spot: string; svg: string }) => (
    <div className="print-sticker" key={key}>
      <TrimMarks />
      <div className="print-sticker-head">
        {logo}
        <p className="print-name">{door.name}</p>
      </div>
      {entry ? <p className="print-sticker-spot">{entry.spot}</p> : null}
      {frame(entry ? entry.svg : door.qr_svg)}
      <p className="print-credit">bilamatata.com</p>
    </div>
  );
  const chunk = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
  return (
    <div
      className={`print-root ${sheet} look-${look}`}
      ref={(node) => {
        node?.style.setProperty("--print-brand", door.color);
        node?.style.setProperty("--print-on-brand", door.on_color);
        node?.style.setProperty("--print-accent", printAccent(door.color, look));
        node?.style.setProperty("--print-display-weight", String(door.print?.font_weight ?? 700));
      }}
    >
      {sheet === "poster" ? (
        <div className="print-poster">
          <div className="print-poster-brand">
            {logo}
            <p className="print-name">{door.name}</p>
            {door.tagline ? <p className="print-tagline">{door.tagline}</p> : null}
          </div>
          <i className="print-rule" aria-hidden="true" />
          <p className="print-headline">{call}</p>
          <p className="print-sub">{sub}</p>
          {frame(door.qr_svg)}
          <p className="print-steps">1. Open your phone's camera&nbsp;&nbsp;·&nbsp;&nbsp;2. Point it at the code&nbsp;&nbsp;·&nbsp;&nbsp;3. Tap the link</p>
          <PrintPay pay={door.pay} />
          <div className="print-foot"><p className="print-address">{address}</p><p className="print-powered">{POWERED}</p></div>
        </div>
      ) : null}
      {sheet === "cards" ? (numbered ? chunk(numbered, 2) : [[undefined, undefined]]).map((pair, page) => (
        <div className="print-cards" key={page}>{pair.map((entry, index) => card(page * 2 + index, entry))}</div>
      )) : null}
      {sheet === "stickers" ? (numbered ? chunk(numbered, 6) : [Array.from({ length: 6 }, () => undefined)]).map((group, page) => (
        <div className="print-stickers" key={page}>{group.map((entry, index) => sticker(page * 6 + index, entry))}</div>
      )) : null}
    </div>
  );
}

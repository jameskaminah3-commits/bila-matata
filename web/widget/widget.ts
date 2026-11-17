// web/widget/widget.ts
//
// The website widget: one script tag on any business's website.
//
//   <script src="https://<platform>/zaina.js" data-business="<business id>" async></script>
//
// (Older snippets load /widget.js with data-key="pk_…": the same script.)
// Optional attributes: data-currency="KES" (prices in shillings), and
// data-open="true" (open on load). On the business's own page on this service
// (/c/<business>) the chat fills the page instead of floating:
// data-mode="page" with data-mount="<selector>", and data-via="qr" | "link" | "card".
// A link to any page with the chat that ends in #zaina opens the chat. The page can also call
// window.Zaina.open(), .close() and .setCurrency("USD" | "KES").
//
// When the business has WhatsApp connected (and offers it), the chat also
// has a "Chat on WhatsApp" link to its number.
//
// Everything lives in a shadow root, so the site's styles and the widget's
// never touch. Messages are shown as text (links made clickable), never as
// HTML. The chat resumes on the next visit (the chat's token is kept in this
// browser for 30 days), and while the team has the chat, their replies appear
// as they come.

import { ZAINA_FACE_DATA_URI } from "../../src/brand/zaina-face.ts";

type Config = { name: string; assistant_name: string; assistant_role?: string; color: string; position: "right" | "left"; greeting: string | null; currency: "USD" | "KES"; whatsapp?: string | null; tagline?: string | null; logo?: string | null; avatar?: "zaina" | "logo" };
type Message = { id: number; from: "customer" | "zaina" | "team"; text: string; author?: string };
type Stored = { token: string; sessionId: string };

declare global {
  interface Window {
    Zaina?: { open(): void; close(): void; setCurrency(currency: "USD" | "KES"): void };
    __zainaWidgetLoaded?: boolean;
  }
}

const POLL_WITH_TEAM_MS = 4_000;
const POLL_OPEN_MS = 30_000;

(function start() {
  if (window.__zainaWidgetLoaded) return;
  const script = (document.currentScript as HTMLScriptElement | null)
    ?? document.querySelector<HTMLScriptElement>('script[src*="zaina.js"][data-business], script[src*="widget.js"][data-key], script[src*="zaina.js"][data-key]');
  // The business: its id (data-business) or its public key (data-key).
  const business = (script?.dataset.business ?? script?.dataset.key)?.trim();
  if (!script || !business) {
    console.warn("[zaina] The chat's script needs data-business=\"<your business id>\" (see Settings → Website widget in the Zaina console).");
    return;
  }
  window.__zainaWidgetLoaded = true;
  const api = new URL(script.src, location.href).origin;
  const storageKey = `zaina:${business}`;
  // On the business's own page the chat is the page: always open, no launcher.
  const pageMode = script.dataset.mode === "page";
  // A customer signed in on the business's own site: a short-lived token its server made (docs/INTEGRATION.md),
  // on the script tag or set later with window.Zaina.signIn(token) before the chat opens.
  let signedIn: string | null = script.dataset.customerToken?.trim() || null;
  const customerToken = () => (signedIn && signedIn.length <= 2000 ? signedIn : null);
  (window as any).Zaina = { ...((window as any).Zaina ?? {}), signIn: (token: unknown) => { signedIn = typeof token === "string" ? token.trim() || null : null; } };
  const via = script.dataset.via === "qr" || script.dataset.via === "link" || script.dataset.via === "card" ? script.dataset.via : null;

  let config: Config;
  let currency: "USD" | "KES" | null = script.dataset.currency === "KES" || script.dataset.currency === "USD" ? script.dataset.currency : null;
  let stored: Stored | null = readStored();
  let lastId = 0;
  let open = false;
  let sending = false;
  let withTeam = false;
  let loadedHistory = false;
  let pollTimer: number | undefined;
  const shown = new Set<number>();

  function readStored(): Stored | null {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      return value && typeof value.token === "string" && typeof value.sessionId === "string" ? value : null;
    } catch {
      return null;
    }
  }

  function writeStored(value: Stored | null) {
    stored = value;
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch {
      // Private browsing: the chat still works, it just won't resume.
    }
  }

  async function call(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {};
    if (init.json !== undefined) headers["content-type"] = "application/json";
    if (stored) headers.authorization = `Bearer ${stored.token}`;
    if (currency) headers["x-zaina-currency"] = currency;
    const response = await fetch(`${api}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      credentials: "omit",
    });
    let body: any = null;
    try {
      body = await response.json();
    } catch {}
    return { status: response.status, body };
  }

  // ── Look ──────────────────────────────────────────────────────────────
  function readableOn(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // White or ink, whichever contrasts more with the colour.
    return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.0609 ? "#ffffff" : "#111827";
  }

  const css = (brand: string, side: "right" | "left") => `
:host { all: initial; }
* { box-sizing: border-box; }
.root { --brand: ${brand}; --on-brand: ${readableOn(brand)}; --surface: #ffffff; --text: #111827; --muted: #6b7280; --line: #e5e7eb;
  --bubble: #f3f4f6; --team: #fef3c7; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text);
  position: fixed; ${side}: 20px; bottom: 20px; z-index: 2147483000; }
@media (prefers-color-scheme: dark) {
  .root { --surface: #111827; --text: #f9fafb; --muted: #9ca3af; --line: #374151; --bubble: #1f2937; --team: #3f3212; }
}
.launcher { width: 64px; height: 64px; border-radius: 50%; border: 3px solid var(--brand); padding: 0; cursor: pointer; background: var(--brand); color: var(--on-brand);
  box-shadow: 0 6px 20px rgba(0,0,0,.25); display: grid; place-items: center; position: relative; transition: transform .15s ease; }
.launcher:hover { transform: scale(1.06); }
.launcher img { width: 100%; height: 100%; border-radius: 50%; display: block; }
.launcher .chat-badge { position: absolute; right: -6px; top: -4px; width: 24px; height: 24px; border-radius: 50%; background: var(--brand); color: var(--on-brand); display: grid; place-items: center; border: 2px solid var(--surface); }
.launcher .chat-badge svg { width: 13px; height: 13px; }
@media (prefers-reduced-motion: reduce) { .launcher { transition: none; } .launcher:hover { transform: none; } }
.launcher:focus-visible, button:focus-visible, textarea:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
.launcher svg { width: 28px; height: 28px; }
.dot { position: absolute; top: 4px; right: 4px; width: 14px; height: 14px; border-radius: 50%; background: #dc2626; border: 2px solid #fff; display: none; }
.dot.on { display: block; }
.panel { position: absolute; bottom: 76px; ${side}: 0; width: 380px; height: min(620px, calc(100vh - 110px)); background: var(--surface);
  border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.28); display: none; flex-direction: column; overflow: hidden; border: 1px solid var(--line); }
.panel.open { display: flex; }
.header { background: var(--brand); color: var(--on-brand); padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
.header .face { width: 44px; height: 44px; border-radius: 50%; flex: none; border: 2px solid rgba(255,255,255,.6); position: relative; }
.header .face img { width: 100%; height: 100%; border-radius: 50%; display: block; }
.header .face::after { content: ""; position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: #22c55e; border: 2px solid var(--brand); }
.header .who { flex: 1; min-width: 0; }
.header .name { font-weight: 650; font-size: 16px; }
.header .sub { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.close { background: transparent; border: none; color: inherit; cursor: pointer; width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; }
.close:hover { background: rgba(255,255,255,.15); }
.log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; overscroll-behavior: contain; }
.row { display: flex; flex-direction: column; max-width: 85%; }
.row.customer { align-self: flex-end; align-items: flex-end; }
.label { font-size: 12px; color: var(--muted); margin: 0 4px 2px; }
.bubble { padding: 9px 12px; border-radius: 14px; background: var(--bubble); white-space: pre-wrap; overflow-wrap: anywhere; }
.customer .bubble { background: var(--brand); color: var(--on-brand); border-bottom-right-radius: 4px; }
.zaina .bubble { border-bottom-left-radius: 4px; }
.team .bubble { background: var(--team); border-bottom-left-radius: 4px; }
.bubble a { color: inherit; text-decoration: underline; }
.bubble a.picture { display: block; margin: 6px 0; text-decoration: none; }
.bubble a.picture img { display: block; max-width: 100%; max-height: 220px; border-radius: 10px; object-fit: cover; background: var(--line); }
.pending .bubble { opacity: .6; }
.notice { align-self: center; font-size: 13px; color: var(--muted); text-align: center; padding: 2px 8px; }
.notice.error { color: #b91c1c; }
.typing { align-self: flex-start; display: none; gap: 4px; padding: 12px 14px; background: var(--bubble); border-radius: 14px; }
.typing.on { display: flex; }
.typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
.composer { border-top: 1px solid var(--line); padding: 10px; display: flex; gap: 8px; align-items: flex-end; }
textarea { flex: 1; resize: none; border: 1px solid var(--line); border-radius: 12px; padding: 9px 12px; font: inherit; color: var(--text);
  background: var(--surface); max-height: 120px; min-height: 42px; }
.send { background: var(--brand); color: var(--on-brand); border: none; border-radius: 12px; width: 44px; height: 42px; cursor: pointer; display: grid; place-items: center; }
.send:disabled { opacity: .5; cursor: default; }
.footer { text-align: center; font-size: 11px; color: var(--muted); padding: 0 0 8px; }
.whatsapp { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 0 10px 8px; padding: 7px 10px; border-radius: 10px;
  font-size: 13px; font-weight: 600; color: #075e54; background: #dcf8c6; text-decoration: none; }
.whatsapp:hover { background: #cdf2b1; }
.whatsapp svg { width: 16px; height: 16px; flex: none; }
@media (prefers-color-scheme: dark) { .whatsapp { color: #d9fdd3; background: #0b3d2e; } .whatsapp:hover { background: #0f4d3a; } }
@media (max-width: 480px) {
  .root { ${side}: 12px; bottom: 12px; }
  .panel.open { position: fixed; inset: 0; width: auto; height: auto; border-radius: 0; border: none; }
  .panel.open + .launcher { display: none; }
}
@media (prefers-reduced-motion: reduce) { .typing span { animation: none; opacity: .6; } }
.face.logo img, .launcher.logo img { object-fit: contain; background: #ffffff; }
/* The chat as the page (the business's own page on this service). */
:host(.page) { display: block; height: 100%; }
.root.page { position: static; height: 100%; }
.root.page .panel, .root.page .panel.open { position: static; display: flex; width: 100%; height: 100%; border: none; border-radius: 0; box-shadow: none; }
.root.page .launcher, .root.page .close { display: none; }
`;

  const icons = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7-8-1z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 21l1.6-4.8A8.5 8.5 0 1 1 7.8 19.4L3 21z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2L9 9.5z"/></svg>',
  };

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function isPicture(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (parsed.origin === api && /^\/catalogue\/[a-z0-9-]+\/[0-9a-f-]{36}$/i.test(parsed.pathname)) || /\.(jpe?g|png|webp|gif)$/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  /** Text with its web addresses made into links; everything else stays text. */
  function linkified(text: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const pattern = /https?:\/\/[^\s<>"')\]]+/g;
    let index = 0;
    for (const match of text.matchAll(pattern)) {
      const url = match[0].replace(/[.,;:!?]+$/, "");
      fragment.append(text.slice(index, match.index));
      const link = element("a", undefined, url);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
      // A picture of an item (the business's catalogue, or a picture file): shown, and opened full size on a tap.
      if (isPicture(url)) {
        link.textContent = "";
        link.className = "picture";
        const image = element("img");
        image.src = url;
        image.alt = "Picture";
        image.loading = "lazy";
        image.decoding = "async";
        // If it can't be shown here, the link stays.
        image.addEventListener("error", () => { link.className = ""; link.textContent = url; });
        link.append(image);
      }
      fragment.append(link);
      index = (match.index ?? 0) + url.length;
    }
    fragment.append(text.slice(index));
    return fragment;
  }

  // ── Build ─────────────────────────────────────────────────────────────
  let log!: HTMLDivElement;
  let typing!: HTMLDivElement;
  let textarea!: HTMLTextAreaElement;
  let sendButton!: HTMLButtonElement;
  let panel!: HTMLDivElement;
  let launcher!: HTMLButtonElement;
  let dot!: HTMLSpanElement;

  const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

  function build(root: ShadowRoot) {
    const sheet = css(config.color, config.position);
    if ("adoptedStyleSheets" in Document.prototype && "replaceSync" in CSSStyleSheet.prototype) {
      const constructed = new CSSStyleSheet();
      constructed.replaceSync(sheet);
      root.adoptedStyleSheets = [constructed];
    } else {
      root.append(element("style", undefined, sheet));
    }
    const container = element("div", pageMode ? "root page" : "root");
    // Whose picture the chat shows: Zaina's face, or the business's own logo.
    const ownLogo = config.avatar === "logo" && typeof config.logo === "string" && /^https?:\/\//.test(config.logo) ? config.logo : null;
    const picture = ownLogo ?? ZAINA_FACE_DATA_URI;
    panel = element("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `Chat with ${config.assistant_name}`);

    const header = element("div", "header");
    const who = element("div", "who");
    const face = element("span", ownLogo ? "face logo" : "face");
    const faceImage = document.createElement("img");
    faceImage.src = picture;
    faceImage.alt = "";
    face.append(faceImage);
    who.append(element("div", "name", config.assistant_name), element("div", "sub", `${config.assistant_role ? `${capitalise(config.assistant_role)} · ` : ""}${config.name}`));
    const closeButton = element("button", "close");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close chat");
    closeButton.innerHTML = icons.close;
    closeButton.addEventListener("click", () => setOpen(false));
    header.append(face, who, closeButton);

    log = element("div", "log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    typing = element("div", "typing");
    typing.setAttribute("aria-label", `${config.assistant_name} is typing`);
    typing.append(element("span"), element("span"), element("span"));

    const composer = element("form", "composer");
    textarea = element("textarea");
    textarea.rows = 1;
    textarea.maxLength = 2000;
    textarea.placeholder = "Type your message…";
    textarea.setAttribute("aria-label", "Your message");
    sendButton = element("button", "send");
    sendButton.type = "submit";
    sendButton.setAttribute("aria-label", "Send");
    sendButton.innerHTML = icons.send;
    composer.append(textarea, sendButton);
    composer.addEventListener("submit", (event) => {
      event.preventDefault();
      void send();
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void send();
      }
    });
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    });

    const footer = element("div", "footer", "Powered by Zaina");
    panel.append(header, log, composer);
    // Customers who'd rather carry on in WhatsApp: the business's own number, with a first line ready.
    if (config.whatsapp && /^https:\/\/wa\.me\/\d{8,15}$/.test(config.whatsapp)) {
      const whatsapp = element("a", "whatsapp");
      whatsapp.href = `${config.whatsapp}?text=${encodeURIComponent(`Hi ${config.name}!`)}`;
      whatsapp.target = "_blank";
      whatsapp.rel = "noopener noreferrer";
      whatsapp.innerHTML = icons.whatsapp;
      whatsapp.append(document.createTextNode("Chat on WhatsApp instead"));
      panel.append(whatsapp);
    }
    panel.append(footer);
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !pageMode) setOpen(false);
    });

    launcher = element("button", ownLogo ? "launcher logo" : "launcher");
    launcher.type = "button";
    launcher.setAttribute("aria-label", `Chat with ${config.assistant_name}`);
    launcher.setAttribute("aria-expanded", "false");
    const launcherFace = document.createElement("img");
    launcherFace.src = picture;
    launcherFace.alt = "";
    const chatBadge = element("span", "chat-badge");
    chatBadge.innerHTML = icons.chat;
    launcher.append(launcherFace, chatBadge);
    dot = element("span", "dot");
    launcher.append(dot);
    launcher.addEventListener("click", () => setOpen(!open));

    container.append(panel, launcher);
    root.append(container);
  }

  function scrollDown() {
    log.scrollTop = log.scrollHeight;
  }

  function addRow(from: Message["from"], text: string, options: { author?: string; pending?: boolean } = {}): HTMLDivElement {
    const row = element("div", `row ${from}${options.pending ? " pending" : ""}`);
    if (from === "team") row.append(element("div", "label", `${options.author ?? "Team"} · ${config.name}`));
    const bubble = element("div", "bubble");
    bubble.append(linkified(text));
    row.append(bubble);
    log.insertBefore(row, typing.isConnected ? typing : null);
    scrollDown();
    return row;
  }

  function notice(text: string, error = false) {
    const line = element("div", `notice${error ? " error" : ""}`, text);
    log.insertBefore(line, typing.isConnected ? typing : null);
    scrollDown();
  }

  function greet() {
    if (log.querySelector(".row")) return;
    addRow("zaina", config.greeting ?? `Hi, I'm ${config.assistant_name}, the ${config.assistant_role ?? "customer care host"} at ${config.name}. How can I help you today?`);
  }

  /** Adds messages not shown yet; quiet for history loaded on a new visit (no unread dot). */
  function show(messages: Message[], quiet = false) {
    let fresh = false;
    for (const message of messages) {
      lastId = Math.max(lastId, message.id);
      if (shown.has(message.id)) continue;
      shown.add(message.id);
      addRow(message.from, message.text, { author: message.author });
      if (message.from !== "customer") fresh = true;
    }
    if (fresh && !open && !quiet) dot.classList.add("on");
  }

  async function sync(quiet = false): Promise<boolean> {
    if (!stored) return false;
    const result = await call(`/api/zaina/chat/messages?after=${lastId}`);
    if (result.status === 401 || result.status === 404) {
      writeStored(null);
      return false;
    }
    if (result.status === 200) show(result.body.messages as Message[], quiet);
    const state = await call("/api/zaina/session");
    if (state.status === 200) withTeam = state.body.managed_by === "HUMAN";
    return true;
  }

  function schedulePoll() {
    window.clearTimeout(pollTimer);
    if (!stored) return;
    const every = withTeam ? POLL_WITH_TEAM_MS : open ? POLL_OPEN_MS : 0;
    if (!every) return;
    pollTimer = window.setTimeout(async () => {
      if (document.visibilityState === "visible") await sync().catch(() => {});
      schedulePoll();
    }, every);
  }

  async function openSession(): Promise<boolean> {
    const result = await call("/api/zaina/sessions", { method: "POST", json: { business, display_currency: currency ?? config.currency, ...(pageMode && via ? { via } : {}), ...(customerToken() ? { customer_token: customerToken() } : {}) } });
    if (result.status !== 201) {
      notice(result.body?.message ?? "The chat isn't available right now. Please try again later.", true);
      return false;
    }
    writeStored({ token: result.body.token, sessionId: result.body.session_id });
    lastId = 0;
    shown.clear();
    return true;
  }

  async function send() {
    const text = textarea.value.trim();
    if (!text || sending) return;
    sending = true;
    sendButton.disabled = true;
    textarea.value = "";
    textarea.style.height = "auto";
    const pending = addRow("customer", text, { pending: true });
    typing.classList.add("on");
    log.append(typing);
    scrollDown();
    try {
      if (!stored && !(await openSession())) throw new Error("no session");
      let result = await call("/api/zaina/chat", { method: "POST", json: { message: text } });
      if (result.status === 401) {
        // The chat expired: start a new one and send again.
        writeStored(null);
        if (!(await openSession())) throw new Error("no session");
        result = await call("/api/zaina/chat", { method: "POST", json: { message: text } });
      }
      if (result.status === 200 || result.status === 409) {
        pending.remove();
        const synced = await sync().catch(() => false);
        if (!synced || result.status === 409) {
          if (result.body?.reply) addRow("zaina", result.body.reply);
        }
        if (result.body?.status === "human_managed" || result.body?.escalated) withTeam = true;
      } else {
        pending.classList.remove("pending");
        notice(result.body?.message ?? "Sorry, that didn't go through. Please try again.", true);
      }
    } catch {
      pending.classList.remove("pending");
      notice("Couldn't reach the chat. Check your connection and try again.", true);
    } finally {
      typing.classList.remove("on");
      sending = false;
      sendButton.disabled = false;
      schedulePoll();
      if (open && !pageMode) textarea.focus();
      else if (pageMode && matchMedia("(hover: hover)").matches) textarea.focus();
    }
  }

  async function setOpen(value: boolean) {
    open = value;
    panel.classList.toggle("open", value);
    launcher.setAttribute("aria-expanded", String(value));
    if (value) {
      dot.classList.remove("on");
      if (!loadedHistory) {
        loadedHistory = true;
        await sync().catch(() => {});
        greet();
      }
      // On the business's own page the chat opens by itself: no jumping keyboard on a phone.
      if (!pageMode) textarea.focus();
    } else {
      launcher.focus();
    }
    schedulePoll();
  }

  async function boot() {
    let result: { status: number; body: any };
    try {
      const response = await fetch(`${api}/api/zaina/widget/config?business=${encodeURIComponent(business!)}`, { credentials: "omit" });
      result = { status: response.status, body: await response.json().catch(() => null) };
    } catch {
      console.warn("[zaina] The chat couldn't load.");
      return;
    }
    if (result.status !== 200) {
      if (result.body?.error === "origin_not_allowed") {
        console.warn(`[zaina] ${location.origin} isn't on this business's list of websites for the chat yet. In the Zaina dashboard: Settings → Website widget → Allow this website.`);
      } else {
        console.warn(`[zaina] The chat isn't available on this website (${result.body?.error ?? result.status}).`);
      }
      return;
    }
    config = result.body as Config;
    const host = document.createElement("div");
    host.id = "zaina-widget";
    const mount = pageMode ? document.querySelector(script!.dataset.mount ?? "#zaina-chat") : null;
    if (pageMode) host.className = "page";
    (mount ?? document.body).append(host);
    if (mount) mount.classList.add("ready");
    build(host.attachShadow({ mode: "open" }));
    window.Zaina = {
      open: () => void setOpen(true),
      close: () => void setOpen(false),
      setCurrency: (value) => {
        if (value === "USD" || value === "KES") currency = value;
      },
    };
    if (stored) {
      // A chat from an earlier visit: pick up where it left off.
      await sync(true).catch(() => {});
      schedulePoll();
    }
    // Opened by the page itself, by data-open, or by a link to the website ending #zaina (the business's printed code can send scans there).
    if (pageMode || script!.dataset.open === "true" || location.hash === "#zaina") void setOpen(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  else void boot();
})();

export {};

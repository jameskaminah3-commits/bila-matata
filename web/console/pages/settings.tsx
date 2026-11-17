// web/console/pages/settings.tsx
//
// How the business shows up and works: its profile (what Zaina says about
// it, how customers reach it), the website widget and the websites it runs
// on, the WhatsApp connection, the team's hours, and its plan and billing.

import { NotificationEmails } from "./notifications.tsx";
import { ZAINA_FACE_DATA_URI } from "../../../src/brand/zaina-face.ts";
import { useEffect, useState } from "react";
import { api, businessPath } from "../api.ts";
import { timeAgo, WEEKDAYS } from "../format.ts";
import { atLeast, booksOfType, type Books, type Me, type Operations, type Role, type Settings, type WhatsappState } from "../types.ts";
import { OfferSetup } from "./offer.tsx";
import { Brand } from "./brand.tsx";
import { FrontDoor } from "./front-door.tsx";
import { BusinessCards } from "./business-cards.tsx";
import { Button, ErrorLine, Field, Message, Tabs, Toggle, useAction, useLoad } from "../ui.tsx";
import { BillingSettings } from "./billing.tsx";
import { BookingSettings } from "./booking-settings.tsx";
import { Calendars } from "./calendars.tsx";
import { Integration } from "./integration.tsx";

type Tab = "profile" | "offer" | "brand" | "door" | "cards" | "notifications" | "widget" | "whatsapp" | "system" | "hours" | "bookings" | "calendars" | "billing";
const TABS: Tab[] = ["profile", "offer", "brand", "door", "cards", "notifications", "widget", "whatsapp", "system", "hours", "bookings", "calendars", "billing"];

/**
 * The tab in the address (#/b/<business>/settings/<tab>?…), and what a
 * provider said on the way back: Google (?google=…) or Paystack (?paid=…).
 */
function fromAddress(value: string | null | undefined): { tab: Tab; outcome: string | null } {
  const [name, query] = (value ?? "").split("?");
  const params = new URLSearchParams(query ?? "");
  return { tab: TABS.includes(name as Tab) ? name as Tab : "profile", outcome: params.get("google") ?? params.get("paid") };
}

export function SettingsPage(props: { businessId: string; role: Role; me: Me; businessType?: string | null; books?: Books; tab?: string | null; onBusinessChanged?: () => void; onOfferChanged?: () => void }) {
  const initial = fromAddress(props.tab);
  const [tab, setTab] = useState<Tab>(initial.tab);
  const books = props.books ?? booksOfType(props.businessType ?? null);
  const stays = books.rooms || books.services || books.tables;
  const ownSystem = props.businessType === "custom";
  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <Tabs
        label="Settings"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "profile", label: "Business" },
          ...(ownSystem ? [] : [{ id: "offer" as const, label: "What you offer" }]),
          { id: "brand", label: "Brand" },
          { id: "door", label: "QR code & link" },
          { id: "cards", label: "Business cards" },
          ...(stays ? [{ id: "bookings" as const, label: "Bookings & payments" }, { id: "calendars" as const, label: "Calendars" }] : []),
          { id: "notifications", label: "Notifications" },
          { id: "widget", label: "Website widget" },
          { id: "whatsapp", label: "WhatsApp" },
          ...(atLeast(props.role, "manager") ? [{ id: "system" as const, label: "Your system" }] : []),
          { id: "hours", label: "Hours" },
          { id: "billing", label: "Plan & billing" },
        ]}
      />
      {tab === "bookings" && stays ? <BookingSettings businessId={props.businessId} role={props.role} admin={props.me.user.is_platform_admin} rooms={books.rooms} slots={books.services || books.tables} /> : null}
      {tab === "calendars" && stays ? <Calendars businessId={props.businessId} role={props.role} businessType={props.businessType ?? null} rooms={books.rooms} outcome={initial.tab === "calendars" ? initial.outcome : null} /> : null}
      {tab === "offer" && !ownSystem ? <OfferSetup businessId={props.businessId} role={props.role} onChanged={props.onOfferChanged} /> : null}
      {tab === "profile" ? <Profile businessId={props.businessId} /> : null}
      {tab === "brand" ? <Brand businessId={props.businessId} role={props.role} /> : null}
      {tab === "door" ? <FrontDoor businessId={props.businessId} role={props.role} /> : null}
      {tab === "cards" ? <BusinessCards businessId={props.businessId} role={props.role} /> : null}
      {tab === "notifications" ? <NotificationEmails businessId={props.businessId} role={props.role} /> : null}
      {tab === "widget" ? <Widget businessId={props.businessId} role={props.role} me={props.me} /> : null}
      {tab === "whatsapp" ? <Whatsapp businessId={props.businessId} role={props.role} admin={props.me.user.is_platform_admin} /> : null}
      {tab === "system" && atLeast(props.role, "manager") ? <Integration businessId={props.businessId} role={props.role} admin={props.me.user.is_platform_admin} /> : null}
      {tab === "hours" ? <Hours businessId={props.businessId} /> : null}
      {tab === "billing" ? <BillingSettings businessId={props.businessId} outcome={initial.tab === "billing" ? initial.outcome : null} onChanged={props.onBusinessChanged} /> : null}
    </div>
  );
}

function useSettings(businessId: string) {
  return useLoad(() => api<{ settings: Settings }>("GET", businessPath(businessId, "/settings")).then((result) => result.settings), [businessId]);
}

function Profile(props: { businessId: string }) {
  const loaded = useSettings(props.businessId);
  const [form, setForm] = useState<Settings | null>(null);
  const action = useAction();
  useEffect(() => setForm(loaded.data), [loaded.data]);
  if (!form) return <ErrorLine error={loaded.error} />;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });
  return (
    <form
      className="form card"
      onSubmit={async (event) => {
        event.preventDefault();
        await action.run(async () => {
          const result = await api<{ settings: Settings }>("PATCH", businessPath(props.businessId, "/settings"), {
            displayName: form.displayName,
            assistantName: form.assistantName,
            personaRole: form.personaRole?.trim() || null,
            about: form.about,
            contactPhone: form.contactPhone?.trim() || null,
            contactPhoneDisplay: form.contactPhoneDisplay?.trim() || null,
            websiteUrl: form.websiteUrl?.trim() || null,
            supportEmail: form.supportEmail?.trim() || null,
            defaultCurrency: form.defaultCurrency,
            allowedLinkHosts: form.allowedLinkHosts,
          });
          setForm(result.settings);
        }, "Saved. Zaina uses the new details from the next message.");
      }}
    >
      <div className="persona-card">
        <span className="persona-face"><img src={ZAINA_FACE_DATA_URI} alt="" width={72} height={72} /></span>
        <div>
          <strong>{form.assistantName || "Zaina"}</strong>
          <p className="muted small">{(form.personaRole?.trim() || "your customer care host")} at {form.displayName}. She joins your team the day she starts: she says "we" and "our", knows your information by heart, and brings in a person when one is needed.</p>
        </div>
      </div>
      <div className="form-row">
        <Field label="Business name"><input required maxLength={200} value={form.displayName} onChange={(event) => set("displayName", event.target.value)} /></Field>
        <Field label="Her name"><input required maxLength={200} value={form.assistantName} onChange={(event) => set("assistantName", event.target.value)} /></Field>
        <Field label="Her role on your team" hint="For example: guest experience host, client care host, reservations host. Empty: one that fits your business."><input maxLength={60} placeholder="guest experience host" value={form.personaRole ?? ""} onChange={(event) => set("personaRole", event.target.value)} /></Field>
      </div>
      <Field label="About the business" hint="A short description Zaina always knows: what you offer, where you are. Details belong in Knowledge." wide>
        <textarea rows={5} maxLength={4000} value={form.about} onChange={(event) => set("about", event.target.value)} />
      </Field>
      <div className="form-row">
        <Field label="Phone for customers" hint="International form, e.g. +254718475264. The only number Zaina gives out.">
          <input value={form.contactPhone ?? ""} onChange={(event) => set("contactPhone", event.target.value)} />
        </Field>
        <Field label="Phone, as written" hint="How it's shown, e.g. +254 718 475 264">
          <input value={form.contactPhoneDisplay ?? ""} onChange={(event) => set("contactPhoneDisplay", event.target.value)} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Website"><input type="url" placeholder="https://" value={form.websiteUrl ?? ""} onChange={(event) => set("websiteUrl", event.target.value)} /></Field>
        <Field label="Support email"><input type="email" value={form.supportEmail ?? ""} onChange={(event) => set("supportEmail", event.target.value)} /></Field>
        <Field label="Prices shown in">
          <select value={form.defaultCurrency} onChange={(event) => set("defaultCurrency", event.target.value as "USD" | "KES")}>
            <option value="USD">US dollars</option>
            <option value="KES">Kenyan shillings</option>
          </select>
        </Field>
      </div>
      <Field label="Other websites Zaina may link to" hint="Host names, separated by commas (your own website is always allowed)." wide>
        <input
          value={form.allowedLinkHosts.join(", ")}
          onChange={(event) => set("allowedLinkHosts", event.target.value.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean))}
        />
      </Field>
      <Message message={action.message} />
      <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
    </form>
  );
}

function Widget(props: { businessId: string; role: Role; me: Me }) {
  const loaded = useSettings(props.businessId);
  const operations = useLoad(() => api<Operations>("GET", businessPath(props.businessId, "/operations")), [props.businessId]);
  const whatsapp = useLoad(() => api<WhatsappState>("GET", businessPath(props.businessId, "/whatsapp")).catch(() => null), [props.businessId]);
  const [look, setLook] = useState<{ color: string; position: "right" | "left"; greeting: string; whatsapp: boolean } | null>(null);
  const [origins, setOrigins] = useState<string>("");
  const lookAction = useAction();
  const originsAction = useAction();
  useEffect(() => {
    if (loaded.data) setLook({ color: loaded.data.widgetColor, position: loaded.data.widgetPosition, greeting: loaded.data.widgetGreeting ?? "", whatsapp: loaded.data.widgetWhatsapp });
  }, [loaded.data]);
  useEffect(() => {
    if (operations.data) setOrigins(operations.data.allowed_origins.join("\n"));
  }, [operations.data]);
  if (!look || !operations.data) return <ErrorLine error={loaded.error ?? operations.error} />;
  const base = props.me.public_base_url ?? location.origin;
  const snippet = `<script src="${base}/zaina.js" data-business="${props.businessId}" async></script>`;
  const number = whatsapp.data?.connection?.status === "active" ? whatsapp.data.connection.display_phone_number : null;
  return (
    <div className="stack">
      <InstallChat businessId={props.businessId} role={props.role} snippet={snippet} base={base} onAllowed={(list) => setOrigins(list.join("\n"))} />
      <form
        className="form card"
        onSubmit={async (event) => {
          event.preventDefault();
          await lookAction.run(() => api("PATCH", businessPath(props.businessId, "/settings"), { widgetColor: look.color, widgetPosition: look.position, widgetGreeting: look.greeting.trim() || null, widgetWhatsapp: look.whatsapp }), "Saved. Visitors see the new look on their next page load.");
        }}
      >
        <h2>Look and greeting</h2>
        <div className="form-row">
          <Field label="Colour"><input type="color" value={look.color} onChange={(event) => setLook({ ...look, color: event.target.value })} /></Field>
          <Field label="Corner">
            <select value={look.position} onChange={(event) => setLook({ ...look, position: event.target.value as "right" | "left" })}>
              <option value="right">Bottom right</option>
              <option value="left">Bottom left</option>
            </select>
          </Field>
          <div className="widget-preview" aria-hidden="true"><span className="preview-launcher" ref={(node) => node?.style.setProperty("--preview", look.color)} /></div>
        </div>
        <Field label="First message" hint={`Shown when a visitor opens the chat. Leave empty for: "Hi, I'm ${loaded.data?.assistantName ?? "Zaina"}, the ${loaded.data?.personaRole?.trim() || "customer care host"} at ${loaded.data?.displayName ?? "your business"}. How can I help you today?"`} wide>
          <textarea rows={2} maxLength={300} value={look.greeting} onChange={(event) => setLook({ ...look, greeting: event.target.value })} />
        </Field>
        {number ? (
          <label className="check">
            <input type="checkbox" checked={look.whatsapp} onChange={(event) => setLook({ ...look, whatsapp: event.target.checked })} />
            <span>Offer "Chat on WhatsApp instead" in the chat, to {number}</span>
          </label>
        ) : <p className="muted small">Connect WhatsApp (below) and the chat can also offer your WhatsApp number.</p>}
        <Message message={lookAction.message} />
        <div className="actions"><Button kind="primary" type="submit" busy={lookAction.busy}>Save</Button></div>
      </form>
      <form
        className="form card"
        onSubmit={async (event) => {
          event.preventDefault();
          await originsAction.run(async () => {
            const list = origins.split(/[\s,]+/).map((origin) => origin.trim()).filter(Boolean);
            const result = await api<Operations>("PATCH", businessPath(props.businessId, "/operations"), { allowed_origins: list });
            setOrigins(result.allowed_origins.join("\n"));
          }, "Saved.");
        }}
      >
        <h2>Websites that may use the chat</h2>
        <Field label="One address per line" hint={props.role === "owner" ? "For example https://www.example.com. Other websites can't open your chat." : "Only an owner can change these."} wide>
          <textarea rows={3} value={origins} readOnly={props.role !== "owner"} onChange={(event) => setOrigins(event.target.value)} />
        </Field>
        <Message message={originsAction.message} />
        {props.role === "owner" ? <div className="actions"><Button kind="primary" type="submit" busy={originsAction.busy}>Save</Button></div> : null}
      </form>
    </div>
  );
}

type InstallView = {
  website: string | null;
  allowed_origins: string[];
  loaded: { origin: string; at: string } | null;
  refused: Array<{ origin: string; at: string }>;
  checked?: string;
  origin?: string;
  allowed?: boolean;
  installed?: "yes" | "other_business" | "no";
  tag_manager?: boolean;
};

/** Where to paste the code, on the website builders businesses here use most. */
const BUILDERS: Array<{ id: string; label: string; steps: string[] }> = [
  { id: "wordpress", label: "WordPress", steps: ["Plugins → Add New: install and activate “WPCode” (Insert Headers and Footers).", "Code Snippets → Header & Footer: paste the code in the Footer box.", "Save. The chat appears on every page."] },
  { id: "wix", label: "Wix", steps: ["Settings → Advanced → Custom Code → + Add Custom Code.", "Paste the code, choose All pages, and place it in Body - end.", "Apply, then Publish your site."] },
  { id: "shopify", label: "Shopify", steps: ["Online Store → Themes → … → Edit code.", "Open layout/theme.liquid and paste the code just above </body>.", "Save."] },
  { id: "squarespace", label: "Squarespace", steps: ["Settings → Developer tools → Code Injection (on older sites: Settings → Advanced → Code Injection).", "Paste the code in the Footer box.", "Save."] },
  { id: "webflow", label: "Webflow", steps: ["Site settings → Custom code.", "Paste the code in Footer code.", "Save, then Publish."] },
  { id: "gtm", label: "Google Tag Manager", steps: ["Tags → New → Custom HTML: paste the code.", "Triggering: All Pages.", "Save, then Submit and Publish."] },
  { id: "other", label: "Something else", steps: ["Paste the code just before </body> on every page (often in a “footer” or “custom code” setting).", "Or send the code to whoever looks after your website: it's all they need."] },
];

/** Putting the chat on the business's website: allow it, paste the code, check it's there. */
function InstallChat(props: { businessId: string; role: Role; snippet: string; base: string; onAllowed: (origins: string[]) => void }) {
  const loaded = useLoad(() => api<InstallView>("GET", businessPath(props.businessId, "/widget/install")), [props.businessId]);
  const [view, setView] = useState<InstallView | null>(null);
  const [url, setUrl] = useState("");
  const [builder, setBuilder] = useState("wordpress");
  const [copied, setCopied] = useState(false);
  const allow = useAction();
  const check = useAction();
  useEffect(() => {
    if (loaded.data) {
      setView(loaded.data);
      setUrl((current) => current || loaded.data!.website || "");
    }
  }, [loaded.data]);
  if (!view) return <ErrorLine error={loaded.error} />;
  const owner = props.role === "owner";
  const host = (() => {
    try {
      return new URL(/^[a-z]+:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`).origin;
    } catch {
      return null;
    }
  })();
  const allowed = host ? view.allowed_origins.includes(host) : false;
  const steps = BUILDERS.find((entry) => entry.id === builder)!;
  const allowSite = (address: string) => allow.run(async () => {
    const next = await api<InstallView & { added: string[] }>("POST", businessPath(props.businessId, "/widget/allow"), { url: address });
    setView({ ...view, ...next });
    props.onAllowed(next.allowed_origins);
  }, "Allowed. The chat can open there now.");
  return (
    <section className="card install">
      <h2>Put Zaina on your website</h2>
      {view.loaded ? (
        <p className="message success" role="status">The chat last opened on <strong>{view.loaded.origin}</strong>, {timeAgo(view.loaded.at)}.</p>
      ) : null}
      {view.refused.map((entry) => (
        <div key={entry.origin} className="message error install-refused" role="alert">
          <span>The chat tried to open on <strong>{entry.origin}</strong> ({timeAgo(entry.at)}), but that website isn't allowed yet.</span>
          {owner ? <Button small busy={allow.busy} onClick={() => void allowSite(entry.origin)}>Allow it</Button> : <span className="muted small">An owner can allow it.</span>}
        </div>
      ))}
      <ol className="install-steps">
        <li>
          <h3>Your website</h3>
          <div className="install-row">
            <Field label="Address"><input type="url" inputMode="url" placeholder="https://www.yourbusiness.co.ke" value={url} onChange={(event) => setUrl(event.target.value)} /></Field>
            {allowed ? <span className="chip ok">Allowed</span> : owner ? <Button kind="primary" busy={allow.busy} onClick={() => void allowSite(url)}>Allow this website</Button> : <span className="muted small">An owner allows it.</span>}
          </div>
          <p className="muted small">Both the www and plain address are allowed. Other websites can't open your chat.</p>
          <Message message={allow.message} />
        </li>
        <li>
          <h3>Add the code</h3>
          <pre className="snippet">{props.snippet}</pre>
          <div className="actions start"><Button small onClick={() => void navigator.clipboard.writeText(props.snippet).then(() => setCopied(true)).catch(() => undefined)}>{copied ? "Copied" : "Copy the code"}</Button></div>
          <Field label="Your website is built with">
            <select value={builder} onChange={(event) => setBuilder(event.target.value)}>
              {BUILDERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </Field>
          <ol className="builder-steps">{steps.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <details className="small">
            <summary>Options</summary>
            <p className="muted"><code>data-currency="KES"</code> shows prices in shillings; <code>data-open="true"</code> opens the chat on load. If your site has a Content Security Policy, allow <code>{props.base}</code> in <code>script-src</code> and <code>connect-src</code>. An older code with <code>widget.js</code> and <code>data-key</code> keeps working.</p>
          </details>
        </li>
        <li>
          <h3>Check it's there</h3>
          <div className="actions start">
            <Button kind="primary" busy={check.busy} onClick={() => void check.run(async () => setView({ ...view, ...(await api<InstallView>("POST", businessPath(props.businessId, "/widget/check"), { url: url.trim() || undefined })) }))}>Check my website</Button>
          </div>
          <Message message={check.message} />
          {view.checked ? (
            <ul className="check-results" role="status">
              <li className={view.installed === "yes" ? "ok" : "bad"}>
                {view.installed === "yes" ? "The chat's code is on the page." : view.installed === "other_business" ? "The page has a chat code, but for another business: copy the code above again." : view.tag_manager ? "The code isn't in the page itself. If you added it with Google Tag Manager, that's fine: open your website and look for the chat button." : "The chat's code isn't on the page yet. Paste it as shown above, then publish."}
              </li>
              <li className={view.allowed ? "ok" : "bad"}>
                {view.allowed ? `${view.origin} may use the chat.` : `${view.origin} isn't allowed yet.`}
                {!view.allowed && owner && view.origin ? <> <Button small busy={allow.busy} onClick={() => void allowSite(view.origin!)}>Allow it</Button></> : null}
              </li>
              <li className="muted small">Checked {view.checked}. A page that has just been changed can take a few minutes to update.</li>
            </ul>
          ) : null}
        </li>
      </ol>
    </section>
  );
}

function Whatsapp(props: { businessId: string; role: Role; admin: boolean }) {
  const state = useLoad(() => api<WhatsappState>("GET", businessPath(props.businessId, "/whatsapp")), [props.businessId]);
  const [form, setForm] = useState({ phone_number_id: "", waba_id: "", access_token: "", followup_template: "", followup_template_language: "en", followup_template_parameter: "none" });
  const action = useAction();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [byHand, setByHand] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const connection = state.data?.connection;
    if (connection) {
      setForm({
        phone_number_id: connection.phone_number_id,
        waba_id: connection.waba_id ?? "",
        access_token: "",
        followup_template: connection.followup_template ?? "",
        followup_template_language: connection.followup_template_language,
        followup_template_parameter: connection.followup_template_parameter,
      });
    }
  }, [state.data]);
  if (!state.data) return <ErrorLine error={state.error} />;
  const connection = state.data.connection;
  const owner = props.role === "owner";
  if (!state.data.available) {
    return (
      <section className="card">
        <h2>WhatsApp</h2>
        <p className="muted">WhatsApp isn't switched on for this platform yet. The platform team connects its Meta app first; then you can connect your number here.</p>
      </section>
    );
  }
  return (
    <div className="stack">
      <section className="card">
        <h2>{connection ? "Connected" : "Not connected"}</h2>
        {connection ? (
          <dl className="facts">
            <div><dt>Number</dt><dd>{connection.display_phone_number ?? connection.phone_number_id}</dd></div>
            <div><dt>Name customers see</dt><dd>{connection.verified_name ?? "—"}</dd></div>
            <div><dt>Replies after 24 hours</dt><dd>{connection.followup_template ? `Template "${connection.followup_template}" (${connection.followup_template_language})` : "No follow-up template: replies wait until the customer writes"}</dd></div>
            <div><dt>Access token</dt><dd>{connection.has_token ? "Stored (encrypted)" : "Missing"}</dd></div>
          </dl>
        ) : (
          <p className="muted">Customers who message your WhatsApp number get Zaina's answers there, and your team replies from this console. The number can't be used in the WhatsApp Business phone app at the same time.</p>
        )}
        {state.data.chat_link ? (
          <div className="stack-tight">
            <p className="small">Your click-to-chat link, for your website, Instagram, Facebook, Google profile and printed menus: <a href={state.data.chat_link} target="_blank" rel="noopener noreferrer">{state.data.chat_link}</a></p>
            <div className="actions start"><Button small onClick={() => void navigator.clipboard.writeText(state.data!.chat_link!).then(() => setCopied(true))}>{copied ? "Copied" : "Copy the link"}</Button></div>
          </div>
        ) : null}
        {state.data.webhook_url ? <p className="muted small">The platform's webhook for Meta: <code>{state.data.webhook_url}</code></p> : null}
      </section>
      {owner && state.data.embedded_signup ? (
        <section className="card stack-tight">
          <h2>{connection ? "Connect a different number" : "Connect with Facebook"}</h2>
          <p className="muted">The quickest way: sign in with Facebook, choose your business and the number customers message, and confirm it with the code Meta sends. Nothing to copy.</p>
          <div className="actions start">
            <a className="button primary" href={`/connect/whatsapp?business=${encodeURIComponent(props.businessId)}`}>Connect with Facebook</a>
            {props.admin && !byHand && !connection ? <Button onClick={() => setByHand(true)}>Connect by hand instead</Button> : null}
          </div>
        </section>
      ) : null}
      {owner && !connection && !state.data.embedded_signup && !props.admin ? (
        <section className="card">
          <h2>Connect your number</h2>
          <p className="muted">Bila Matata connects your WhatsApp number for you. Ask under <a href={`#/b/${props.businessId}/support`}>Help &amp; support</a>; never send a token or password in a message.</p>
        </section>
      ) : null}
      {owner && (connection || (props.admin && (!state.data.embedded_signup || byHand))) ? (
        <form
          className="form card"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => {
              const result = await api<WhatsappState & { warnings: string[] }>("PUT", businessPath(props.businessId, "/whatsapp"), {
                ...form,
                waba_id: form.waba_id.trim() || null,
                access_token: form.access_token.trim() || undefined,
                followup_template: form.followup_template.trim() || null,
              });
              setWarnings(result.warnings ?? []);
              await state.reload();
            }, "Connected. WhatsApp accepted the number and token.");
          }}
        >
          <h2>{connection ? "Update the connection" : "Connect your number by hand"}</h2>
          {props.admin ? (
            <>
              <p className="muted small">From Meta's WhatsApp Manager (API setup) and Business Settings (a system user's permanent token with WhatsApp messaging and management). Only Bila Matata's admins see this.</p>
              <div className="form-row">
                <Field label="Phone number ID"><input required inputMode="numeric" value={form.phone_number_id} onChange={(event) => setForm({ ...form, phone_number_id: event.target.value.trim() })} /></Field>
                <Field label="WhatsApp Business Account ID"><input inputMode="numeric" value={form.waba_id} onChange={(event) => setForm({ ...form, waba_id: event.target.value.trim() })} /></Field>
              </div>
              <Field label="Access token" hint={connection?.has_token ? "Leave empty to keep the stored token." : "Stored encrypted; never shown again."} wide>
                <input type="password" autoComplete="off" value={form.access_token} onChange={(event) => setForm({ ...form, access_token: event.target.value })} />
              </Field>
            </>
          ) : null}
          <h3>When a reply comes after 24 hours</h3>
          <p className="muted small">WhatsApp only allows free replies within 24 hours of the customer's last message. After that, an approved template tells them a reply is waiting; the reply goes out when they answer.</p>
          <div className="form-row">
            <Field label="Template name"><input placeholder="reply_waiting" value={form.followup_template} onChange={(event) => setForm({ ...form, followup_template: event.target.value.trim() })} /></Field>
            <Field label="Language code"><input value={form.followup_template_language} onChange={(event) => setForm({ ...form, followup_template_language: event.target.value.trim() })} /></Field>
            <Field label="Its {{1}} is">
              <select value={form.followup_template_parameter} onChange={(event) => setForm({ ...form, followup_template_parameter: event.target.value })}>
                <option value="none">Nothing (no variable)</option>
                <option value="business_name">The business's name</option>
                <option value="customer_name">The customer's first name</option>
              </select>
            </Field>
          </div>
          <Message message={action.message} />
          {warnings.map((warning) => <p key={warning} className="message error">{warning}</p>)}
          <div className="actions">
            {connection ? (
              <Button kind="danger" onClick={() => {
                if (!window.confirm("Disconnect WhatsApp? Customers' messages stop reaching Zaina and the token is deleted.")) return;
                void action.run(async () => {
                  await api("DELETE", businessPath(props.businessId, "/whatsapp"));
                  await state.reload();
                }, "Disconnected.");
              }}>Disconnect</Button>
            ) : null}
            <Button kind="primary" type="submit" busy={action.busy}>{connection ? "Save" : "Connect"}</Button>
          </div>
        </form>
      ) : owner ? null : (
        <p className="muted">Only an owner can connect or change WhatsApp.</p>
      )}
    </div>
  );
}

const ZONES = ["Africa/Nairobi", "Africa/Dar_es_Salaam", "Africa/Kampala", "Africa/Kigali", "Africa/Addis_Ababa", "Africa/Lagos", "Africa/Johannesburg", "Europe/London", "UTC"];

function Hours(props: { businessId: string }) {
  const operations = useLoad(() => api<Operations>("GET", businessPath(props.businessId, "/operations")), [props.businessId]);
  const [form, setForm] = useState<{ zone: string; always: boolean; days: number[]; open: string; close: string; timeout: number } | null>(null);
  const action = useAction();
  useEffect(() => {
    const data = operations.data;
    if (data) {
      setForm({
        zone: data.time_zone,
        always: data.staffed_hours === null,
        days: data.staffed_hours?.days ?? [1, 2, 3, 4, 5, 6],
        open: data.staffed_hours?.open ?? "08:00",
        close: data.staffed_hours?.close ?? "20:00",
        timeout: data.unclaimed_timeout_minutes,
      });
    }
  }, [operations.data]);
  if (!form) return <ErrorLine error={operations.error} />;
  return (
    <form
      className="form card"
      onSubmit={async (event) => {
        event.preventDefault();
        await action.run(() => api("PATCH", businessPath(props.businessId, "/operations"), {
          time_zone: form.zone,
          staffed_hours: form.always ? null : { days: form.days, open: form.open, close: form.close },
          unclaimed_timeout_minutes: form.timeout,
        }), "Saved.");
      }}
    >
      <p className="muted">When someone asks for a person outside these hours, Zaina tells them when the team is back, asks the team to call them, and keeps helping.</p>
      <Field label="Time zone">
        <select value={form.zone} onChange={(event) => setForm({ ...form, zone: event.target.value })}>
          {[...new Set([form.zone, ...ZONES])].map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
        </select>
      </Field>
      <Toggle checked={form.always} onChange={(value) => setForm({ ...form, always: value })} label="Someone is always available" />
      {!form.always ? (
        <>
          <fieldset className="days">
            <legend>Days</legend>
            {WEEKDAYS.map((name, index) => (
              <label key={name} className="day">
                <input
                  type="checkbox"
                  checked={form.days.includes(index)}
                  onChange={(event) => setForm({ ...form, days: event.target.checked ? [...form.days, index].sort() : form.days.filter((value) => value !== index) })}
                />
                {name}
              </label>
            ))}
          </fieldset>
          <div className="form-row">
            <Field label="From"><input type="time" required value={form.open} onChange={(event) => setForm({ ...form, open: event.target.value })} /></Field>
            <Field label="Until" hint="Earlier than 'From' means past midnight."><input type="time" required value={form.close} onChange={(event) => setForm({ ...form, close: event.target.value })} /></Field>
          </div>
        </>
      ) : null}
      <Field label="Minutes before an unclaimed chat goes back to Zaina" hint="Zaina then tells the customer the team will get back to them, and asks the team for a callback.">
        <input type="number" min={2} max={240} required value={form.timeout} onChange={(event) => setForm({ ...form, timeout: Number(event.target.value) })} />
      </Field>
      <Message message={action.message} />
      <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
    </form>
  );
}

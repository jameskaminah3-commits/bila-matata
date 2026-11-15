// web/console/app.tsx
//
// The console's frame: sign-in, the business being worked on, navigation by
// role, and the things that run in the background while it's open (the
// waiting count in the tab title, "I'm here" for chat routing).
//
// Pages are chosen by the address's hash: #/b/<business>/<page>/<id>, or
// #/platform for the platform's own admins. An emailed link to choose a
// password opens #/reset/<token> (or #/welcome/<token>), signed in or not.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, businessPath } from "./api.ts";
import { BookingsPage } from "./pages/bookings.tsx";
import { InboxPage } from "./pages/inbox.tsx";
import { LeadsPage } from "./pages/leads.tsx";
import { KnowledgePage } from "./pages/knowledge.tsx";
import { PlatformPage } from "./pages/platform.tsx";
import { SupportPage } from "./pages/support.tsx";
import { PricesPage } from "./pages/prices.tsx";
import { ReportsPage } from "./pages/reports.tsx";
import { RoomsPage } from "./pages/rooms.tsx";
import { ServicesPage } from "./pages/services.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import { TeamPage } from "./pages/team.tsx";
import { ChoosePassword, ForgotPassword } from "./pages/password.tsx";
import { ResendLink, SignUp, type SignupConfig } from "./pages/signup.tsx";
import { SetupPage } from "./pages/setup.tsx";
import { alertsSupported, currentSubscription, turnAlertsOff, turnAlertsOn } from "./push.ts";
import { atLeast, type Me, type Role } from "./types.ts";
import { Button, Field, Icon, Message, Modal, Toggle, useAction, useEvery, useLoad } from "./ui.tsx";

type Route = { businessId: string | null; page: string; id: string | null; sub?: string | null };

function readRoute(): Route {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  // The studio's own dashboard: #/platform/<section>/<item>.
  if (parts[0] === "platform") return { businessId: null, page: "platform", id: parts[1] ?? null, sub: parts[2] ?? null };
  if (parts[0] === "reset" || parts[0] === "welcome") return { businessId: null, page: parts[0], id: parts[1] ?? null };
  // Back from Google: a one-time hand-over to exchange, or why it didn't work.
  if (parts[0] === "signed-in" || parts[0] === "signin-error") return { businessId: null, page: parts[0], id: parts[1] ?? null };
  if (parts[0] === "b" && parts[1]) return { businessId: parts[1], page: parts[2] ?? "inbox", id: parts[3] ?? null };
  return { businessId: null, page: "inbox", id: null };
}

export function go(route: Partial<Route> & { businessId: string | null }) {
  location.hash = route.businessId
    ? `#/b/${encodeURIComponent(route.businessId)}/${route.page ?? "inbox"}${route.id ? `/${encodeURIComponent(route.id)}` : ""}`
    : "#/platform";
}

/** Opens a section of the studio's own dashboard (and one item in it). */
export function goPlatform(section?: string | null, item?: string | null) {
  location.hash = `#/platform${section ? `/${encodeURIComponent(section)}${item ? `/${encodeURIComponent(item)}` : ""}` : ""}`;
}

function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** /admin/ is the studio team's door to the same app: its own sign-in, and it opens the studio's dashboard. */
const ADMIN = location.pathname.startsWith("/admin");

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [notice, setNotice] = useState<{ email: string; text: string } | null>(null);
  const route = useRoute();

  const loadMe = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/v1/console/me"));
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    const signedOut = () => setMe(null);
    window.addEventListener("zaina:signed-out", signedOut);
    return () => window.removeEventListener("zaina:signed-out", signedOut);
  }, [loadMe]);

  if ((route.page === "reset" || route.page === "welcome") && route.id) {
    return (
      <ChoosePassword
        token={route.id}
        welcome={route.page === "welcome"}
        onDone={(email, message) => {
          setNotice(email && message ? { email, text: message } : null);
          location.hash = "";
          // A new password signed this account out everywhere, this browser too.
          void loadMe();
        }}
      />
    );
  }
  if (route.page === "signed-in" && route.id) return <GoogleHandoff handoff={route.id} onDone={() => { location.hash = ""; void loadMe(); }} />;
  if (me === undefined) return <div className="splash" aria-busy="true">Loading…</div>;
  if (me === null) return <SignIn onSignedIn={loadMe} notice={notice} googleError={route.page === "signin-error" ? route.id : null} />;
  if (ADMIN) {
    // The studio's door: a client who comes here goes to their own dashboard; the team lands on the studio's.
    if (!me.user.is_platform_admin) {
      location.replace("/app/");
      return <div className="splash" aria-busy="true">Opening your dashboard…</div>;
    }
    if (route.page !== "platform" && !route.businessId) {
      if (location.hash !== "#/platform") location.hash = "#/platform";
      return <div className="splash" aria-busy="true">Loading…</div>;
    }
  }
  return <Console me={me} route={route} reloadMe={loadMe} />;
}

const CONFIRMED: Record<string, { kind: "success" | "error"; text: string }> = {
  yes: { kind: "success", text: "Your email is confirmed. Sign in to set up your business." },
  expired: { kind: "error", text: "That link has expired or was already replaced. Sign in to ask for a new one." },
};

const GOOGLE_ERRORS: Record<string, string> = {
  "no-account": "That Google account isn't on a team yet. Sign in with the email your invitation went to, or ask your manager to add it.",
  "google-off": "Signing in with Google isn't set up yet. Use your email and password.",
  cancelled: "Google sign-in was cancelled.",
  expired: "That took too long. Please try again.",
  "google-failed": "Google didn't confirm the account. Please try again.",
  "too-many": "Too many tries. Please wait a few minutes.",
};

const deviceKey = (email: string) => `zaina:device:${email.trim().toLowerCase()}`;
const readDevice = (email: string) => {
  try {
    return localStorage.getItem(deviceKey(email));
  } catch {
    return null;
  }
};
const saveDevice = (email: string, token: string) => {
  try {
    localStorage.setItem(deviceKey(email), token);
  } catch {
    // Private browsing: the code is asked for next time.
  }
};

function GoogleButton() {
  return (
    <a className="button google-button" href={`/v1/staff/google/start?to=${ADMIN ? "admin" : "app"}`}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z" />
        <path fill="#FBBC05" d="M10.6 28.5c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.2z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
      </svg>
      Continue with Google
    </a>
  );
}

/** Back from Google: exchanges the one-time hand-over for the dashboard's sign-in. */
function GoogleHandoff(props: { handoff: string; onDone: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    api("POST", "/v1/console/session/google", { handoff: props.handoff })
      .then(() => props.onDone())
      .catch((error) => setProblem(error instanceof Error ? error.message : "That sign-in took too long. Please try again."));
  }, [props.handoff]);
  if (!problem) return <div className="splash" aria-busy="true">Signing you in…</div>;
  return (
    <main className="signin">
      <div className="signin-card">
        <h1>Couldn't sign you in</h1>
        <Message message={{ kind: "error", text: problem }} />
        <Button kind="primary" onClick={() => { location.hash = ""; location.reload(); }}>Back to sign in</Button>
      </div>
    </main>
  );
}

function SignIn(props: { onSignedIn: () => void; notice: { email: string; text: string } | null; googleError?: string | null }) {
  const [email, setEmail] = useState(props.notice?.email ?? "");
  const [password, setPassword] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [step, setStep] = useState<{ challenge: string; sentTo: string } | null>(null);
  const signup = useLoad(() => api<SignupConfig>("GET", "/v1/signup/config").catch((): SignupConfig => ({ open: false, business_types: [] })), []);
  const confirmed = CONFIRMED[new URLSearchParams(location.search).get("confirmed") ?? ""] ?? null;
  const googleProblem = props.googleError ? { kind: "error" as const, text: GOOGLE_ERRORS[props.googleError] ?? GOOGLE_ERRORS["google-failed"] } : null;
  const notice = props.notice ? { kind: "success" as const, text: props.notice.text } : googleProblem ?? confirmed;
  const action = useAction();
  if (signingUp && signup.data?.open && !ADMIN) return <SignUp config={signup.data} onBack={() => setSigningUp(false)} />;
  if (forgot) return <ForgotPassword email={email} onBack={() => setForgot(false)} />;
  if (step) return <SignInCode email={email} challenge={step.challenge} sentTo={step.sentTo} onBack={() => { setStep(null); setPassword(""); }} onSignedIn={props.onSignedIn} />;
  return (
    <main className="signin">
      <form
        className="signin-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setUnconfirmed(false);
          let next: { challenge: string; sentTo: string } | null = null;
          const signedIn = await action.run(async () => {
            try {
              const answer = await api<{ code_required?: boolean; challenge?: string; sent_to?: string }>("POST", "/v1/console/session", { email, password, target: ADMIN ? "admin" : "app", device: readDevice(email) });
              if (answer?.code_required && answer.challenge) next = { challenge: answer.challenge, sentTo: answer.sent_to ?? email };
            } catch (problem) {
              if (problem instanceof ApiError && problem.code === "email_not_confirmed") setUnconfirmed(true);
              throw problem;
            }
          });
          if (next) setStep(next);
          else if (signedIn) props.onSignedIn();
        }}
      >
        <div className="brand-mark" aria-hidden="true">{ADMIN ? "B" : "Z"}</div>
        <h1>{ADMIN ? "Bila Matata team" : "Sign in to Zaina"}</h1>
        <p className="muted">{ADMIN ? "The studio's dashboard: clients, plans, reviews and support." : "Your business's chats, knowledge and reports."}</p>
        {notice && !action.message ? <Message message={notice} /> : null}
        {signup.data?.google_sign_in ? (
          <>
            <GoogleButton />
            <p className="signin-or"><span>or with your email</span></p>
          </>
        ) : null}
        <Field label="Email">
          <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Message message={action.message} />
        {unconfirmed ? <ResendLink email={email} /> : null}
        <Button kind="primary" type="submit" busy={action.busy}>Sign in</Button>
        {signup.data?.password_reset ? <p className="muted small"><button type="button" className="link" onClick={() => setForgot(true)}>Forgot your password?</button></p> : null}
        {signup.data?.open && !ADMIN ? <p className="muted small">New here? <button type="button" className="link" onClick={() => setSigningUp(true)}>Sign up your business</button></p> : null}
        {ADMIN ? <p className="muted small">A client? <a href="/app/">Sign in to your dashboard</a></p> : null}
      </form>
    </main>
  );
}

/** The second step: the 6-digit code emailed to the account. */
function SignInCode(props: { email: string; challenge: string; sentTo: string; onBack: () => void; onSignedIn: () => void }) {
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [wait, setWait] = useState(30);
  const action = useAction();
  const resend = useAction();
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  return (
    <main className="signin">
      <form
        className="signin-card"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await action.run(async () => {
            const answer = await api<{ device_token?: string }>("POST", "/v1/console/session/verify", { challenge: props.challenge, code, trust_device: trust });
            if (answer?.device_token) saveDevice(props.email, answer.device_token);
          })) props.onSignedIn();
        }}
      >
        <div className="brand-mark" aria-hidden="true">{ADMIN ? "B" : "Z"}</div>
        <h1>Check your email</h1>
        <p className="muted">We sent a 6-digit code to <strong>{props.sentTo}</strong>. It works for 10 minutes.</p>
        <Field label="Code">
          <input
            className="code-input"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </Field>
        <label className="check"><input type="checkbox" checked={trust} onChange={(event) => setTrust(event.target.checked)} /><span>Trust this device for 30 days (don't ask for a code here)</span></label>
        <Message message={action.message ?? resend.message} />
        <Button kind="primary" type="submit" busy={action.busy} disabled={code.length !== 6}>Verify and sign in</Button>
        <p className="muted small signin-links">
          <button type="button" className="link" disabled={wait > 0 || resend.busy} onClick={() => void resend.run(async () => { await api("POST", "/v1/console/session/resend", { challenge: props.challenge }); setWait(30); }, "A new code is on its way.")}>
            {wait > 0 ? `Send a new code (${wait}s)` : "Send a new code"}
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="link" onClick={props.onBack}>Use a different account</button>
        </p>
      </form>
    </main>
  );
}

// The business's sections, most used first: on a phone, the first four sit in
// the bar at the bottom and the rest are under "More". Conversations and
// handoffs are the Inbox (waiting, mine, with the team, callbacks, all);
// offerings are Rooms or Services, and Prices.
const PAGES: Array<{ id: string; label: string; icon: string; minimum: Role; only?: string[]; status?: string }> = [
  // A business that signed up by itself, until it goes live (Phase 5).
  { id: "setup", label: "Set up", icon: "check", minimum: "viewer", status: "onboarding" },
  { id: "inbox", label: "Inbox", icon: "inbox", minimum: "viewer" },
  // People who want the team to get back to them (not for TBM, which keeps its own).
  { id: "leads", label: "Leads", icon: "user", minimum: "agent", only: ["general", "guesthouse", "salon", "restaurant"] },
  // Bookings: a place to stay's rooms (Phase 4), a salon's services and a restaurant's tables (Phase 5).
  { id: "bookings", label: "Bookings", icon: "calendar", minimum: "viewer", only: ["guesthouse", "salon", "restaurant"] },
  { id: "rooms", label: "Rooms", icon: "bed", minimum: "manager", only: ["guesthouse"] },
  { id: "services", label: "Services", icon: "scissors", minimum: "manager", only: ["salon", "restaurant"] },
  // What the business charges for things not booked here; Zaina quotes only these (and rooms and services).
  { id: "prices", label: "Prices", icon: "tag", minimum: "viewer", only: ["general", "guesthouse", "salon", "restaurant"] },
  { id: "knowledge", label: "Knowledge", icon: "book", minimum: "viewer" },
  { id: "reports", label: "Reports", icon: "chart", minimum: "manager" },
  { id: "settings", label: "Settings", icon: "settings", minimum: "manager" },
  { id: "team", label: "Team", icon: "team", minimum: "manager" },
  // How to do the everyday things, and a direct line to the studio.
  { id: "support", label: "Help & support", icon: "help", minimum: "viewer" },
];

/** On a phone, how many sections sit in the bar at the bottom (the rest are under "More"). */
const BAR_ITEMS = 4;

function Console(props: { me: Me; route: Route; reloadMe: () => Promise<void> }) {
  const { me, route } = props;
  const admin = me.user.is_platform_admin;
  const [counts, setCounts] = useState({ pending: 0, mine: 0, callbacks: 0, leads: 0, support: 0 });
  // For the studio's admins: what's waiting for them (support questions and new requests).
  const [attention, setAttention] = useState(0);
  const refreshAttention = useCallback(async () => {
    if (!admin) return;
    try {
      const result = await api<{ support_open: number; project_requests_new: number }>("GET", "/v1/platform/attention");
      setAttention(result.support_open + result.project_requests_new);
    } catch {}
  }, [admin]);
  useEffect(() => void refreshAttention(), [refreshAttention]);
  useEvery(refreshAttention, 60_000, [refreshAttention]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Choosing a section closes the phone's "More" list.
  useEffect(() => setMoreOpen(false), [route.page, route.businessId]);
  const [dialog, setDialog] = useState<"password" | "alerts" | null>(null);

  // Which business: the one in the address, or the first the person works for.
  const businessId = route.businessId ?? me.businesses[0]?.businessId ?? null;
  const membership = me.businesses.find((business) => business.businessId === businessId);
  const role: Role | null = membership?.role ?? (admin && businessId ? "owner" : null);
  const page = route.page === "platform" ? "platform" : route.page;
  // The business's type decides some pages; a platform admin without a membership asks for it.
  const typeInfo = useLoad(
    () => (membership?.businessType || !businessId || !role ? Promise.resolve(null) : api<{ business_type: string; status: string }>("GET", businessPath(businessId, "/operations"))),
    [businessId, membership?.businessType, role],
  );
  const businessType = membership?.businessType ?? typeInfo.data?.business_type ?? null;
  // A business still setting up opens on its setup page.
  const businessStatus = membership?.businessStatus ?? typeInfo.data?.status ?? null;

  useEffect(() => {
    if (!route.businessId && businessId && route.page !== "platform") go({ businessId, page: businessStatus === "onboarding" ? "setup" : "inbox" });
    if (!businessId && admin && route.page !== "platform") go({ businessId: null });
  }, [route.businessId, route.page, businessId, admin]);

  const refreshCounts = useCallback(async () => {
    if (!businessId || !role) return;
    try {
      setCounts({ support: 0, ...(await api<{ pending: number; mine: number; callbacks: number; leads: number; support?: number }>("GET", businessPath(businessId, "/pending-count"))) });
    } catch {}
  }, [businessId, role]);
  useEffect(() => void refreshCounts(), [refreshCounts]);
  useEvery(refreshCounts, 10_000, [refreshCounts]);

  useEffect(() => {
    document.title = counts.pending > 0 ? `(${counts.pending}) Zaina console` : "Zaina console";
  }, [counts.pending]);

  // "I'm here": keeps this person routable while the console is open.
  const answersChats = role !== null && atLeast(role, "agent") && Boolean(membership);
  useEvery(() => {
    if (answersChats && businessId) void api("POST", businessPath(businessId, "/presence"), {}).catch(() => {});
  }, 60_000, [answersChats, businessId]);

  const businesses = useMemo(() => {
    const list = [...me.businesses];
    if (businessId && !membership && admin) list.push({ businessId, businessName: businessId, role: "owner" });
    return list;
  }, [me.businesses, businessId, membership, admin]);

  if (!businessId && !admin) {
    return (
      <main className="signin">
        <div className="signin-card">
          <h1>No business yet</h1>
          <p className="muted">Your account isn't part of any business. Ask the business's owner to add you.</p>
          <Button onClick={() => api("DELETE", "/v1/console/session").finally(() => location.reload())}>Sign out</Button>
        </div>
      </main>
    );
  }

  const visiblePages = role ? PAGES.filter((item) => atLeast(role, item.minimum) && (!item.only || item.only.includes(businessType ?? "")) && (!item.status || item.status === businessStatus)) : [];
  const navItems = [
    ...visiblePages.map((item) => ({
      id: item.id,
      href: `#/b/${encodeURIComponent(businessId ?? "")}/${item.id}`,
      icon: item.icon,
      label: item.id === "services" && businessType === "restaurant" ? "Tables" : item.label,
      count: item.id === "inbox" ? counts.pending : item.id === "leads" ? counts.leads : item.id === "support" ? counts.support : 0,
      countLabel: item.id === "inbox" ? "waiting" : item.id === "support" ? "answered" : "new",
    })),
    ...(admin ? [{ id: "platform", href: "#/platform", icon: "shield", label: "Bila Matata", count: attention, countLabel: "waiting for you" }] : []),
  ];
  const moreActive = navItems.slice(BAR_ITEMS).some((item) => item.id === page);
  const moreCount = navItems.slice(BAR_ITEMS).reduce((sum, item) => sum + item.count, 0);
  let content: JSX.Element;
  if (page === "platform" && admin) content = <PlatformPage tab={route.id} sub={route.sub ?? null} onChanged={() => void refreshAttention()} />;
  else if (!businessId || !role) content = <div className="page"><p className="message error">You don't work for this business.</p></div>;
  else if (page === "setup") content = <SetupPage businessId={businessId} role={role} onLive={() => void props.reloadMe()} />;
  else if (page === "bookings" && ["guesthouse", "salon", "restaurant"].includes(businessType ?? "")) content = <BookingsPage businessId={businessId} role={role} bookingId={route.id} businessType={businessType} />;
  else if (page === "services" && (businessType === "salon" || businessType === "restaurant") && atLeast(role, "manager")) content = <ServicesPage businessId={businessId} role={role} businessType={businessType} />;
  else if (page === "rooms" && businessType === "guesthouse" && atLeast(role, "manager")) content = <RoomsPage businessId={businessId} role={role} />;
  else if (page === "leads" && businessType !== "custom" && atLeast(role, "agent")) content = <LeadsPage businessId={businessId} role={role} onChanged={() => void refreshCounts()} />;
  else if (page === "prices" && businessType !== "custom") content = <PricesPage businessId={businessId} role={role} businessType={businessType} />;
  else if (page === "knowledge") content = <KnowledgePage businessId={businessId} role={role} />;
  else if (page === "reports" && atLeast(role, "manager")) content = <ReportsPage businessId={businessId} />;
  else if (page === "settings" && atLeast(role, "manager")) content = <SettingsPage key={route.id ?? "settings"} businessId={businessId} role={role} me={me} businessType={businessType} tab={route.id} onBusinessChanged={() => void props.reloadMe()} />;
  else if (page === "team" && atLeast(role, "manager")) content = <TeamPage businessId={businessId} role={role} me={me} />;
  else if (page === "support") content = <SupportPage businessId={businessId} role={role} threadId={route.id} onChanged={() => void refreshCounts()} />;
  else content = <InboxPage businessId={businessId} role={role} me={me} chatId={route.page === "inbox" ? route.id : null} counts={counts} onChanged={refreshCounts} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark small" aria-hidden="true">Z</span><span>Zaina</span></div>
        {businesses.length > 0 ? (
          <label className="business-switch">
            <span className="visually-hidden">Business</span>
            <select value={businessId ?? ""} onChange={(event) => go({ businessId: event.target.value, page: "inbox" })}>
              {businesses.map((business) => <option key={business.businessId} value={business.businessId}>{business.businessName}</option>)}
            </select>
          </label>
        ) : null}
        <div className="topbar-spacer" />
        {answersChats && businessId ? <Availability businessId={businessId} /> : null}
        <button type="button" className="icon-button" aria-label="Alerts on this device" title="Alerts on this device" onClick={() => setDialog("alerts")}>
          <Icon name="bell" />
        </button>
        <div className="menu">
          <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            {me.user.name.slice(0, 1).toUpperCase()}
          </button>
          {menuOpen ? (
            <div className="menu-list" role="menu" onMouseLeave={() => setMenuOpen(false)}>
              <p className="menu-who">{me.user.name}<br /><span className="muted">{me.user.email}</span></p>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDialog("password"); }}>Change password</button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDialog("alerts"); }}>Alerts</button>
              <button type="button" role="menuitem" onClick={() => api("DELETE", "/v1/console/session").finally(() => location.reload())}>Sign out</button>
            </div>
          ) : null}
        </div>
      </header>
      <nav className="sidenav" aria-label="Sections">
        {navItems.map((item, index) => (
          <a
            key={item.id}
            href={item.href}
            className={[page === item.id ? "active" : "", index >= BAR_ITEMS ? "nav-extra" : ""].filter(Boolean).join(" ")}
            aria-current={page === item.id ? "page" : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.count ? <span className="count" aria-label={`${item.count} ${item.countLabel}`}>{item.count}</span> : null}
          </a>
        ))}
        {navItems.length > BAR_ITEMS ? (
          <button type="button" className={`nav-more${moreActive ? " active" : ""}`} aria-expanded={moreOpen} aria-controls="more-sections" onClick={() => setMoreOpen(!moreOpen)}>
            <Icon name="more" />
            <span>More</span>
            {moreCount ? <span className="count" aria-label={`${moreCount} to look at`}>{moreCount}</span> : null}
          </button>
        ) : null}
      </nav>
      {moreOpen ? (
        <>
          <div className="more-backdrop" onClick={() => setMoreOpen(false)} />
          <nav id="more-sections" className="more-sheet" aria-label="More sections">
            {navItems.slice(BAR_ITEMS).map((item) => (
              <a key={item.id} href={item.href} className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.count ? <span className="count">{item.count}</span> : null}
              </a>
            ))}
          </nav>
        </>
      ) : null}
      <main className="main">
        {membership?.businessStatus === "paused" && page !== "platform" ? <PausedBanner businessId={businessId!} reason={membership.pauseReason ?? "platform"} canPay={atLeast(role ?? "viewer", "manager")} /> : null}
        {content}
      </main>
      {dialog === "password" ? <PasswordDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "alerts" ? <AlertsDialog me={me} businessId={membership ? businessId : null} onClose={() => { setDialog(null); void props.reloadMe(); }} /> : null}
    </div>
  );
}

/** Customers aren't answered while a business is paused: why, and (for an unpaid invoice) where to pay it. */
function PausedBanner(props: { businessId: string; reason: "platform" | "billing"; canPay: boolean }) {
  return (
    <div className="banner" role="status">
      <Icon name="alert" size={16} />
      {props.reason === "billing" ? (
        <span>
          Zaina is paused: an invoice is unpaid, so customers aren't answered.{" "}
          {props.canPay ? <><a href={`#/b/${encodeURIComponent(props.businessId)}/settings/billing`}>Pay it</a> and Zaina answers again straight away.</> : "An owner can pay it in Settings."}
        </span>
      ) : (
        <span>Zaina is paused by the Zaina team, so customers aren't answered. Please contact them.</span>
      )}
    </div>
  );
}

function Availability(props: { businessId: string }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api<{ available: boolean }>("POST", businessPath(props.businessId, "/presence"), {})
      .then((result) => live && setAvailable(result.available))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, [props.businessId]);
  if (available === null) return null;
  return (
    <div className="availability" title="Waiting chats are offered to people who are taking chats">
      <Toggle
        checked={available}
        label={available ? "Taking chats" : "Not taking chats"}
        onChange={async (value) => {
          setAvailable(value);
          try {
            setAvailable((await api<{ available: boolean }>("POST", businessPath(props.businessId, "/presence"), { available: value })).available);
          } catch {
            setAvailable(!value);
          }
        }}
      />
    </div>
  );
}

function PasswordDialog(props: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const action = useAction();
  return (
    <Modal title="Change password" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(() => api("POST", "/v1/staff/me/password", { current, next }), "Password changed. Other devices are signed out.");
          setCurrent("");
          setNext("");
        }}
      >
        <Field label="Current password"><input type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} /></Field>
        <Field label="New password" hint="At least 10 characters, letters with numbers or symbols."><input type="password" autoComplete="new-password" required value={next} onChange={(event) => setNext(event.target.value)} /></Field>
        <Message message={action.message} />
        <div className="actions"><Button kind="primary" type="submit" busy={action.busy}>Change password</Button></div>
      </form>
    </Modal>
  );
}

function AlertsDialog(props: { me: Me; businessId: string | null; onClose: () => void }) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [emailOn, setEmailOn] = useState<boolean | null>(null);
  const action = useAction();
  const supported = alertsSupported() && Boolean(props.me.push.public_key);
  useEffect(() => {
    if (supported) void currentSubscription().then((subscription) => setSubscribed(Boolean(subscription))).catch(() => setSubscribed(false));
    if (props.businessId) {
      void api<{ alert_email: boolean }>("GET", businessPath(props.businessId, "/members/me")).then((result) => setEmailOn(result.alert_email)).catch(() => {});
    }
  }, [supported, props.businessId]);
  return (
    <Modal title="Alerts" onClose={props.onClose}>
      <div className="form">
        <section>
          <h3>On this phone or computer</h3>
          {!props.me.push.public_key ? (
            <p className="muted">Alerts on phones aren't switched on for this platform yet.</p>
          ) : !alertsSupported() ? (
            <p className="muted">This browser can't show alerts. On an iPhone, add the console to your home screen first (Share → Add to Home Screen), then open it from there.</p>
          ) : (
            <>
              <p className="muted">A notification when a customer is waiting for you, when a customer you're helping replies, and when a callback is needed.</p>
              {typeof Notification !== "undefined" && Notification.permission === "denied" ? (
                <p className="message error">Notifications are blocked for this site in your browser settings.</p>
              ) : null}
              <Toggle
                checked={Boolean(subscribed)}
                disabled={subscribed === null || action.busy}
                label={subscribed ? "Alerts are on for this device" : "Alerts are off for this device"}
                onChange={(value) => void action.run(async () => {
                  if (value) await turnAlertsOn(props.me.push.public_key!);
                  else await turnAlertsOff();
                  setSubscribed(value);
                })}
              />
            </>
          )}
        </section>
        {props.businessId ? (
          <section>
            <h3>By email</h3>
            <Toggle
              checked={Boolean(emailOn)}
              disabled={emailOn === null}
              label="Email me about waiting chats and callbacks for this business"
              onChange={(value) => void action.run(async () => {
                const result = await api<{ alert_email: boolean }>("PATCH", businessPath(props.businessId!, "/members/me"), { alert_email: value });
                setEmailOn(result.alert_email);
              })}
            />
          </section>
        ) : null}
        <Message message={action.message} />
      </div>
    </Modal>
  );
}

export function errorText(problem: unknown): string {
  return problem instanceof ApiError ? problem.message : "Something went wrong.";
}

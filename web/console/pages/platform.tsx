// web/console/pages/platform.tsx
//
// The studio's own dashboard, for its admins:
//
//   Overview    what needs someone now: support questions, project requests
//               from the website, chats waiting on the studio's own site,
//               unpaid studio invoices
//   Businesses  every client: its plan (Starter or Full), whether it's live,
//               its day (model use against its budget, chats, waiting
//               handoffs, failed turns); add one, change its plan, pause it
//   Billing     the plans and their monthly invoices (platform-billing.tsx)
//   Invoices    the studio's own invoices: set-up fees and project work
//   Support     what businesses have asked (support.tsx)

import { useEffect, useState } from "react";
import { api, ApiError } from "../api.ts";
import { go, goPlatform } from "../app.tsx";
import { cents, count, timeAgo } from "../format.ts";
import type { Plan } from "../types.ts";
import { Button, ErrorLine, Field, Icon, Message, Modal, Tabs, useAction, useEvery, useLoad } from "../ui.tsx";
import { PlatformBillingSection } from "./platform-billing.tsx";
import { StudioInvoicesSection } from "./platform-studio-invoices.tsx";
import { PlatformSupport } from "./support.tsx";
import { ReviewSection } from "./review.tsx";
import { OnboardingTracker } from "./onboarding-tracker.tsx";

type Tier = "starter" | "full";
type Overview = {
  businesses: Array<{
    id: string;
    name: string;
    business_type: string;
    tier: Tier;
    platform_payments?: boolean;
    status: "onboarding" | "active" | "paused";
    tokens_today: number;
    daily_token_cap: number | null;
    chats_7d: number;
    waiting: number;
    turns_24h: number;
    failed_24h: number;
    last_activity_at: string | null;
    whatsapp: boolean;
  }>;
  platform: {
    whatsapp: boolean; web_push: boolean; alert_email: boolean; public_base_url: string | null;
    replies_24h: { replies: number; typical_ms: number; slowest_ms: number; model_share: number; model_calls: number; timed_out: number; failed: number; model: string; thinking: string };
    whatsapp_setup: { webhook_url: string | null; verified_at: string | null; last_delivery_at: string | null; one_click: boolean; graph_version: string; numbers: number } | null;
  };
};
type Attention = { support_open: number; studio_invoices_open: number; project_requests_new: number; site_chats_waiting: number; studio_business_id: string };
type Subscriptions = { subscriptions: Array<{ business_id: string; plan_id: string; plan_name: string; status: string }> };
type Business = Overview["businesses"][number];

const TABS = ["overview", "businesses", "onboarding", "review", "billing", "invoices", "support"] as const;
type Tab = (typeof TABS)[number];
export const TIER_NAMES: Record<Tier, string> = { starter: "Starter", full: "Full" };
const KIND: Record<string, string> = { general: "General", guesthouse: "Rooms", salon: "Appointments", restaurant: "Tables", custom: "Custom" };

export function PlatformPage(props: { tab: string | null; sub: string | null; onChanged?: () => void }) {
  const tab: Tab = TABS.includes(props.tab as Tab) ? (props.tab as Tab) : "overview";
  const attention = useLoad(() => api<Attention>("GET", "/v1/platform/attention"), []);
  useEvery(() => void attention.reload(), 30_000, []);
  const changed = () => { void attention.reload(); props.onChanged?.(); };
  return (
    <div className="page">
      <div className="page-head">
        <h1>Bila Matata</h1>
        <p className="muted">Your clients, their plans, what they've asked, and what's waiting for you.</p>
      </div>
      <Tabs
        label="Sections"
        active={tab}
        onChange={(next) => goPlatform(next)}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "businesses", label: "Businesses" },
          { id: "onboarding", label: "Onboarding" },
          { id: "review", label: "Review" },
          { id: "billing", label: "Plans & billing" },
          { id: "invoices", label: "Studio invoices", count: attention.data?.studio_invoices_open },
          { id: "support", label: "Support", count: attention.data?.support_open },
        ]}
      />
      {tab === "overview" ? <OverviewTab attention={attention.data} error={attention.error} /> : null}
      {tab === "businesses" ? <BusinessesTab /> : null}
      {tab === "onboarding" ? <OnboardingTracker /> : null}
      {tab === "review" ? <ReviewSection /> : null}
      {tab === "billing" ? <PlatformBillingSection /> : null}
      {tab === "invoices" ? <StudioInvoicesSection /> : null}
      {tab === "support" ? <PlatformSupport threadId={props.sub} onOpen={(id) => goPlatform("support", id)} onChanged={changed} /> : null}
    </div>
  );
}

// ── Overview: what needs someone now ──────────────────────────────────

function OverviewTab(props: { attention: Attention | null; error: string | null }) {
  const overview = useLoad(() => api<Overview>("GET", "/v1/platform/overview"), []);
  const a = props.attention;
  const studio = a?.studio_business_id ?? "bilamatata";
  const live = overview.data?.businesses.filter((business) => business.status === "active").length ?? 0;
  const waiting = overview.data?.businesses.reduce((sum, business) => sum + business.waiting, 0) ?? 0;
  const cards: Array<{ n: number | undefined; label: string; hint: string; action: string; onClick: () => void; urgent: boolean }> = [
    { n: a?.support_open, label: "Support questions", hint: "Businesses waiting for your answer", action: "Answer them", onClick: () => goPlatform("support"), urgent: true },
    { n: a?.project_requests_new, label: "New requests", hint: "From the website's Book buttons and from Zaina", action: "Open requests", onClick: () => go({ businessId: studio, page: "leads" }), urgent: true },
    { n: a?.site_chats_waiting, label: "Site chats waiting", hint: "Visitors on bilamatata.com who asked for a person", action: "Open the inbox", onClick: () => go({ businessId: studio, page: "inbox" }), urgent: true },
    { n: a?.studio_invoices_open, label: "Unpaid studio invoices", hint: "Set-up fees and project work", action: "See invoices", onClick: () => goPlatform("invoices"), urgent: false },
  ];
  const platform = overview.data?.platform;
  return (
    <section className="stack">
      <ErrorLine error={props.error ?? overview.error} />
      <div className="attention-grid">
        {cards.map((card) => (
          <article key={card.label} className={`card attention${card.urgent && (card.n ?? 0) > 0 ? " urgent" : ""}`}>
            <p className="attention-n">{card.n ?? "–"}</p>
            <h3>{card.label}</h3>
            <p className="muted small">{card.hint}</p>
            <Button small kind={card.urgent && (card.n ?? 0) > 0 ? "primary" : "secondary"} onClick={card.onClick}>{card.action}</Button>
          </article>
        ))}
      </div>
      {overview.data ? (
        <div className="card">
          <h3>Clients</h3>
          <p>
            <strong>{overview.data.businesses.length}</strong> business{overview.data.businesses.length === 1 ? "" : "es"}, <strong>{live}</strong> live
            {waiting > 0 ? <>, <strong>{waiting}</strong> chat{waiting === 1 ? "" : "s"} waiting for their teams</> : null}.
          </p>
          <Button small onClick={() => goPlatform("businesses")}>See all businesses</Button>
        </div>
      ) : null}
      {platform ? (
        <div className="card">
          <h3>What's switched on</h3>
          <ul className="check-list">
            <li><Switched on={Boolean(platform.public_base_url)} /> Site address {platform.public_base_url ? <span className="muted">({platform.public_base_url})</span> : <span className="muted">(set PUBLIC_BASE_URL)</span>}</li>
            <li><Switched on={platform.alert_email} /> Email: receipts, invitations, alerts and support replies {platform.alert_email ? null : <span className="muted">(set RESEND_API_KEY and ALERT_FROM_EMAIL)</span>}</li>
            <li><Switched on={platform.web_push} /> Alerts on phones {platform.web_push ? null : <span className="muted">(off: WEB_PUSH=off is set)</span>}</li>
            <li><Switched on={platform.whatsapp} /> WhatsApp {platform.whatsapp ? null : <span className="muted">(set WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN)</span>}</li>
          </ul>
        </div>
      ) : null}
      {platform?.replies_24h ? <ReplySpeed speed={platform.replies_24h} /> : null}
      {platform?.whatsapp_setup ? <WhatsappSetup setup={platform.whatsapp_setup} /> : null}
    </section>
  );
}

/** How quickly Zaina answered in the last 24 hours, and where the time went: the first place to look when replies feel slow. */
function ReplySpeed(props: { speed: NonNullable<Overview["platform"]["replies_24h"]> }) {
  const { speed } = props;
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const slow = speed.replies > 0 && speed.typical_ms > 8000;
  return (
    <div className="card">
      <h3>Zaina's replies, last 24 hours</h3>
      {speed.replies === 0 ? <p className="muted">No replies yet.</p> : (
        <ul className="check-list">
          <li><Switched on={!slow} /> Typical reply in <strong>{seconds(speed.typical_ms)}</strong>; the slowest 5% in {seconds(speed.slowest_ms)} ({speed.replies} replies)</li>
          <li><Switched on={speed.timed_out + speed.failed === 0} /> {speed.timed_out} timed out, {speed.failed} failed</li>
          <li className="muted">{Math.round(speed.model_share * 100)}% of the time is the AI model ({speed.model}, thinking {speed.thinking}), {speed.model_calls} model calls per reply</li>
        </ul>
      )}
      {slow ? <p className="muted small">Slow replies are almost always the model: check ZAINA_MODEL in Railway (a "lite" model answers fastest) and ZAINA_THINKING (low or minimal).</p> : null}
    </div>
  );
}

/** WhatsApp's set-up, step by step, as far as the platform can see it: each step turns green when Meta has done its part. */
function WhatsappSetup(props: { setup: NonNullable<Overview["platform"]["whatsapp_setup"]> }) {
  const { setup } = props;
  const when = (at: string | null) => (at ? new Date(at).toLocaleString() : null);
  return (
    <div className="card">
      <h3>WhatsApp set-up</h3>
      <ol className="check-list">
        <li><Switched on /> The Meta app's secret and the verify token are set</li>
        <li>
          <Switched on={Boolean(setup.verified_at)} /> Meta verified the webhook{" "}
          {setup.verified_at ? <span className="muted">({when(setup.verified_at)})</span> : (
            <span className="muted">: in the Meta app, WhatsApp → Configuration → Webhook, callback URL <code>{setup.webhook_url ?? "(set PUBLIC_BASE_URL)"}</code> and your verify token, then Verify and save</span>
          )}
        </li>
        <li>
          <Switched on={Boolean(setup.last_delivery_at)} /> Meta delivers messages{" "}
          {setup.last_delivery_at ? <span className="muted">(last {when(setup.last_delivery_at)})</span> : (
            <span className="muted">: subscribe the webhook to <code>messages</code>, then press Test beside it, or message a connected number</span>
          )}
        </li>
        <li><Switched on={setup.numbers > 0} /> Numbers connected: {setup.numbers} {setup.numbers ? null : <span className="muted">(each business connects its own under Settings → WhatsApp)</span>}</li>
        <li><Switched on={setup.one_click} /> "Connect with Facebook" in one click {setup.one_click ? null : <span className="muted">(later: after Meta approves the app as a Tech Provider, set WHATSAPP_APP_ID and WHATSAPP_CONFIG_ID)</span>}</li>
      </ol>
    </div>
  );
}

const Switched = (props: { on?: boolean }) => (props.on
  ? <span className="status good"><Icon name="check" size={13} />On</span>
  : <span className="status warning"><Icon name="alert" size={13} />Off</span>);

// ── Businesses: every client and its plan ─────────────────────────────

function BusinessesTab() {
  const overview = useLoad(() => api<Overview>("GET", "/v1/platform/overview"), []);
  const plans = useLoad(() => api<{ plans: Plan[] }>("GET", "/v1/platform/plans").then((result) => result.plans), []);
  const billing = useLoad(() => api<Subscriptions>("GET", "/v1/platform/billing"), []);
  useEvery(() => void overview.reload(), 30_000, []);
  const [adding, setAdding] = useState(false);
  const [planFor, setPlanFor] = useState<Business | null>(null);
  const [ownerFor, setOwnerFor] = useState<Business | null>(null);
  const action = useAction();
  const reload = async () => { await Promise.all([overview.reload(), billing.reload()]); };
  const planOf = (id: string) => billing.data?.subscriptions.find((row) => row.business_id === id && row.status !== "cancelled");
  const data = overview.data;
  return (
    <section className="stack">
      <div className="room-head">
        <h2>Businesses</h2>
        <Button kind="primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add a business</Button>
      </div>
      <Message message={action.message} />
      <ErrorLine error={overview.error ?? plans.error ?? billing.error} />
      {data ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Business</th>
                <th>Plan</th>
                <th>Status</th>
                <th className="number">Model use today</th>
                <th className="number">Chats (7 days)</th>
                <th className="number">Waiting</th>
                <th className="number">Failed (24 h)</th>
                <th>Last activity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.businesses.map((business) => {
                const share = business.daily_token_cap ? business.tokens_today / business.daily_token_cap : null;
                const plan = planOf(business.id);
                return (
                  <tr key={business.id}>
                    <td>
                      <button type="button" className="link" onClick={() => go({ businessId: business.id, page: "inbox" })}><strong>{business.name}</strong></button>
                      <div className="muted small">{business.id} · {KIND[business.business_type] ?? business.business_type}{business.whatsapp ? " · WhatsApp" : ""}</div>
                    </td>
                    <td>
                      <span className={`chip${business.tier === "full" ? " ok" : ""}`}>{TIER_NAMES[business.tier]}</span>
                      <div className="muted small">{plan ? plan.plan_name : "No plan: billed by hand"}</div>
                    </td>
                    <td>{business.status === "active" ? <span className="chip ok">Live</span> : business.status === "onboarding" ? <span className="chip">Setting up</span> : <span className="chip waiting">Paused</span>}</td>
                    <td className="number">
                      {count(business.tokens_today)}{business.daily_token_cap ? ` of ${count(business.daily_token_cap)}` : ""}
                      {share !== null && share >= 0.8 ? <span className={`status ${share >= 1 ? "critical" : "warning"}`}><Icon name="alert" size={13} />{share >= 1 ? "Budget used" : "Near budget"}</span> : null}
                    </td>
                    <td className="number">{count(business.chats_7d)}</td>
                    <td className="number">{business.waiting}</td>
                    <td className="number">
                      {business.failed_24h}
                      {business.turns_24h > 0 && business.failed_24h / business.turns_24h > 0.05 ? <span className="status warning"><Icon name="alert" size={13} />{Math.round((business.failed_24h / business.turns_24h) * 100)}%</span> : null}
                    </td>
                    <td className="muted">{business.last_activity_at ? timeAgo(business.last_activity_at) : "—"}</td>
                    <td className="row-actions">
                      <Button small onClick={() => setPlanFor(business)}>Plan</Button>{" "}
                      <Button small kind="ghost" onClick={() => setOwnerFor(business)}>Owner</Button>{" "}
                      {business.status === "active" ? (
                        <Button small kind="ghost" busy={action.busy} onClick={() => {
                          if (!window.confirm(`Pause ${business.name}? Zaina stops answering its customers until you resume it.`)) return;
                          void action.run(async () => { await api("PATCH", `/v1/platform/businesses/${business.id}`, { status: "paused" }); await reload(); }, `${business.name} is paused.`);
                        }}>Pause</Button>
                      ) : business.status === "paused" ? (
                        <Button small kind="ghost" busy={action.busy} onClick={() => void action.run(async () => { await api("PATCH", `/v1/platform/businesses/${business.id}`, { status: "active" }); await reload(); }, `${business.name} is live again.`)}>Resume</Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {adding ? <AddBusiness plans={plans.data ?? []} onClose={() => setAdding(false)} onAdded={async (text) => { setAdding(false); action.setMessage({ kind: "success", text }); await reload(); }} /> : null}
      {ownerFor ? <HandOver business={ownerFor} onClose={() => setOwnerFor(null)} onSaved={(text) => { setOwnerFor(null); action.setMessage({ kind: "success", text }); }} /> : null}
      {planFor ? <SetPlan business={planFor} current={planOf(planFor.id)?.plan_id ?? null} plans={plans.data ?? []} onClose={() => setPlanFor(null)} onSaved={async (text) => { setPlanFor(null); action.setMessage({ kind: "success", text }); await reload(); }} /> : null}
    </section>
  );
}

const planLine = (plan: Plan) => `${plan.name}: ${plan.price_text} · ${TIER_NAMES[plan.tier]}${plan.setup_fee_minor > 0 ? ` · set-up ${cents(plan.setup_fee_minor, plan.currency)}` : ""}`;

const TIER_HELP: Record<Tier, string> = {
  starter: "Starter: Zaina answers from the business's information, quotes its price list, takes leads and hands over to its team.",
  full: "Full: everything in Starter, plus live availability, exact totals, bookings, checkout and calendars.",
};

/** What a business gets: one of the plans (billed by itself every month), or just a tier (billed by hand). */
function SetPlan(props: { business: Business; current: string | null; plans: Plan[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [choice, setChoice] = useState<string>(props.current ?? "");
  const [tier, setTier] = useState<Tier>(props.business.tier);
  const [platformPayments, setPlatformPayments] = useState(props.business.platform_payments === true);
  const integration = useLoad(() => api<{ enabled: boolean; connected: boolean }>("GET", `/v1/platform/businesses/${props.business.id}/integration`), [props.business.id]);
  const [connect, setConnect] = useState<boolean | null>(null);
  useEffect(() => { if (integration.data) setConnect(integration.data.enabled); }, [integration.data]);
  const action = useAction();
  const plan = props.plans.find((entry) => entry.id === choice) ?? null;
  return (
    <Modal title={`Plan for ${props.business.name}`} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            await api("PATCH", `/v1/platform/businesses/${props.business.id}`, { ...(plan ? { plan_id: plan.id } : { tier }), ...(platformPayments !== (props.business.platform_payments === true) ? { platform_payments: platformPayments } : {}) });
            if (connect !== null && integration.data && connect !== integration.data.enabled) await api("PATCH", `/v1/platform/businesses/${props.business.id}/integration`, { enabled: connect });
            props.onSaved(plan ? `${props.business.name} is on ${plan.name} (${TIER_NAMES[plan.tier]}). Its invoices go out by themselves.` : `${props.business.name} is on the ${TIER_NAMES[tier]} tier.`);
          });
        }}
      >
        <Field label="Plan" hint="On a plan, the monthly invoice goes out by itself and an unpaid one pauses the business after the grace period.">
          <select value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value="" disabled={Boolean(props.current)}>No plan: I bill this business by hand</option>
            {props.plans.map((entry) => <option key={entry.id} value={entry.id}>{planLine(entry)}</option>)}
          </select>
        </Field>
        {!plan ? (
          <Field label="What it gets">
            <select value={tier} onChange={(event) => setTier(event.target.value as Tier)}>
              <option value="starter">Starter</option>
              <option value="full">Full</option>
            </select>
          </Field>
        ) : null}
        <p className="muted small">{TIER_HELP[plan?.tier ?? tier]}</p>
        <label className="check"><input type="checkbox" checked={platformPayments} onChange={(event) => setPlatformPayments(event.target.checked)} /><span>Let this business be paid through our payment account (a subaccount)</span></label>
        <p className="muted small">Leave this off: a business's customers pay into its own account, and Zaina never collects money for it. Turn it on only for a business that can't open an account of its own.</p>
        {connect !== null ? (
          <>
            <label className="check"><input type="checkbox" checked={connect} onChange={(event) => setConnect(event.target.checked)} /><span>Let this business connect its own system (shop, booking system or back office){integration.data?.connected ? " · connected" : ""}</span></label>
            <p className="muted small">Its manager then connects it under Settings → Your system (docs/INTEGRATION.md). Turning this off stops Zaina using it at once.</p>
          </>
        ) : null}
        {props.plans.length === 0 ? <p className="muted small">There are no plans yet: add them under Plans &amp; billing.</p> : null}
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

function AddBusiness(props: { plans: Plan[]; onClose: () => void; onAdded: (message: string) => void }) {
  const [form, setForm] = useState({ id: "", name: "", origin: "", type: "general", plan: props.plans[0]?.id ?? "", tier: "starter" as Tier, setup: true, ownerEmail: "", ownerName: "", ownerPassword: "" });
  // The owner's email already has a dashboard: added to it only when the studio says it's the same owner.
  const [existingOwner, setExistingOwner] = useState<{ email: string; message: string } | null>(null);
  const [sameOwner, setSameOwner] = useState(false);
  const action = useAction();
  const plan = props.plans.find((entry) => entry.id === form.plan) ?? null;
  const tier = plan?.tier ?? form.tier;
  const books = form.type !== "general";
  return (
    <Modal title="Add a business" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            const created = await api<{ business: { id: string; public_key: string }; owner: { invited: boolean }; setup_invoice: { reference: string; emailed: boolean } | null }>("POST", "/v1/platform/businesses", {
              id: form.id,
              name: form.name,
              business_type: form.type,
              allowed_origins: form.origin.trim() ? [form.origin.trim()] : [],
              ...(plan ? { plan_id: plan.id, setup_invoice: form.setup && plan.setup_fee_minor > 0 } : { tier: form.tier }),
              owner: { email: form.ownerEmail, name: form.ownerName, password: form.ownerPassword || undefined, add_to_existing: sameOwner && existingOwner?.email === form.ownerEmail.trim().toLowerCase() },
            }).catch((problem) => {
              if (problem instanceof ApiError && problem.code === "owner_has_business") setExistingOwner({ email: form.ownerEmail.trim().toLowerCase(), message: problem.message });
              throw problem;
            });
            props.onAdded([
              `Added ${form.name} on ${plan ? plan.name : `the ${TIER_NAMES[tier]} tier`}.`,
              created.owner.invited ? "Its owner was emailed a link to choose their password." : "Its owner can sign in now.",
              created.setup_invoice ? `Set-up invoice ${created.setup_invoice.reference} is ready${created.setup_invoice.emailed ? " and was emailed to the owner" : ""}.` : "",
            ].filter(Boolean).join(" "));
          });
        }}
      >
        <div className="form-row">
          <Field label="Name"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Id" hint="Lowercase letters, digits and dashes; can't change."><input required pattern="[a-z][a-z0-9\-]{1,39}" value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value.trim() })} /></Field>
        </div>
        <div className="form-row">
          <Field label="What it sells">
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              <option value="general">Products or services (answers, prices, leads)</option>
              <option value="salon">Appointments (a salon, barber, spa or clinic)</option>
              <option value="restaurant">Tables (a restaurant or café)</option>
              <option value="guesthouse">Rooms by the night</option>
            </select>
          </Field>
          <Field label="Website" hint="Where the chat will run."><input type="url" placeholder="https://" value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} /></Field>
        </div>
        <h3>Plan</h3>
        {props.plans.length ? (
          <Field label="Plan" hint="Its monthly invoices go out by themselves.">
            <select value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value })}>
              {props.plans.map((entry) => <option key={entry.id} value={entry.id}>{planLine(entry)}</option>)}
              <option value="">No plan: I bill this business by hand</option>
            </select>
          </Field>
        ) : null}
        {!plan ? (
          <Field label="What it gets" hint={props.plans.length ? undefined : "There are no plans yet (add them under Plans & billing): this business is billed by hand."}>
            <select value={form.tier} onChange={(event) => setForm({ ...form, tier: event.target.value as Tier })}>
              <option value="starter">Starter</option>
              <option value="full">Full</option>
            </select>
          </Field>
        ) : null}
        <p className="muted small">{TIER_HELP[tier]}{tier === "starter" && books ? " On Starter this business takes no bookings: Zaina answers and passes leads to its team." : ""}</p>
        {plan && plan.setup_fee_minor > 0 ? (
          <label className="check"><input type="checkbox" checked={form.setup} onChange={(event) => setForm({ ...form, setup: event.target.checked })} /><span>Bill the one-off set-up fee ({cents(plan.setup_fee_minor, plan.currency)}) with an invoice the owner pays online</span></label>
        ) : null}
        <h3>First owner</h3>
        <div className="form-row">
          <Field label="Email" hint="The owner's own email: each business gets its own dashboard."><input type="email" required value={form.ownerEmail} onChange={(event) => { setForm({ ...form, ownerEmail: event.target.value }); setSameOwner(false); }} /></Field>
          <Field label="Name"><input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} /></Field>
        </div>
        <Field label="Starting password (optional)" hint="Only for a new account. Leave it empty and the owner is emailed a link to choose their own."><input type="password" autoComplete="new-password" value={form.ownerPassword} onChange={(event) => setForm({ ...form, ownerPassword: event.target.value })} /></Field>
        {existingOwner && existingOwner.email === form.ownerEmail.trim().toLowerCase() ? (
          <label className="check"><input type="checkbox" checked={sameOwner} onChange={(event) => setSameOwner(event.target.checked)} /><span>It's the same owner: add this business to their dashboard</span></label>
        ) : null}
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Add business</Button></div>
      </form>
    </Modal>
  );
}

/** Who owns a business, and handing it to its real owner (the studio's admins then stop being its members). */
function HandOver(props: { business: Business; onClose: () => void; onSaved: (message: string) => void }) {
  const owners = useLoad(() => api<{ owners: Array<{ email: string; name: string; is_admin: boolean }> }>("GET", `/v1/platform/businesses/${props.business.id}/owner`).then((result) => result.owners), [props.business.id]);
  const [form, setForm] = useState({ email: "", name: "", password: "" });
  const action = useAction();
  const adminOwns = owners.data?.some((owner) => owner.is_admin) ?? false;
  return (
    <Modal title={`Owner of ${props.business.name}`} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            const handed = await api<{ owner: { email: string; invited: boolean }; removed_admins: number }>("POST", `/v1/platform/businesses/${props.business.id}/owner`, { email: form.email, name: form.name, password: form.password || undefined });
            props.onSaved([
              `${props.business.name} now belongs to ${handed.owner.email}.`,
              handed.owner.invited ? "They were emailed a link to choose their password." : "They can sign in now.",
              handed.removed_admins ? "It no longer shows in the studio's own dashboards; open it from Businesses." : "",
            ].filter(Boolean).join(" "));
          });
        }}
      >
        <ErrorLine error={owners.error} />
        {owners.data ? (
          <ul className="owner-list">
            {owners.data.map((owner) => <li key={owner.email}><strong>{owner.name || owner.email}</strong> <span className="muted">{owner.email}</span>{owner.is_admin ? <span className="chip waiting">Studio admin</span> : null}</li>)}
          </ul>
        ) : null}
        {adminOwns ? <p className="muted small">A studio admin owns this business, so it shows among their own businesses. Hand it to its owner: they get their own dashboard, and you still reach it from here.</p> : null}
        <div className="form-row">
          <Field label="Owner's email"><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Name" hint="For a new account."><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        </div>
        <Field label="Starting password (optional)" hint="Only for a new account. Leave it empty and they're emailed a link to choose their own."><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Make them the owner</Button></div>
      </form>
    </Modal>
  );
}

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

import { useState } from "react";
import { api } from "../api.ts";
import { go, goPlatform } from "../app.tsx";
import { cents, count, timeAgo } from "../format.ts";
import type { Plan } from "../types.ts";
import { Button, ErrorLine, Field, Icon, Message, Modal, Tabs, useAction, useEvery, useLoad } from "../ui.tsx";
import { PlatformBillingSection } from "./platform-billing.tsx";
import { StudioInvoicesSection } from "./platform-studio-invoices.tsx";
import { PlatformSupport } from "./support.tsx";

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
  platform: { whatsapp: boolean; web_push: boolean; alert_email: boolean; public_base_url: string | null };
};
type Attention = { support_open: number; studio_invoices_open: number; project_requests_new: number; site_chats_waiting: number; studio_business_id: string };
type Subscriptions = { subscriptions: Array<{ business_id: string; plan_id: string; plan_name: string; status: string }> };
type Business = Overview["businesses"][number];

const TABS = ["overview", "businesses", "billing", "invoices", "support"] as const;
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
          { id: "billing", label: "Plans & billing" },
          { id: "invoices", label: "Studio invoices", count: attention.data?.studio_invoices_open },
          { id: "support", label: "Support", count: attention.data?.support_open },
        ]}
      />
      {tab === "overview" ? <OverviewTab attention={attention.data} error={attention.error} /> : null}
      {tab === "businesses" ? <BusinessesTab /> : null}
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
    { n: a?.site_chats_waiting, label: "Site chats waiting", hint: "Visitors on bilamatata.co.ke who asked for a person", action: "Open the inbox", onClick: () => go({ businessId: studio, page: "inbox" }), urgent: true },
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
            <li><Switched on={platform.web_push} /> Alerts on phones {platform.web_push ? null : <span className="muted">(set the WEB_PUSH keys)</span>}</li>
            <li><Switched on={platform.whatsapp} /> WhatsApp {platform.whatsapp ? null : <span className="muted">(set the WHATSAPP keys)</span>}</li>
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const Switched = (props: { on: boolean }) => (props.on
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
        {props.plans.length === 0 ? <p className="muted small">There are no plans yet: add them under Plans &amp; billing.</p> : null}
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

function AddBusiness(props: { plans: Plan[]; onClose: () => void; onAdded: (message: string) => void }) {
  const [form, setForm] = useState({ id: "", name: "", origin: "", type: "general", plan: props.plans[0]?.id ?? "", tier: "starter" as Tier, setup: true, ownerEmail: "", ownerName: "", ownerPassword: "" });
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
              owner: { email: form.ownerEmail, name: form.ownerName, password: form.ownerPassword || undefined },
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
          <Field label="Email"><input type="email" required value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} /></Field>
          <Field label="Name"><input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} /></Field>
        </div>
        <Field label="Starting password (optional)" hint="Only for a new account. Leave it empty and the owner is emailed a link to choose their own."><input type="password" autoComplete="new-password" value={form.ownerPassword} onChange={(event) => setForm({ ...form, ownerPassword: event.target.value })} /></Field>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Add business</Button></div>
      </form>
    </Modal>
  );
}

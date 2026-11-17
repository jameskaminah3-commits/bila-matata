// web/console/pages/performance.tsx
//
// The monthly Business Performance Report (src/reports/performance.ts): who
// got in touch, who paid, the money that is verified and, kept apart, what's
// expected but not confirmed, what customers want, what didn't convert and
// why, what slipped away, the questions asked again and again, and the time
// Zaina saved (an estimate, with its assumptions).

import { api, businessPath } from "../api.ts";
import { count, date } from "../format.ts";
import { ErrorLine, useLoad } from "../ui.tsx";

type Money = { currency: string; minor: number; display: string };
type Counted = { count: number; value: Money[] };
type Report = {
  month: string; from: string; to: string; partial: boolean;
  customers: { contacted: number; identified: number; unidentified: number; new: number; returning: number };
  paying: { customers: number; payments: number; share: number | null };
  revenue: {
    verified: { total: Money[]; byProvider: Money[]; byTeam: Money[]; throughChats: Money[]; fromYourBookings: Money[] };
    expected: { payOnDeliveryDelivered: Counted; dueAtTheProperty: Counted; requestsMarkedWon: number };
  };
  interest: Array<{ name: string; kind: "item" | "room" | "service"; asked: number; bought: number }>;
  notConverted: Array<{ at: string; kind: string; customer: string | null; customerId: string | null; what: string; why: string; value: Money | null }>;
  lost: { lapsedOrders: Counted; lapsedBookings: Counted; declined: Counted; unansweredHandoffs: number; requestsNotFollowedUp: number; unansweredQuestions: number; browsedAndLeft: number };
  questions: Array<{ question: string; chats: number; zainaCouldntAnswer: boolean }>;
  timeSaved: { minutes: number; chatsWithoutTeam: number; bookingsAndOrders: number; automaticUpdates: number; assumptions: { minutesPerChat: number; minutesPerBookingOrOrder: number; minutesPerUpdate: number } };
  lastMonth: { contacted: number; payingCustomers: number; verified: Money[] } | null;
};

const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const amounts = (list: Money[]) => (list.length ? list.map((entry) => entry.display).join(" + ") : "—");
const hours = (minutes: number) => (minutes >= 90 ? `${Math.round(minutes / 6) / 10} hours` : `${minutes} minutes`);
const change = (now: number, before: number | undefined) => (before === undefined ? "" : now === before ? " · same as last month" : ` · ${now > before ? "up" : "down"} from ${before} last month`);

export function PerformanceReport(props: { businessId: string; month: string | null; onMonth: (month: string) => void }) {
  const loaded = useLoad(
    () => api<{ report: Report; months: string[] }>("GET", businessPath(props.businessId, `/performance${props.month ? `?month=${props.month}` : ""}`)),
    [props.businessId, props.month],
  );
  if (!loaded.data) return <ErrorLine error={loaded.error} />;
  const { report: r, months } = loaded.data;
  const link = (page: string) => `#/b/${encodeURIComponent(props.businessId)}/${page}`;
  const lostMoney = [...r.lost.lapsedOrders.value, ...r.lost.lapsedBookings.value, ...r.lost.declined.value];
  return (
    <div className={`report performance${loaded.loading ? " refreshing" : ""}`}>
      <div className="performance-head">
        <label>
          <span className="visually-hidden">Month</span>
          <select value={r.month} onChange={(event) => props.onMonth(event.target.value)}>
            {months.map((month) => <option key={month} value={month}>{monthName(month)}</option>)}
          </select>
        </label>
        <span className="muted small">{r.partial ? `So far, to ${date(r.to)}` : "The whole month"} · emailed to owners and managers on the 1st</span>
      </div>

      <div className="kpis">
        <Figure label="People who got in touch" value={count(r.customers.contacted)} detail={`${r.customers.new} new · ${r.customers.returning} returning${r.customers.unidentified ? ` · ${r.customers.unidentified} chats without contact details` : ""}${change(r.customers.contacted, r.lastMonth?.contacted)}`} />
        <Figure label="Became paying customers" value={count(r.paying.customers)} detail={`${r.paying.share === null ? "No one got in touch" : `${r.paying.share}% of those who got in touch`}${change(r.paying.customers, r.lastMonth?.payingCustomers)}`} tag="verified" />
        <Figure label="Verified revenue" value={amounts(r.revenue.verified.total)} detail={`From settled payments only${r.lastMonth ? ` · last month ${amounts(r.lastMonth.verified)}` : ""}`} tag="verified" />
        <Figure label="Staff time saved" value={hours(r.timeSaved.minutes)} detail="An estimate: see how it's worked out below" tag="estimate" />
      </div>

      <section className="money-split">
        <div className="card stack-tight money verified">
          <h2>Verified <span className="chip ok">money received</span></h2>
          <p className="muted small">Payments that settled this month, into your own accounts.</p>
          <dl className="money-lines">
            <div><dt>Confirmed by Paystack or the M-Pesa prompt</dt><dd>{amounts(r.revenue.verified.byProvider)}</dd></div>
            <div><dt>Recorded by your team (M-Pesa codes checked, cash, bank)</dt><dd>{amounts(r.revenue.verified.byTeam)}</dd></div>
            <div className="total"><dt>Total</dt><dd>{amounts(r.revenue.verified.total)}</dd></div>
            <div><dt>…from bookings and orders made in Zaina's chats</dt><dd>{amounts(r.revenue.verified.throughChats)}</dd></div>
            <div><dt>…from bookings your team made in the dashboard</dt><dd>{amounts(r.revenue.verified.fromYourBookings)}</dd></div>
          </dl>
        </div>
        <div className="card stack-tight money expected">
          <h2>Expected, not verified <span className="chip waiting">not confirmed</span></h2>
          <p className="muted small">Nobody has confirmed this money. It's never added to revenue.</p>
          <dl className="money-lines">
            <div><dt>Pay-on-delivery orders marked delivered ({r.revenue.expected.payOnDeliveryDelivered.count})</dt><dd>{amounts(r.revenue.expected.payOnDeliveryDelivered.value)}</dd></div>
            <div><dt>Balances due at the property ({r.revenue.expected.dueAtTheProperty.count})</dt><dd>{amounts(r.revenue.expected.dueAtTheProperty.value)}</dd></div>
            <div><dt>Requests your team marked "became a customer"</dt><dd>{r.revenue.expected.requestsMarkedWon} (no amount)</dd></div>
          </dl>
        </div>
      </section>
      <p className="muted small">Chats and questions are activity, never revenue: they're counted separately below.</p>

      <section className="card stack-tight">
        <h2>What customers are interested in</h2>
        {r.interest.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Item, room or service</th><th className="number">Chats asking</th><th className="number">Booked or ordered</th></tr></thead>
              <tbody>{r.interest.map((entry) => <tr key={entry.name}><td>{entry.name}</td><td className="number">{entry.asked}</td><td className="number">{entry.bought}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <p className="muted small">Nothing asked about yet this month.</p>}
        <p className="muted small">Many chats asking and few sales can point to the price, stock or how it's described.</p>
      </section>

      <section className="card stack-tight">
        <h2>What slipped away</h2>
        <ul className="plain-list lost-list">
          <li>Not paid in time (orders and bookings): <strong>{r.lost.lapsedOrders.count + r.lost.lapsedBookings.count}</strong> <span className="muted">{amounts(r.lost.lapsedOrders.value.concat(r.lost.lapsedBookings.value))}</span></li>
          <li>Declined by your team: <strong>{r.lost.declined.count}</strong> <span className="muted">{amounts(r.lost.declined.value)}</span></li>
          <li>Handed to your team, never answered: <strong>{r.lost.unansweredHandoffs}</strong></li>
          <li>Requests not followed up after two days: <strong>{r.lost.requestsNotFollowedUp}</strong></li>
          <li>Questions Zaina couldn't answer: <strong>{r.lost.unansweredQuestions}</strong></li>
          <li>Asked about prices or availability, then left without booking, ordering or leaving details: <strong>{r.lost.browsedAndLeft}</strong> <span className="muted">(some may still be deciding)</span></li>
        </ul>
        {lostMoney.length ? <p className="muted small">The amounts are what those customers were about to pay, not money lost for certain.</p> : null}
      </section>

      <section className="card stack-tight">
        <h2>Enquiries that didn't convert</h2>
        {r.notConverted.length ? (
          <ul className="customer-history">
            {r.notConverted.map((entry, index) => (
              <li key={index}>
                <span className="chip">{entry.kind === "request" ? "Request" : entry.kind === "booking" ? "Booking" : "Order"}</span>
                <span>{entry.what}{entry.value ? ` · ${entry.value.display}` : ""}</span>
                <span className="muted small">
                  {entry.customerId ? <a href={link(`customers/${entry.customerId}`)}>{entry.customer ?? "Customer"}</a> : entry.customer ?? "No details"} · {entry.why} · {date(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">None this month.</p>}
      </section>

      <section className="card stack-tight">
        <h2>Asked again and again</h2>
        {r.questions.length ? (
          <ul className="plain-list">
            {r.questions.map((entry) => (
              <li key={entry.question}>
                "{entry.question}" <span className="muted small">{entry.chats} chats</span>
                {entry.zainaCouldntAnswer ? <a className="chip warn" href={link("knowledge")}>Zaina couldn't answer: teach her</a> : null}
              </li>
            ))}
          </ul>
        ) : <p className="muted small">No question came up in more than one chat.</p>}
      </section>

      <section className="card stack-tight">
        <h2>Staff time saved <span className="chip waiting">estimate</span></h2>
        <p><strong>{hours(r.timeSaved.minutes)}</strong> this month, worked out as:</p>
        <ul className="plain-list">
          <li>Chats Zaina handled without your team: {r.timeSaved.chatsWithoutTeam} × {r.timeSaved.assumptions.minutesPerChat} minutes</li>
          <li>Bookings and orders confirmed without your team: {r.timeSaved.bookingsAndOrders} × {r.timeSaved.assumptions.minutesPerBookingOrOrder} minutes</li>
          <li>Updates sent to customers automatically: {r.timeSaved.automaticUpdates} × {r.timeSaved.assumptions.minutesPerUpdate} minute</li>
        </ul>
        <p className="muted small">The minutes are typical times for a person to do the same; yours may differ.</p>
      </section>
    </div>
  );
}

function Figure(props: { label: string; value: string; detail: string; tag?: "verified" | "estimate" }) {
  return (
    <div className="kpi">
      <p className="kpi-label">{props.label}{props.tag ? <span className={`chip ${props.tag === "verified" ? "ok" : "waiting"}`}>{props.tag === "verified" ? "verified" : "estimate"}</span> : null}</p>
      <p className="kpi-value">{props.value}</p>
      <p className="kpi-detail">{props.detail}</p>
    </div>
  );
}

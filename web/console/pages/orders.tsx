// web/console/pages/orders.tsx
//
// Orders Zaina took from the catalogue, by what they need: the team to act
// (accept a request, check an M-Pesa code, sort out a problem), on their way,
// done, cancelled. Each step the team takes here is told to the customer by
// itself, in their chat and by email. And how the business takes orders:
// delivery areas with their fees, collection, the smallest order, paying on
// delivery, who confirms, how long unpaid items are kept.

import { useState } from "react";
import { api, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Message, Tabs, Toggle, useAction, useLoad } from "../ui.tsx";

type Status = "requested" | "awaiting_payment" | "confirmed" | "out_for_delivery" | "ready_for_collection" | "completed" | "cancelled" | "expired";
type Order = {
  id: string; reference: string; status: Status;
  customer: { name: string; phone: string | null; email: string | null; notes: string | null };
  lines: Array<{ item_id: string; name: string; quantity: number; price: string; line_total: string | null }>;
  subtotal: string; delivery_fee: string; total: string; paid: string; paid_minor: number; due: string;
  pay_on_delivery: boolean; priced_by_team: boolean; fulfilment: "delivery" | "collection"; zone: string | null; address: string | null; wanted: string | null;
  hold_expires_at: string | null; conflict: string | null; cancel_reason: string | null; code_to_check: boolean; pay_link: string; session_id: string | null; customer_id: string | null; created_at: string;
};
type Payment = { id: string; method: string; status: string; amount: string; code: string | null };
type Filter = "needs_you" | "active" | "done" | "cancelled" | "settings";
type Settings = {
  delivery: boolean; zones: Array<{ name: string; fee: number | string }>; collection: boolean; collection_point: string | null;
  minimum: number | string; pay_on_delivery: boolean; confirm: "auto" | "team"; hold_minutes: number | string;
};

const STATUS: Record<Status, { text: string; tone: string }> = {
  requested: { text: "Waiting for you", tone: "warn" },
  awaiting_payment: { text: "Waiting for payment", tone: "waiting" },
  confirmed: { text: "Confirmed", tone: "ok" },
  out_for_delivery: { text: "On its way", tone: "team" },
  ready_for_collection: { text: "Ready to collect", tone: "team" },
  completed: { text: "Done", tone: "ok" },
  cancelled: { text: "Cancelled", tone: "" },
  expired: { text: "Not paid in time", tone: "" },
};

const whatsappDigits = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  const full = /^0[17]\d{8}$/.test(digits) ? `254${digits.slice(1)}` : digits;
  return full.length >= 10 && full.length <= 15 ? full : null;
};
const until = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export function OrdersPage(props: { businessId: string; role: Role; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>("needs_you");
  const list = useLoad(
    () => (filter === "settings" ? Promise.resolve(null) : api<{ orders: Order[]; counts: { needs_you: number; active: number } }>("GET", businessPath(props.businessId, `/orders?filter=${filter}`))),
    [props.businessId, filter],
  );
  const action = useAction();
  const act = (order: Order, path: string, body: unknown, done: string) => void action.run(async () => {
    await api("POST", businessPath(props.businessId, path), body);
    await list.reload();
    props.onChanged();
  }, `${order.reference}: ${done}`);
  const counts = list.data?.counts;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Orders</h1>
        <p className="muted">Orders Zaina took from your catalogue. She works out the total with delivery, sends your own payment link and keeps the items for the customer. The customer hears every step you take here by themselves.</p>
      </div>
      <Tabs
        label="Orders"
        active={filter}
        onChange={setFilter}
        tabs={[
          { id: "needs_you", label: "Needs you", count: counts?.needs_you },
          { id: "active", label: "In progress", count: counts?.active },
          { id: "done", label: "Done" },
          { id: "cancelled", label: "Cancelled" },
          ...(atLeast(props.role, "manager") ? [{ id: "settings" as const, label: "Delivery & settings" }] : []),
        ]}
      />
      {filter === "settings" ? <OrderSettings businessId={props.businessId} /> : (
        <>
          <ErrorLine error={list.error} />
          <Message message={action.message} />
          {list.data && list.data.orders.length === 0 ? (
            <Empty title={filter === "needs_you" ? "Nothing needs you" : "No orders here"}>
              <p>{filter === "needs_you" ? "Orders to accept, M-Pesa codes to check and anything to sort out appear here. Paid orders go straight to In progress." : "Orders appear here as they move along."}</p>
            </Empty>
          ) : null}
          <div className="lead-list">
            {list.data?.orders.map((order) => <OrderCard key={order.id} order={order} businessId={props.businessId} busy={action.busy} act={act} />)}
          </div>
        </>
      )}
    </div>
  );
}

function OrderCard(props: { order: Order; businessId: string; busy: boolean; act: (order: Order, path: string, body: unknown, done: string) => void }) {
  const { order, act } = props;
  const [asking, setAsking] = useState<"decline" | "cancel" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [total, setTotal] = useState("");
  const detail = useLoad(
    () => (order.code_to_check ? api<{ payments: Payment[] }>("GET", businessPath(props.businessId, `/orders/${order.id}`)) : Promise.resolve(null)),
    [order.id, order.code_to_check],
  );
  const code = detail.data?.payments.find((payment) => payment.method === "mpesa_code" && payment.status === "pending");
  const whatsapp = order.customer.phone ? whatsappDigits(order.customer.phone) : null;
  const status = STATUS[order.status];
  const live = ["confirmed", "out_for_delivery", "ready_for_collection"].includes(order.status);
  return (
    <article className="card lead">
      <div className="lead-head">
        <div>
          <h2>{order.customer.name} <span className="chip">{order.reference}</span> <span className={`chip ${status.tone}`}>{status.text}</span></h2>
          <p className="muted small">{timeAgo(order.created_at)}{order.wanted ? ` · wanted ${order.wanted}` : ""}</p>
        </div>
      </div>
      {order.conflict ? <p className="message error">{order.conflict}</p> : null}
      <div className="order-lines">
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Item</th><th className="number">Qty</th><th>Price</th><th className="number">Total</th></tr></thead>
            <tbody>
              {order.lines.map((line) => <tr key={line.item_id}><td>{line.name}</td><td className="number">{line.quantity}</td><td>{line.price}</td><td className="number">{line.line_total ?? "—"}</td></tr>)}
              {order.fulfilment === "delivery" ? <tr><td colSpan={3}>Delivery to {order.zone}</td><td className="number">{order.delivery_fee}</td></tr> : null}
            </tbody>
            <tfoot><tr><th colSpan={3}>Total{order.pay_on_delivery ? ", paid on delivery or collection" : ""}</th><th className="number">{order.priced_by_team && order.status === "requested" ? "You set it" : order.total}</th></tr></tfoot>
          </table>
        </div>
        <p className="small">
          {order.fulfilment === "delivery" ? <><strong>Deliver to:</strong> {[order.address, order.zone].filter(Boolean).join(", ")}</> : <strong>They'll collect it</strong>}
          {order.paid_minor > 0 ? <> · <strong>Paid:</strong> {order.paid}</> : null}
        </p>
        {order.customer.notes ? <p className="muted small">{order.customer.notes}</p> : null}
      </div>
      <div className="lead-contact">
        {order.customer.phone ? <a className="button secondary small" href={`tel:${order.customer.phone.replace(/[^\d+]/g, "")}`}>Call {order.customer.phone}</a> : null}
        {whatsapp ? <a className="button secondary small" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
        {order.session_id ? <a className="button ghost small" href={`#/b/${encodeURIComponent(props.businessId)}/inbox/${order.session_id}`}>Open the chat</a> : null}
        {order.customer_id ? <a className="button ghost small" href={`#/b/${encodeURIComponent(props.businessId)}/customers/${order.customer_id}`}>Customer history</a> : null}
      </div>

      {code ? (
        <div className="stack-tight">
          <p><strong>M-Pesa code {code.code}</strong> for {code.amount}. Check it in your M-Pesa statement.</p>
          <div className="actions start">
            <Button small kind="primary" busy={props.busy} onClick={() => act(order, `/order-payments/${code.id}/confirm`, {}, "payment confirmed; the customer has been told.")}>It's there: confirm</Button>
            <Button small onClick={() => setAsking("reject")}>Not found</Button>
          </div>
        </div>
      ) : null}
      {order.status === "requested" ? (
        <div className="stack-tight">
          {order.priced_by_team ? <Field label="Total, delivery included" hint="A price on this order is a range: set what it comes to."><input inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} placeholder="5170" /></Field> : null}
          <div className="actions start">
            <Button small kind="primary" busy={props.busy} disabled={order.priced_by_team && !total.trim()} onClick={() => act(order, `/orders/${order.id}/accept`, order.priced_by_team ? { total } : {}, "accepted; the customer has been told.")}>Accept</Button>
            <Button small onClick={() => setAsking("decline")}>Decline</Button>
          </div>
        </div>
      ) : null}
      {order.status === "awaiting_payment" && order.hold_expires_at ? <p className="muted small">Items kept until {until(order.hold_expires_at)} for the customer to pay.</p> : null}
      {live ? (
        <div className="actions start">
          {order.status === "confirmed" && order.fulfilment === "delivery" ? <Button small kind="primary" busy={props.busy} onClick={() => act(order, `/orders/${order.id}/status`, { to: "out_for_delivery" }, "on its way; the customer has been told.")}>Out for delivery</Button> : null}
          {order.status === "confirmed" && order.fulfilment === "collection" ? <Button small kind="primary" busy={props.busy} onClick={() => act(order, `/orders/${order.id}/status`, { to: "ready_for_collection" }, "ready; the customer has been told.")}>Ready to collect</Button> : null}
          <Button small kind={order.status === "confirmed" ? "secondary" : "primary"} busy={props.busy} onClick={() => act(order, `/orders/${order.id}/status`, { to: "completed" }, "done.")}>{order.fulfilment === "delivery" ? "Delivered" : "Collected"}</Button>
        </div>
      ) : null}
      {(order.status === "awaiting_payment" || live) && asking === null ? <p className="small"><button type="button" className="link" onClick={() => setAsking("cancel")}>Cancel this order</button></p> : null}
      {order.cancel_reason && order.status === "cancelled" ? <p className="muted small">Reason: {order.cancel_reason}</p> : null}

      {asking ? (
        <form
          className="stack-tight"
          onSubmit={(event) => {
            event.preventDefault();
            const body = { reason: reason.trim() || undefined };
            if (asking === "reject" && code) act(order, `/order-payments/${code.id}/reject`, body, "the customer has been asked to pay again.");
            else act(order, `/orders/${order.id}/${asking}`, body, asking === "decline" ? "declined; the customer has been told." : "cancelled; the customer has been told.");
            setAsking(null);
            setReason("");
          }}
        >
          <Field label={asking === "reject" ? "What to tell the customer (optional)" : "Reason, told to the customer (optional)"}>
            <input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder={asking === "reject" ? "The amount didn't match" : "We're out of tomatoes today"} />
          </Field>
          <div className="actions start">
            <Button small onClick={() => setAsking(null)}>Back</Button>
            <Button small kind="danger" type="submit">{asking === "reject" ? "Not found" : asking === "decline" ? "Decline the order" : "Cancel the order"}</Button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

function OrderSettings(props: { businessId: string }) {
  const loaded = useLoad(() => api<Settings>("GET", businessPath(props.businessId, "/order-settings")), [props.businessId]);
  const [form, setForm] = useState<Settings | null>(null);
  const action = useAction();
  const value = form ?? loaded.data;
  if (!value) return <ErrorLine error={loaded.error} />;
  const set = <K extends keyof Settings>(key: K, next: Settings[K]) => setForm({ ...value, [key]: next });
  const zone = (index: number, patch: Partial<Settings["zones"][number]>) => set("zones", value.zones.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          setForm(await api<Settings>("PUT", businessPath(props.businessId, "/order-settings"), { ...value, zones: value.zones.filter((entry) => entry.name.trim()) }));
        }, "Saved. Zaina uses these from her next message.");
      }}
    >
      <Message message={action.message} />
      <Toggle checked={value.delivery} onChange={(next) => set("delivery", next)} label="We deliver" />
      {value.delivery ? (
        <div className="stack-tight">
          <p className="small"><strong>Where you deliver, and the fee for each area</strong> (0 for free). Zaina adds the fee to the order; anywhere else isn't offered delivery.</p>
          {value.zones.map((entry, index) => (
            <div className="form-row repeat" key={index}>
              <Field label="Area"><input value={entry.name} maxLength={80} onChange={(event) => zone(index, { name: event.target.value })} placeholder="Westlands" /></Field>
              <Field label="Fee (KSh)"><input inputMode="decimal" value={entry.fee} onChange={(event) => zone(index, { fee: event.target.value })} placeholder="200" /></Field>
              <Button small kind="ghost" onClick={() => set("zones", value.zones.filter((_, at) => at !== index))}>Remove</Button>
            </div>
          ))}
          <div className="actions start"><Button small onClick={() => set("zones", [...value.zones, { name: "", fee: "" }])}>Add an area</Button></div>
        </div>
      ) : null}
      <Toggle checked={value.collection} onChange={(next) => set("collection", next)} label="Customers can collect" />
      {value.collection ? <Field label="Where they collect"><input value={value.collection_point ?? ""} maxLength={200} onChange={(event) => set("collection_point", event.target.value)} placeholder="Stall 7, Kawangware market" /></Field> : null}
      <Toggle checked={value.pay_on_delivery} onChange={(next) => set("pay_on_delivery", next)} label="Customers may pay on delivery or collection" />
      <div className="form-grid">
        <Field label="Smallest order (KSh)" hint="Before delivery. 0 for none."><input inputMode="decimal" value={value.minimum} onChange={(event) => set("minimum", event.target.value)} /></Field>
        <Field label="Keep unpaid items for (minutes)" hint="Then the order lapses and the items go back."><input type="number" min={10} max={1440} value={value.hold_minutes} onChange={(event) => set("hold_minutes", event.target.value)} /></Field>
        <Field label="Confirming orders">
          <select value={value.confirm} onChange={(event) => set("confirm", event.target.value as Settings["confirm"])}>
            <option value="auto">Confirmed once paid (or to be paid on delivery)</option>
            <option value="team">We accept each order first</option>
          </select>
        </Field>
      </div>
      <p className="muted small">Customers pay into your own accounts, the ones connected in <a href={`#/b/${encodeURIComponent(props.businessId)}/settings/payments`}>Settings</a>. Zaina never takes payment.</p>
      <div className="actions start"><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
    </form>
  );
}

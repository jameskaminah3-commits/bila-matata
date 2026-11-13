// web/console/pages/platform-studio-invoices.tsx
//
// The studio's own invoices, for the platform's admins: project work
// (websites and apps, automation, data, research) and Zaina set-up fees.
// Each invoice has a link the client pays on (/pay/BM-…, M-Pesa or card
// through the studio's Paystack account); one paid by hand is marked paid
// here with its receipt.

import { useState } from "react";
import { api } from "../api.ts";
import { cents, date } from "../format.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, useAction, useLoad } from "../ui.tsx";

type StudioInvoice = {
  id: string;
  reference: string;
  client_name: string;
  client_email: string | null;
  description: string;
  category: string;
  category_label: string;
  amount_minor: number;
  currency: "KES" | "USD";
  status: "open" | "paid" | "void";
  due_at: string | null;
  paid_at: string | null;
  method: "paystack" | "manual" | null;
  receipt: string | null;
  notes: string | null;
  created_at: string;
  attention: string | null;
  pay_url: string | null;
};

type StudioInvoices = {
  invoices: StudioInvoice[];
  categories: Array<{ id: string; label: string }>;
  online_payments: "off" | "test" | "live";
  can_email: boolean;
};

const ONLINE = { off: "off (PLATFORM_PAYSTACK_SECRET_KEY)", test: "in test mode (no money moves)", live: "on" };

export function StudioInvoicesSection() {
  const loaded = useLoad(() => api<StudioInvoices>("GET", "/v1/platform/studio-invoices"), []);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<StudioInvoice | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const action = useAction();
  const data = loaded.data;
  const copy = async (invoice: StudioInvoice) => {
    if (!invoice.pay_url) return;
    try {
      await navigator.clipboard.writeText(invoice.pay_url);
      setCopied(invoice.id);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy the payment link:", invoice.pay_url);
    }
  };
  return (
    <section className="stack">
      <div className="page-head">
        <h2>Studio invoices</h2>
        {data ? <p className="muted">Projects and Zaina set-up fees, paid on /pay · Paying online is {ONLINE[data.online_payments]}</p> : null}
      </div>
      <ErrorLine error={loaded.error} />
      <Message message={action.message} />
      <div className="stack-tight">
        <div className="room-head">
          <h3>Invoices</h3>
          <Button small kind="primary" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> New invoice</Button>
        </div>
        {data?.invoices.length ? (
          <table className="table">
            <thead><tr><th>Invoice</th><th>Client</th><th>For</th><th className="number">Amount</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td><span className="nowrap"><strong>{invoice.reference}</strong></span><div className="small muted">{date(invoice.created_at)}</div></td>
                  <td>{invoice.client_name}{invoice.client_email ? <div className="small muted">{invoice.client_email}</div> : null}</td>
                  <td>{invoice.category_label}<div className="small muted">{invoice.description}</div></td>
                  <td className="number">{cents(invoice.amount_minor, invoice.currency)}</td>
                  <td>
                    {invoice.status === "paid" ? <span className="chip ok">Paid</span> : invoice.status === "void" ? <span className="chip">Void</span> : <span className="chip">Open</span>}
                    {invoice.status === "paid" ? <div className="small muted">{date(invoice.paid_at)} · {invoice.method === "paystack" ? "Paystack" : "by hand"}{invoice.receipt ? ` · ${invoice.receipt}` : ""}</div> : null}
                    {invoice.status === "open" && invoice.due_at ? <div className="small muted">Due {date(invoice.due_at)}</div> : null}
                    {invoice.attention ? <span className="status critical"><Icon name="alert" size={13} />{invoice.attention}</span> : null}
                  </td>
                  <td className="row-actions">
                    {invoice.status === "open" ? (
                      <>
                        {invoice.pay_url ? <><Button small onClick={() => void copy(invoice)}>{copied === invoice.id ? "Copied" : "Copy link"}</Button>{" "}</> : null}
                        <Button small onClick={() => setPaying(invoice)}>Mark paid</Button>{" "}
                        <Button small kind="ghost" busy={action.busy} onClick={() => {
                          if (!window.confirm(`Void ${invoice.reference}? Its link will say there is nothing to pay.`)) return;
                          void action.run(async () => { await api("POST", `/v1/platform/studio-invoices/${invoice.id}/void`); await loaded.reload(); }, `${invoice.reference} is void.`);
                        }}>Void</Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : data ? <Empty title="No invoices yet">Create one for a project deposit, a balance or a Zaina set-up fee, and send the client its link.</Empty> : null}
      </div>
      {adding && data ? <NewInvoice categories={data.categories} canEmail={data.can_email} onClose={() => setAdding(false)} onSaved={async (text) => { setAdding(false); action.setMessage({ kind: "success", text }); await loaded.reload(); }} /> : null}
      {paying ? <MarkPaid invoice={paying} onClose={() => setPaying(null)} onSaved={async (text) => { setPaying(null); action.setMessage({ kind: "success", text }); await loaded.reload(); }} /> : null}
    </section>
  );
}

function NewInvoice(props: { categories: StudioInvoices["categories"]; canEmail: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState({ client: "", email: "", description: "", category: props.categories[0]?.id ?? "software", amount: "", currency: "KES", due: "", notes: "", send: false });
  const action = useAction();
  const set = (key: keyof typeof form, value: string | boolean) => setForm({ ...form, [key]: value });
  return (
    <Modal title="New invoice" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const amount = Number(form.amount.replace(/,/g, "").trim());
          if (!Number.isFinite(amount) || amount <= 0) {
            action.setMessage({ kind: "error", text: "The amount is a number like 25000." });
            return;
          }
          await action.run(async () => {
            const result = await api<{ invoice: StudioInvoice; emailed: boolean }>("POST", "/v1/platform/studio-invoices", {
              client_name: form.client,
              client_email: form.email.trim() || undefined,
              description: form.description,
              category: form.category,
              amount,
              currency: form.currency,
              due_on: form.due || undefined,
              notes: form.notes.trim() || undefined,
              email_client: form.send && Boolean(form.email.trim()),
            });
            props.onSaved(`${result.invoice.reference} is ready${result.emailed ? " and its link was emailed to the client" : ""}. Copy its link to send it.`);
          });
        }}
      >
        <div className="form-row">
          <Field label="Client"><input required maxLength={120} value={form.client} onChange={(event) => set("client", event.target.value)} /></Field>
          <Field label="Client's email" hint="Optional: for the receipt."><input type="email" maxLength={200} value={form.email} onChange={(event) => set("email", event.target.value)} /></Field>
        </div>
        <div className="form-row">
          <Field label="Service">
            <select value={form.category} onChange={(event) => set("category", event.target.value)}>
              {props.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
          </Field>
          <Field label="Due" hint="Optional."><input type="date" value={form.due} onChange={(event) => set("due", event.target.value)} /></Field>
        </div>
        <Field label="What it's for" hint="The client reads this on the payment page and on Paystack's receipt. Say plainly what was sold: for example “50% deposit: company website, 6 pages”."><input required minLength={3} maxLength={300} value={form.description} onChange={(event) => set("description", event.target.value)} /></Field>
        <div className="form-row">
          <Field label="Amount"><input required inputMode="decimal" value={form.amount} onChange={(event) => set("amount", event.target.value)} /></Field>
          <Field label="Currency">
            <select value={form.currency} onChange={(event) => set("currency", event.target.value)}><option value="KES">Kenya shillings</option><option value="USD">US dollars</option></select>
          </Field>
        </div>
        <Field label="Notes" hint="Only your team sees these."><textarea rows={2} maxLength={1000} value={form.notes} onChange={(event) => set("notes", event.target.value)} /></Field>
        {props.canEmail ? <label className="check"><input type="checkbox" checked={form.send} onChange={(event) => set("send", event.target.checked)} /><span>Email the payment link to the client</span></label> : null}
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Create invoice</Button></div>
      </form>
    </Modal>
  );
}

function MarkPaid(props: { invoice: StudioInvoice; onClose: () => void; onSaved: (message: string) => void }) {
  const [receipt, setReceipt] = useState("");
  const action = useAction();
  const invoice = props.invoice;
  return (
    <Modal title={`Mark ${invoice.reference} paid`} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          await action.run(async () => {
            await api("POST", `/v1/platform/studio-invoices/${invoice.id}/paid`, { receipt });
            props.onSaved(`${invoice.reference} is paid.`);
          });
        }}
      >
        <p>{invoice.client_name} paid {cents(invoice.amount_minor, invoice.currency)} by hand (bank or M-Pesa). Check the money has arrived first.</p>
        <Field label="Receipt or reference" hint="The M-Pesa code or bank reference, as it shows in your statement."><input required minLength={3} maxLength={120} value={receipt} onChange={(event) => setReceipt(event.target.value)} /></Field>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Mark paid</Button></div>
      </form>
    </Modal>
  );
}

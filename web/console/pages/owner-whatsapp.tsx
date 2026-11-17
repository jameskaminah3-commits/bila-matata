// web/console/pages/owner-whatsapp.tsx
//
// Settings → Manage from WhatsApp: link your own WhatsApp number, then run
// the business by writing to its number ("Change the price of chicken to
// 450", "How many orders today?"). Zaina prepares each change and shows what
// it affects; nothing changes until you reply YES. The log below shows every
// change made this way, and who decided it.

import { api, businessPath } from "../api.ts";
import { timeAgo } from "../format.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, ErrorLine, Message, useAction, useEvery, useLoad } from "../ui.tsx";

type Mine = { linked_number: string | null; code: string | null; code_expires_at: string | null; business_number: string | null; whatsapp_connected: boolean };
type Change = { id: string; kind: string; summary: string; status: "pending" | "applied" | "cancelled" | "expired" | "failed"; result: string | null; created_at: string; by: string };

const STATUS: Record<Change["status"], { text: string; tone: string }> = {
  pending: { text: "Waiting for YES", tone: "waiting" }, applied: { text: "Applied", tone: "ok" }, cancelled: { text: "Cancelled", tone: "" },
  expired: { text: "Expired", tone: "" }, failed: { text: "Not applied", tone: "warn" },
};

export function OwnerWhatsapp(props: { businessId: string; role: Role }) {
  const mine = useLoad(() => api<Mine>("GET", businessPath(props.businessId, "/my-whatsapp")), [props.businessId]);
  const changes = useLoad(() => (atLeast(props.role, "manager") ? api<{ changes: Change[] }>("GET", businessPath(props.businessId, "/owner-changes")) : Promise.resolve({ changes: [] })), [props.businessId, props.role]);
  const action = useAction();
  // While a code waits, check for the link every few seconds.
  useEvery(() => { if (mine.data?.code && !mine.data.linked_number) void mine.reload(); }, 4000, [mine.data?.code, mine.data?.linked_number]);
  // Changes made from the phone show up here while the page is open.
  useEvery(() => { if (mine.data?.linked_number && atLeast(props.role, "manager")) void changes.reload(); }, 10_000, [mine.data?.linked_number, props.role]);
  const data = mine.data;
  if (!data) return <ErrorLine error={mine.error} />;
  return (
    <div className="stack">
      <section className="card stack-tight">
        <h2>Manage from WhatsApp</h2>
        <p>Run the business by writing to its WhatsApp number from your own phone, like a message to a trusted assistant:</p>
        <ul className="plain-list owner-examples">
          <li>"Change the price of chicken to 450"</li>
          <li>"We're fully booked tomorrow"</li>
          <li>"Add a new service: kids' haircut, 300"</li>
          <li>"We no longer deliver to Kilimani"</li>
          <li>"How many orders did we get today?"</li>
        </ul>
        <p className="muted small">Zaina prepares each change and shows exactly what it will affect. <strong>Nothing changes until you reply YES.</strong> Only managers and owners can make changes.</p>
        <Message message={action.message} />
        {!data.whatsapp_connected ? <p className="message error">Connect the business's WhatsApp number first (Settings → WhatsApp).</p>
          : data.linked_number ? (
            <div className="stack-tight">
              <p>Your number <strong>{data.linked_number}</strong> is linked. Write to {data.business_number ?? "the business's WhatsApp number"} to manage the business.</p>
              <div className="actions start"><Button small busy={action.busy} onClick={() => void action.run(async () => { await api("DELETE", businessPath(props.businessId, "/my-whatsapp")); await mine.reload(); }, "Unlinked.")}>Unlink my number</Button></div>
            </div>
          ) : data.code ? (
            <div className="stack-tight">
              <p>From <strong>your own WhatsApp</strong>, send this message to {data.business_number ?? "the business's WhatsApp number"}:</p>
              <p className="link-code">LINK {data.code}</p>
              <p className="muted small">The code works once, for 15 minutes. This page updates when it's linked.</p>
            </div>
          ) : (
            <div className="actions start"><Button kind="primary" busy={action.busy} onClick={() => void action.run(async () => { await api("POST", businessPath(props.businessId, "/my-whatsapp")); await mine.reload(); })}>Link my WhatsApp number</Button></div>
          )}
      </section>

      {atLeast(props.role, "manager") ? (
        <section className="card stack-tight">
          <h2>Changes made from WhatsApp</h2>
          {changes.data?.changes.length ? (
            <ul className="customer-history">
              {changes.data.changes.map((change) => (
                <li key={change.id}>
                  <span className={`chip ${STATUS[change.status].tone}`}>{STATUS[change.status].text}</span>
                  <span className="pre-line">{change.summary.split("\n")[0]}</span>
                  <span className="muted small">{change.by} · {timeAgo(change.created_at)}{change.result && change.status !== "applied" ? ` · ${change.result}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">None yet.</p>}
        </section>
      ) : null}
    </div>
  );
}

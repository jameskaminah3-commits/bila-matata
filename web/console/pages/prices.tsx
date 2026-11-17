// web/console/pages/prices.tsx
//
// The price list: what the business charges for things that aren't booked
// here (services, extras, products), by section. Zaina quotes these exactly
// and never takes a price from documents. Items can be added one at a time,
// or pasted as the business has them and checked before they're added, or
// come from the business's own system (a product feed, read every day).
// Each item says whether it's in stock: Zaina won't take an order for one
// that's out.

import { useState } from "react";
import { api, apiUpload, businessPath } from "../api.ts";
import { shrinkPhoto } from "../photo.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, useAction, useLoad } from "../ui.tsx";
import { timeAgo } from "../format.ts";

type PriceItem = {
  id: string; section: string | null; name: string; description: string | null; price: number; price_max: number | null;
  currency: "KES" | "USD"; unit: string | null; status: "active" | "hidden"; sort_order: number; price_display: string;
  available: boolean; stock: number | null; source: "manual" | "feed"; url: string | null; image_url: string | null; picture_url: string | null;
};
type Feed = { url: string; daily: boolean; last_read_at: string | null; last_items: number; last_skipped: number; last_error: string | null };
type Parsed = { items: Array<{ section: string | null; name: string; price: string; price_max: string | null; currency: "KES" | "USD"; unit: string | null }>; problems: Array<{ line: number; text: string; reason: string }> };

export function PricesPage(props: { businessId: string; role: Role; businessType: string | null }) {
  const list = useLoad(() => api<{ items: PriceItem[] }>("GET", businessPath(props.businessId, "/price-list")), [props.businessId]);
  const [editing, setEditing] = useState<PriceItem | "new" | null>(null);
  const [pasting, setPasting] = useState<"text" | "photo" | null>(null);
  const action = useAction();
  const manager = atLeast(props.role, "manager");
  const items = list.data?.items ?? [];
  const sections = [...new Set(items.map((item) => item.section ?? ""))];
  const booked = props.businessType === "guesthouse" ? "rooms" : props.businessType === "salon" || props.businessType === "restaurant" ? "services" : null;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Catalogue &amp; prices</h1>
        <p className="muted">
          What you sell and charge for {booked ? `that isn't ${booked} booked here: extras, transfers, meals, products` : "that customers ask about: your products, services and packages"}.
          Zaina quotes these exactly, says what's out of stock, and never takes a price from your documents.
        </p>
      </div>
      {manager ? (
        <div className="toolbar">
          <Button kind="primary" onClick={() => setEditing("new")}><Icon name="plus" size={15} /> Add an item</Button>
          <Button onClick={() => setPasting("photo")}>Snap your price list</Button>
          <Button kind="ghost" onClick={() => setPasting("text")}>Paste a list</Button>
        </div>
      ) : null}
      {manager ? <FeedCard businessId={props.businessId} onChanged={() => void list.reload()} /> : null}
      <ErrorLine error={list.error} />
      <Message message={action.message} />
      {list.data && items.length === 0 ? (
        <Empty title="Nothing here yet">
          <p>Add what you sell with a photo and a price, or take a photo of your price board or menu and Zaina reads it for you. Until then, Zaina says she isn't sure of a price and offers the team.</p>
        </Empty>
      ) : null}
      {sections.map((section) => (
        <section key={section || "none"} className="stack-tight">
          {section ? <h2 className="section-title">{section}</h2> : null}
          <table className="table">
            <thead><tr><th>Item</th><th>Price</th>{manager ? <th><span className="visually-hidden">Actions</span></th> : null}</tr></thead>
            <tbody>
              {items.filter((item) => (item.section ?? "") === section).map((item) => (
                <tr key={item.id}>
                  <td className="item-cell">
                    {item.picture_url ? <img className="item-thumb" src={item.picture_url} alt="" loading="lazy" /> : null}
                    <strong>{item.name}</strong>
                    {item.status === "hidden" ? <span className="chip closed">Hidden</span> : null}
                    {item.source === "feed" ? <span className="chip">From your system</span> : null}
                    {item.description ? <div className="muted small">{item.description}</div> : null}
                  </td>
                  <td className="nowrap">
                    {item.price_display}
                    <div>
                      {manager ? (
                        <button type="button" className={`chip stock-toggle${item.available ? " ok" : " waiting"}`} aria-pressed={item.available} disabled={action.busy}
                          onClick={() => void action.run(async () => { await api("PATCH", businessPath(props.businessId, `/price-list/${item.id}`), { available: !item.available }); await list.reload(); }, `"${item.name}" is ${item.available ? "out of stock" : "in stock"}.`)}>
                          {item.available ? (item.stock !== null ? `${item.stock} left` : "In stock") : "Out of stock"}
                        </button>
                      ) : <span className={`chip${item.available ? " ok" : " waiting"}`}>{item.available ? "In stock" : "Out of stock"}</span>}
                    </div>
                  </td>
                  {manager ? (
                    <td className="row-actions">
                      <Button small onClick={() => setEditing(item)}>Edit</Button>
                      <Button small kind="ghost" onClick={() => {
                        if (!window.confirm(item.source === "feed" ? `Delete "${item.name}"? It comes back the next time your system's feed is read, if it's still there: hide it instead to keep it out.` : `Delete "${item.name}"? Zaina stops quoting it at once.`)) return;
                        void action.run(async () => {
                          await api("DELETE", businessPath(props.businessId, `/price-list/${item.id}`));
                          await list.reload();
                        }, `Deleted "${item.name}".`);
                      }}>Delete</Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {editing ? (
        <ItemEditor
          businessId={props.businessId}
          item={editing === "new" ? null : editing}
          sections={sections.filter(Boolean)}
          onClose={() => setEditing(null)}
          onSaved={async (text) => {
            setEditing(null);
            action.setMessage({ kind: "success", text });
            await list.reload();
          }}
        />
      ) : null}
      {pasting ? (
        <PasteList
          businessId={props.businessId}
          hasItems={items.length > 0}
          photo={pasting === "photo"}
          onClose={() => setPasting(null)}
          onAdded={async (text) => {
            setPasting(null);
            action.setMessage({ kind: "success", text });
            await list.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ItemEditor(props: { businessId: string; item: PriceItem | null; sections: string[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState({
    section: props.item?.section ?? "",
    name: props.item?.name ?? "",
    description: props.item?.description ?? "",
    price: props.item ? String(props.item.price) : "",
    price_max: props.item?.price_max === null || props.item?.price_max === undefined ? "" : String(props.item.price_max),
    currency: props.item?.currency ?? "KES",
    unit: props.item?.unit ?? "",
    status: props.item?.status ?? "active",
    image_url: props.item?.image_url ?? "",
    stock: props.item?.stock === null || props.item?.stock === undefined ? "" : String(props.item.stock),
  });
  const [available, setAvailable] = useState(props.item?.available ?? true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(props.item?.picture_url ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  const action = useAction();
  const more = Boolean(props.item && (props.item.section || props.item.description || props.item.unit || props.item.price_max !== null || props.item.status === "hidden" || props.item.currency !== "KES"));
  return (
    <Modal title={props.item ? `Edit "${props.item.name}"` : "Add an item"} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          const body = { ...form, available, section: form.section.trim() || null, description: form.description.trim() || null, unit: form.unit.trim() || null, price_max: form.price_max.trim() || null, image_url: form.image_url.trim() || null, stock: form.stock.trim() === "" ? null : Number(form.stock) };
          await action.run(async () => {
            let saved = await api<{ item: PriceItem }>(props.item ? "PATCH" : "POST", businessPath(props.businessId, props.item ? `/price-list/${props.item.id}` : "/price-list"), body);
            // The photo is kept in the database once the item exists.
            if (photo) saved = await apiUpload<{ item: PriceItem }>("PUT", businessPath(props.businessId, `/price-list/${saved.item.id}/picture`), await shrinkPhoto(photo));
            else if (removePhoto && props.item?.picture_url) saved = await api<{ item: PriceItem }>("DELETE", businessPath(props.businessId, `/price-list/${saved.item.id}/picture`));
            props.onSaved(`Saved "${saved.item.name}": ${saved.item.price_display}.`);
          });
        }}
      >
        <div className="photo-pick">
          {preview && !removePhoto ? <img className="photo-preview" src={preview} alt="" /> : <div className="photo-preview empty" aria-hidden="true"><Icon name="image" size={28} /></div>}
          <div className="stack-tight">
            <label className="button secondary">
              {preview && !removePhoto ? "Change the photo" : "Add a photo"}
              <input className="visually-hidden" type="file" accept="image/*" onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setPhoto(file);
                setRemovePhoto(false);
                setPreview(URL.createObjectURL(file));
              }} />
            </label>
            {preview && !removePhoto ? <Button small kind="ghost" onClick={() => { setPhoto(null); setRemovePhoto(true); }}>Remove the photo</Button> : null}
            <span className="muted small">Customers who ask to see it get this photo.</span>
          </div>
        </div>
        <Field label="Name"><input required maxLength={120} value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Sukuma wiki, Box braids, Cooking oil 20L" /></Field>
        <div className="form-row">
          <Field label={`Price (${form.currency === "USD" ? "US$" : "KSh"})`} hint="0 for free."><input required inputMode="decimal" value={form.price} onChange={(event) => set("price", event.target.value)} placeholder="350" /></Field>
          <Field label="Per (optional)"><input maxLength={40} value={form.unit} onChange={(event) => set("unit", event.target.value)} placeholder="per bunch, per kg, per head" /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} /><span>In stock (Zaina takes orders for it)</span></label>
        <Field label="How many are left (optional)" hint="Each order takes from it and an unpaid one gives it back; at 0 Zaina says it's out. Leave empty to not count."><input type="number" min={0} max={1000000} inputMode="numeric" value={form.stock} onChange={(event) => set("stock", event.target.value)} placeholder="50" /></Field>
        <details className="more-details" open={more}>
          <summary>More details (optional)</summary>
          <div className="form-row">
            <Field label="Section"><input maxLength={80} list="price-sections" value={form.section} onChange={(event) => set("section", event.target.value)} placeholder="Vegetables, Hair, Oils" /></Field>
            <datalist id="price-sections">{props.sections.map((section) => <option key={section} value={section} />)}</datalist>
            <Field label="Up to" hint="For a range: the most it costs."><input inputMode="decimal" value={form.price_max} onChange={(event) => set("price_max", event.target.value)} /></Field>
            <Field label="Currency">
              <select value={form.currency} onChange={(event) => set("currency", event.target.value)}>
                <option value="KES">KSh</option>
                <option value="USD">US$</option>
              </select>
            </Field>
          </div>
          <Field label="What it includes" wide><textarea rows={2} maxLength={500} value={form.description} onChange={(event) => set("description", event.target.value)} /></Field>
          <div className="form-row">
            <Field label="Show it to customers">
              <select value={form.status} onChange={(event) => set("status", event.target.value)}>
                <option value="active">Yes (Zaina quotes it)</option>
                <option value="hidden">No, hide it</option>
              </select>
            </Field>
            <Field label="Or a picture's link" hint="If the photo is already online."><input type="url" inputMode="url" value={form.image_url} onChange={(event) => set("image_url", event.target.value)} placeholder="https://" /></Field>
          </div>
        </details>
        <Message message={action.message} />
        <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Save</Button></div>
      </form>
    </Modal>
  );
}

/** A pasted item's price as it will read: "KSh 5,500 per person", "Free". */
function previewPrice(item: Parsed["items"][number]): string {
  const amount = (value: string) => Number(value).toLocaleString("en-US");
  const text = Number(item.price) === 0 && !item.price_max
    ? "Free"
    : `${item.currency === "USD" ? "$" : "KSh "}${amount(item.price)}${item.price_max ? `–${amount(item.price_max)}` : ""}`;
  return item.unit ? `${text} ${item.unit}` : text;
}

function PasteList(props: { businessId: string; hasItems: boolean; photo?: boolean; onClose: () => void; onAdded: (message: string) => void }) {
  const [text, setText] = useState("");
  const [picture, setPicture] = useState<File | null>(null);
  const [currency, setCurrency] = useState<"KES" | "USD">("KES");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [replace, setReplace] = useState(false);
  const action = useAction();
  return (
    <Modal title={props.photo ? "Snap your price list" : "Paste your price list"} onClose={props.onClose}>
      {!parsed && props.photo ? (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!picture) return;
            await action.run(async () => setParsed(await apiUpload<Parsed>("POST", businessPath(props.businessId, `/price-list/read-photo?currency=${currency}`), await shrinkPhoto(picture, { maxSide: 2000, maxBytes: 2 * 1024 * 1024 }))));
          }}
        >
          <p className="muted">Take a clear photo of your price board, menu or a written list. Zaina reads the items and prices; you check them before anything is added.</p>
          <label className="button secondary photo-button">
            {picture ? "Take another photo" : "Take or choose a photo"}
            <input className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => setPicture(event.target.files?.[0] ?? null)} />
          </label>
          {picture ? <img className="photo-preview wide" src={URL.createObjectURL(picture)} alt="Your price list" /> : null}
          <Field label="Prices with no currency are in">
            <select value={currency} onChange={(event) => setCurrency(event.target.value as "KES" | "USD")}>
              <option value="KES">Kenya shillings (KSh)</option>
              <option value="USD">US dollars</option>
            </select>
          </Field>
          <Message message={action.message} />
          <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy} disabled={!picture}>Read the photo</Button></div>
        </form>
      ) : !parsed ? (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            await action.run(async () => setParsed(await api<Parsed>("POST", businessPath(props.businessId, "/price-list/parse"), { text, currency })));
          }}
        >
          <p className="muted">One item per line with its price, as you have it: "Airport transfer — KSh 3,500 per car", "Laundry: 200 per item", "Massage 60 min ... 4,500", "Kids under 5: free". A line without a price starts a section.</p>
          <Field label="Your price list" wide><textarea required rows={12} value={text} onChange={(event) => setText(event.target.value)} /></Field>
          <Field label="Prices with no currency are in">
            <select value={currency} onChange={(event) => setCurrency(event.target.value as "KES" | "USD")}>
              <option value="KES">Kenya shillings (KSh)</option>
              <option value="USD">US dollars</option>
            </select>
          </Field>
          <Message message={action.message} />
          <div className="actions"><Button onClick={props.onClose}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Read the list</Button></div>
        </form>
      ) : (
        <div className="stack-tight">
          <p>{parsed.items.length ? `Found ${parsed.items.length} item${parsed.items.length === 1 ? "" : "s"}. Check them, then add them.` : "No items with prices were found."}</p>
          {parsed.items.length ? (
            <table className="table">
              <thead><tr><th>Section</th><th>Item</th><th>Price</th></tr></thead>
              <tbody>
                {parsed.items.map((item, index) => (
                  <tr key={index}>
                    <td className="muted">{item.section ?? "—"}</td>
                    <td>{item.name}</td>
                    <td className="nowrap">{previewPrice(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {parsed.problems.length ? (
            <div className="message error">
              <p>These lines weren't read (add them by hand if they're prices):</p>
              <ul className="plain-list small">{parsed.problems.map((problem) => <li key={problem.line}>Line {problem.line}: "{problem.text}" ({problem.reason})</li>)}</ul>
            </div>
          ) : null}
          {props.hasItems && parsed.items.length ? (
            <label className="check">
              <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
              <span>Replace my whole price list with these (otherwise they're added, and items already listed get the new price)</span>
            </label>
          ) : null}
          <Message message={action.message} />
          <div className="actions">
            <Button onClick={() => setParsed(null)}>Back</Button>
            {parsed.items.length ? (
              <Button kind="primary" busy={action.busy} onClick={() => void action.run(async () => {
                const result = await api<{ added: number; updated: number; removed: number }>("POST", businessPath(props.businessId, "/price-list/import"), { items: parsed.items, replace });
                props.onAdded(`${result.added} added${result.updated ? `, ${result.updated} updated` : ""}${result.removed ? `, ${result.removed} removed` : ""}. Zaina quotes them now.`);
              })}>Add {parsed.items.length} item{parsed.items.length === 1 ? "" : "s"}</Button>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The catalogue from the business's own system: a product feed's address, read now and every day. */
function FeedCard(props: { businessId: string; onChanged: () => void }) {
  const loaded = useLoad(() => api<{ feed: Feed | null }>("GET", businessPath(props.businessId, "/price-list/feed")), [props.businessId]);
  const [feed, setFeed] = useState<Feed | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [daily, setDaily] = useState(true);
  const [sample, setSample] = useState<string[]>([]);
  const action = useAction();
  const current = feed === undefined ? loaded.data?.feed ?? null : feed;
  const read = (body: { url: string; daily: boolean } | null) => action.run(async () => {
    try {
      const result = await api<{ feed: Feed; sample: string[] }>(body ? "PUT" : "POST", businessPath(props.businessId, body ? "/price-list/feed" : "/price-list/feed/sync"), body ?? undefined);
      setFeed(result.feed);
      setSample(result.sample);
      setOpen(false);
      props.onChanged();
    } catch (problem) {
      await loaded.reload();
      setFeed(undefined);
      throw problem;
    }
  });
  if (loaded.data === undefined) return null;
  return (
    <section className="card feed-card">
      <h2>From your own system</h2>
      {current ? (
        <>
          <p>
            Your catalogue is read from <span className="ellipsis">{current.url}</span>{current.daily ? ", every day" : ""}.
            {current.last_read_at ? ` Last read ${timeAgo(current.last_read_at)}: ${current.last_items} item${current.last_items === 1 ? "" : "s"}${current.last_skipped ? `, ${current.last_skipped} left out (no name, or no price in KES or USD)` : ""}.` : ""}
          </p>
          {current.last_error ? <p className="message error" role="alert">The last reading failed: {current.last_error}</p> : null}
          {sample.length ? <p className="muted small">For example: {sample.join(" · ")}</p> : null}
          <div className="actions start">
            <Button busy={action.busy} onClick={() => void read(null)}>Read it now</Button>
            <Button kind="ghost" busy={action.busy} onClick={() => {
              if (!window.confirm("Stop reading your system? Its items leave the catalogue; what you typed stays.")) return;
              void action.run(async () => { await api("DELETE", businessPath(props.businessId, "/price-list/feed")); setFeed(null); props.onChanged(); }, "Stopped. Its items left the catalogue.");
            }}>Stop</Button>
          </div>
        </>
      ) : !open ? (
        <div className="install-row">
          <p className="muted">Already have your products in a shop or system? Zaina can read them every day, with today's prices and stock.</p>
          <Button onClick={() => setOpen(true)}>Connect your products</Button>
        </div>
      ) : (
        <form className="form" onSubmit={(event) => { event.preventDefault(); void read({ url: url.trim(), daily }); }}>
          <Field label="Address of your products' data" hint="JSON, CSV or a Google Merchant feed. WooCommerce: yoursite/wp-json/wc/store/v1/products. Shopify: yourshop/products.json. Your own system: any address that lists products with a name and price (your developer can add one in minutes).">
            <input type="url" inputMode="url" required placeholder="https://www.yourshop.co.ke/api/products" value={url} onChange={(event) => setUrl(event.target.value)} />
          </Field>
          <label className="check"><input type="checkbox" checked={daily} onChange={(event) => setDaily(event.target.checked)} /><span>Read it again every day</span></label>
          <div className="actions"><Button onClick={() => setOpen(false)}>Cancel</Button><Button kind="primary" type="submit" busy={action.busy}>Read it</Button></div>
        </form>
      )}
      <Message message={action.message} />
    </section>
  );
}

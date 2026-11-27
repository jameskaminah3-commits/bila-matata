// web/console/pages/prices.tsx
//
// The price list: what the business charges for things that aren't booked
// here (services, extras, products), by section. Zaina quotes these exactly
// and never takes a price from documents. Items can be added one at a time,
// or pasted as the business has them and checked before they're added, or
// come from the business's own system (a product feed, read every day).
// Each item says whether it's in stock: Zaina won't take an order for one
// that's out.

import { useEffect, useRef, useState } from "react";
import { api, apiUpload, businessPath } from "../api.ts";
import { bannerPhoto, shrinkPhoto, squarePhoto } from "../photo.ts";
import { atLeast, type Role } from "../types.ts";
import { Button, Empty, ErrorLine, Field, Icon, Message, Modal, useAction, useLoad } from "../ui.tsx";
import { timeAgo } from "../format.ts";

type PriceItem = {
  id: string; section: string | null; name: string; description: string | null; price: number; price_max: number | null;
  currency: "KES" | "USD"; unit: string | null; status: "active" | "hidden"; sort_order: number; price_display: string;
  available: boolean; stock: number | null; source: "manual" | "feed"; url: string | null; image_url: string | null; picture_url: string | null;
};
type Feed = { url: string; daily: boolean; last_read_at: string | null; last_items: number; last_skipped: number; last_error: string | null };
type Parsed = { items: Array<{ section: string | null; name: string; description: string | null; price: string; price_max: string | null; currency: "KES" | "USD"; unit: string | null }>; problems: Array<{ line: number; text: string; reason: string }> };

export function PricesPage(props: { businessId: string; role: Role; businessType: string | null; kind?: string | null; menuOnly?: boolean }) {
  const list = useLoad(() => api<{ items: PriceItem[] }>("GET", businessPath(props.businessId, "/price-list")), [props.businessId]);
  // Each section's banner picture on the business's page (src/prices/section-images.ts).
  const banners = useLoad(() => api<{ pictures: Record<string, string> }>("GET", businessPath(props.businessId, "/catalogue-sections")), [props.businessId]);
  const [editing, setEditing] = useState<PriceItem | "new" | null>(null);
  const [pasting, setPasting] = useState<"text" | "photo" | null>(null);
  const [arranging, setArranging] = useState(false);
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
          {props.menuOnly
            ? "Your menu, exactly as guests see it on your page: sections, dishes, prices and photos. A change here is live at once."
            : <>What you sell and charge for {booked ? `that isn't ${booked} booked here: extras, transfers, meals, products` : "that customers ask about: your products, services and packages"}.
              {" "}Zaina quotes these exactly, says what's out of stock, and never takes a price from your documents.</>}
        </p>
      </div>
      {manager ? (
        <div className="toolbar">
          <Button kind="primary" onClick={() => setEditing("new")}><Icon name="plus" size={15} /> Add an item</Button>
          <Button onClick={() => setPasting("photo")}>Snap your price list</Button>
          <Button kind="ghost" onClick={() => setPasting("text")}>Paste a list</Button>
          {items.length > 1 ? <Button kind="ghost" onClick={() => setArranging(true)}><Icon name="up" size={15} /> Arrange the order</Button> : null}
        </div>
      ) : null}
      {manager && items.length > 0 ? <MenuAssistant businessId={props.businessId} menu={props.kind === "restaurant" || props.menuOnly === true} onChanged={() => void list.reload()} /> : null}
      {manager && !props.menuOnly ? <FeedCard businessId={props.businessId} onChanged={() => void list.reload()} /> : null}
      <ErrorLine error={list.error} />
      <Message message={action.message} />
      {list.data && items.length === 0 ? (
        <Empty title="Nothing here yet">
          <p>Add what you sell with a photo and a price, or take a photo of your price board or menu and Zaina reads it for you. Until then, Zaina says she isn't sure of a price and offers the team.</p>
        </Empty>
      ) : null}
      {arranging ? (
        <ArrangeMenu
          businessId={props.businessId}
          zaina={!props.menuOnly}
          items={items}
          onCancel={() => setArranging(false)}
          onSaved={async () => { setArranging(false); await list.reload(); }}
        />
      ) : null}
      {!arranging && sections.map((section) => (
        <section key={section || "none"} className="stack-tight">
          {section ? (
            <div className="section-head">
              <h2 className="section-title">{section}</h2>
              {manager ? (() => {
                const banner = banners.data?.pictures[section.trim().replace(/\s+/g, " ").toLowerCase()];
                const path = businessPath(props.businessId, `/catalogue-sections/picture?section=${encodeURIComponent(section)}`);
                return (
                  <div className="section-banner">
                    {banner ? <img className="section-banner-thumb" src={banner} alt="" loading="lazy" /> : null}
                    <label className="button small secondary">
                      {banner ? "Change section photo" : "Add section photo"}
                      <input className="visually-hidden" type="file" accept="image/*" onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        void action.run(async () => { await apiUpload("PUT", path, await bannerPhoto(file)); await banners.reload(); }, `"${section}" has its photo on your page.`);
                      }} />
                    </label>
                    {banner ? <Button small kind="ghost" onClick={() => void action.run(async () => { await api("DELETE", path); await banners.reload(); }, `"${section}" shows your colour again.`)}>Remove</Button> : null}
                  </div>
                );
              })() : null}
            </div>
          ) : null}
          <table className="table price-table">
            <thead><tr><th>Item</th><th>Price</th>{manager ? <th><span className="visually-hidden">Actions</span></th> : null}</tr></thead>
            <tbody>
              {items.filter((item) => (item.section ?? "") === section).map((item) => (
                <tr key={item.id}>
                  <td>
                    {/* The flex layout sits inside the cell: on the cell itself it stops being a table cell and the row's lines don't meet. */}
                    <div className="item-cell">
                      {item.picture_url ? <img className="item-thumb" src={item.picture_url} alt="" loading="lazy" /> : null}
                      <strong>{item.name}</strong>
                      {item.status === "hidden" ? <span className="chip closed">Hidden</span> : null}
                      {item.source === "feed" ? <span className="chip">From your system</span> : null}
                      {item.description ? <div className="muted small item-desc">{item.description}</div> : null}
                    </div>
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
            if (photo) saved = await apiUpload<{ item: PriceItem }>("PUT", businessPath(props.businessId, `/price-list/${saved.item.id}/picture`), photo);
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
                // Made square here (whole picture, no cropping or stretching), so the preview is exactly what's saved.
                void action.run(async () => {
                  const ready = await squarePhoto(file);
                  setPhoto(ready);
                  setRemovePhoto(false);
                  setPreview(URL.createObjectURL(ready));
                });
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
          <p className="muted">One item per line with its price, as you have it: "Airport transfer — KSh 3,500 per car", "Laundry: 200 per item", "Massage 60 min ... 4,500", "Kids under 5: free". Add a description after a bar: "Beef samosa: 575 | 4 pieces, spiced beef". Sizes in brackets are separate items that show together: "Absolut Vodka (750ml Bottle): 5000", "Absolut Vodka (Shot): 300". A line without a price starts a section.</p>
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
                    <td>{item.name}{item.description ? <div className="muted small">{item.description}</div> : null}</td>
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

/**
 * The menu's order, as the team wants guests to read it: sections up or down,
 * and each dish up or down within its section (or A to Z). Items without a
 * section always come first on the page, so they stay first here.
 */
function ArrangeMenu(props: { businessId: string; zaina: boolean; items: PriceItem[]; onCancel: () => void; onSaved: () => Promise<void> }) {
  const byId = new Map(props.items.map((item) => [item.id, item]));
  const [groups, setGroups] = useState(() => {
    const order: Array<{ section: string; ids: string[] }> = [];
    for (const item of props.items) {
      const section = item.section ?? "";
      const group = order.find((entry) => entry.section === section) ?? order[order.push({ section, ids: [] }) - 1];
      group.ids.push(item.id);
    }
    // Unsectioned items lead the page; keep them first.
    return [...order.filter((group) => !group.section), ...order.filter((group) => group.section)];
  });
  const action = useAction();
  const fromFeed = props.items.some((item) => item.source === "feed");
  const shift = <T,>(list: T[], from: number, to: number): T[] => {
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };
  const firstMovable = groups[0] && !groups[0].section ? 1 : 0;
  const moveSection = (index: number, by: number) => setGroups((current) => shift(current, index, index + by));
  const moveItem = (index: number, at: number, by: number) => setGroups((current) => current.map((group, g) => (g === index ? { ...group, ids: shift(group.ids, at, at + by) } : group)));
  const alphabetical = (index: number) => setGroups((current) => current.map((group, g) => (g === index ? { ...group, ids: group.ids.slice().sort((a, b) => (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? "")) } : group)));
  const Arrow = (arrow: { dir: "up" | "down"; label: string; disabled: boolean; onClick: () => void }) => (
    <button type="button" className="arrange-move" aria-label={arrow.label} title={arrow.label} disabled={arrow.disabled} onClick={arrow.onClick}><Icon name={arrow.dir} size={16} /></button>
  );
  return (
    <section className="card stack-tight arrange">
      <div>
        <h2>Arrange your menu</h2>
        <p className="muted small">Put sections and dishes in the order guests should read them: starters before mains, your signature dish first. {props.zaina ? "Your page and Zaina follow" : "Your page follows"} it as soon as you save.</p>
        {fromFeed ? <p className="muted small">Items from your own system take your system's order again each time it's read.</p> : null}
      </div>
      <Message message={action.message} />
      <ol className="arrange-sections">
        {groups.map((group, g) => (
          <li key={group.section || "none"} className="arrange-section">
            <div className="arrange-row arrange-section-row">
              <span className="arrange-name"><strong>{group.section || "Before the first section"}</strong><span className="muted small">{group.ids.length} item{group.ids.length === 1 ? "" : "s"}</span></span>
              {group.ids.length > 2 ? <button type="button" className="link small" onClick={() => alphabetical(g)}>A to Z</button> : null}
              {group.section ? (
                <span className="arrange-moves">
                  <Arrow dir="up" label={`Move ${group.section} up`} disabled={g <= firstMovable} onClick={() => moveSection(g, -1)} />
                  <Arrow dir="down" label={`Move ${group.section} down`} disabled={g === groups.length - 1} onClick={() => moveSection(g, 1)} />
                </span>
              ) : null}
            </div>
            <ol className="arrange-items">
              {group.ids.map((id, at) => {
                const item = byId.get(id)!;
                return (
                  <li key={id} className="arrange-row">
                    <span className="arrange-name"><span>{item.name}</span><span className="muted small">{item.price_display}</span></span>
                    <span className="arrange-moves">
                      <Arrow dir="up" label={`Move ${item.name} up`} disabled={at === 0} onClick={() => moveItem(g, at, -1)} />
                      <Arrow dir="down" label={`Move ${item.name} down`} disabled={at === group.ids.length - 1} onClick={() => moveItem(g, at, 1)} />
                    </span>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
      <div className="actions">
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button kind="primary" busy={action.busy} onClick={() => void action.run(async () => {
          await api("PUT", businessPath(props.businessId, "/price-list/order"), { ids: groups.flatMap((group) => group.ids) });
          await props.onSaved();
        })}>Save this order</Button>
      </div>
    </section>
  );
}

type AssistantChange = Record<string, unknown> & { op: string };
type AssistantPreview = { change: AssistantChange; kind: string; label: string; before: string | null; after: string };
type AssistantPlan = { summary: string; question: string | null; previews: AssistantPreview[]; skipped: string[]; dropped: number };

/**
 * The menu assistant: the team says what to change in its own words, sees
 * every change before → after, applies the ones it wants, and can undo them
 * in one tap. Nothing changes until Apply.
 */
function MenuAssistant(props: { businessId: string; menu: boolean; onChanged: () => void }) {
  const info = useLoad(() => api<{ available: boolean; ideas: string[] }>("GET", businessPath(props.businessId, "/price-list/assistant")), [props.businessId]);
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [chosen, setChosen] = useState<boolean[]>([]);
  const [undo, setUndo] = useState<{ changes: AssistantChange[]; note: string } | null>(null);
  const [state, setState] = useState<"idle" | "thinking" | "applying">("idle");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (plan?.question) input.current?.focus(); }, [plan]);
  if (!info.data?.available) return null;
  const name = props.menu ? "Menu assistant" : "Catalogue assistant";

  const ask = async (words: string) => {
    const request = words.replace(/\s+/g, " ").trim();
    if (request.length < 3 || state !== "idle") return;
    setText(request);
    setState("thinking");
    setError(null);
    setUndo(null);
    setPlan(null);
    try {
      const result = await api<AssistantPlan>("POST", businessPath(props.businessId, "/price-list/assistant"), { text: request });
      setPlan(result);
      setChosen(result.previews.map(() => true));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That didn't go through. Try again in a moment.");
    } finally {
      setState("idle");
    }
  };
  const apply = async (changes: AssistantChange[], undoing: boolean) => {
    if (!changes.length) return;
    setState("applying");
    setError(null);
    try {
      const result = await api<{ applied: number; skipped: string[]; undo: AssistantChange[] }>("POST", businessPath(props.businessId, "/price-list/assistant/apply"), { changes });
      props.onChanged();
      setPlan(null);
      if (undoing) {
        setUndo(null);
        setText("");
        setError(result.skipped.length ? `Put back, except: ${result.skipped.join("; ")}.` : null);
      } else {
        const count = `${result.applied} change${result.applied === 1 ? "" : "s"}`;
        setUndo({ changes: result.undo, note: `${count} applied. Live on your ${props.menu ? "menu" : "page"} now.${result.skipped.length ? ` Not applied: ${result.skipped.join("; ")}.` : ""}` });
        setText("");
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That didn't go through. Try again in a moment.");
    } finally {
      setState("idle");
    }
  };
  const picked = plan ? plan.previews.filter((_, index) => chosen[index]).map((preview) => preview.change) : [];

  return (
    <section className="menu-ai" aria-labelledby="menu-ai-title">
      <div className="menu-ai-head">
        <span className="menu-ai-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" /><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" opacity=".7" /></svg></span>
        <div>
          <h2 id="menu-ai-title">{name}</h2>
          <p>Say what to change, in your own words. You'll see every change before anything moves.</p>
        </div>
      </div>
      <form className="menu-ai-ask" onSubmit={(event) => { event.preventDefault(); void ask(text); }}>
        <input ref={input} value={text} maxLength={1500} onChange={(event) => setText(event.target.value)} placeholder={props.menu ? "e.g. Raise the cocktails by 10%, or: the tilapia is finished tonight" : "e.g. Raise everything in Extras by 10%"} aria-label={`Tell the ${name.toLowerCase()} what to change`} disabled={state !== "idle"} />
        <button type="submit" className="menu-ai-go" disabled={state !== "idle" || text.trim().length < 3}>{state === "thinking" ? "Preparing…" : "Prepare changes"}</button>
      </form>
      {!plan && !undo && state === "idle" && info.data.ideas.length ? (
        <div className="menu-ai-ideas" role="group" aria-label="Ideas">
          {info.data.ideas.map((idea) => <button type="button" key={idea} className="menu-ai-idea" onClick={() => void ask(idea)}>{idea}</button>)}
        </div>
      ) : null}
      {state === "thinking" ? <p className="menu-ai-working" role="status">Reading your {props.menu ? "menu" : "catalogue"}…</p> : null}
      {error ? <p className="menu-ai-error" role="alert">{error}</p> : null}
      {plan && plan.previews.length === 0 ? (
        <div className="menu-ai-note" role="status">
          <p>{plan.question ? <><span className="menu-ai-label">A question first</span>{plan.question}</> : "Nothing to change there: everything already reads that way."}</p>
          {plan.skipped.length ? <p className="menu-ai-skipped">{plan.skipped.join(" · ")}</p> : null}
        </div>
      ) : null}
      {plan && plan.previews.length > 0 ? (
        <div className="menu-ai-plan">
          {plan.summary ? <p className="menu-ai-summary">{plan.summary}</p> : null}
          <ul className="menu-ai-changes">
            {plan.previews.map((preview, index) => (
              <li key={index} className={chosen[index] ? "" : "off"}>
                <label>
                  <input type="checkbox" checked={chosen[index] ?? false} onChange={(event) => setChosen(chosen.map((on, at) => (at === index ? event.target.checked : on)))} />
                  <span className="menu-ai-row">
                    <span className="menu-ai-what"><span className="menu-ai-kind">{preview.kind}</span><strong>{preview.label}</strong></span>
                    <span className={`menu-ai-diff${preview.kind === "Description" || preview.kind === "New dish" ? " long" : ""}`}>
                      {preview.before ? <><s>{preview.before}</s><span className="menu-ai-arrow" aria-label="becomes">→</span></> : null}
                      <b>{preview.after}</b>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {plan.skipped.length ? <p className="menu-ai-skipped">Left out: {plan.skipped.join(" · ")}</p> : null}
          <div className="menu-ai-actions">
            <button type="button" className="menu-ai-go" disabled={!picked.length || state !== "idle"} onClick={() => void apply(picked, false)}>{state === "applying" ? "Applying…" : `Apply ${picked.length} change${picked.length === 1 ? "" : "s"}`}</button>
            <button type="button" className="menu-ai-quiet" disabled={state !== "idle"} onClick={() => setPlan(null)}>Discard</button>
          </div>
        </div>
      ) : null}
      {undo ? (
        <div className="menu-ai-done" role="status">
          <span className="menu-ai-tick" aria-hidden="true">✓</span>
          <p>{undo.note}</p>
          {undo.changes.length ? <button type="button" className="menu-ai-quiet" disabled={state !== "idle"} onClick={() => void apply(undo.changes, true)}>Undo</button> : null}
        </div>
      ) : null}
    </section>
  );
}

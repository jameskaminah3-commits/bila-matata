// web/console/pages/brand.tsx
//
// Settings → Brand: how the business looks wherever Zaina speaks for it (the
// chat box on its website, its own page behind the QR code, the payment
// page): its logo, a cover picture, its colour, a welcome line, and whether
// the chat shows Zaina's face or the business's logo. A preview follows every
// change before it is saved.

import { useEffect, useRef, useState } from "react";
import { api, ApiError, apiUpload, businessPath } from "../api.ts";
import { shrinkPhoto } from "../photo.ts";
import { ZAINA_FACE_DATA_URI } from "../../../src/brand/zaina-face.ts";
import { atLeast, type Role, type Settings } from "../types.ts";
import { Button, ErrorLine, Field, Message, useAction, useLoad } from "../ui.tsx";

type BrandView = { logo_url: string | null; cover_url: string | null; limits: { logo_kb: number; cover_kb: number } };
type Kind = "logo" | "cover";

const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
};

export function Brand(props: { businessId: string; role: Role }) {
  const settings = useLoad(() => api<{ settings: Settings }>("GET", businessPath(props.businessId, "/settings")).then((result) => result.settings), [props.businessId]);
  const pictures = useLoad(() => api<BrandView>("GET", businessPath(props.businessId, "/brand")), [props.businessId]);
  const [brand, setBrand] = useState<BrandView | null>(null);
  const [form, setForm] = useState<{ color: string; tagline: string; avatar: "zaina" | "logo"; menu: "auto" | "light" | "dark" } | null>(null);
  const save = useAction();
  const upload = useAction();
  const canEdit = atLeast(props.role, "manager");
  useEffect(() => setBrand(pictures.data), [pictures.data]);
  useEffect(() => {
    if (settings.data) setForm({ color: settings.data.widgetColor, tagline: settings.data.brandTagline ?? "", avatar: settings.data.chatAvatar ?? "zaina", menu: settings.data.menuStyle ?? "auto" });
  }, [settings.data]);
  if (!form || !brand || !settings.data) return <ErrorLine error={settings.error ?? pictures.error} />;
  const name = settings.data.displayName;
  const role = settings.data.personaRole?.trim().toLowerCase() || "customer care host";
  const assistant = settings.data.assistantName;
  const showLogo = form.avatar === "logo" && brand.logo_url;

  const put = (kind: Kind, original: File | undefined) => {
    if (!original) return;
    const limit = kind === "logo" ? brand.limits.logo_kb : brand.limits.cover_kb;
    void upload.run(async () => {
      // A phone's photo is made the right size first (a logo keeps any see-through parts).
      const file = await shrinkPhoto(original, kind === "logo" ? { maxSide: 600, maxBytes: limit * 1024 - 1024, keepTransparency: true } : { maxSide: 1600, maxBytes: limit * 1024 - 1024 });
      if (file.size > limit * 1024) throw new ApiError(400, "too_big", `That picture is too big: the ${kind} can be up to ${limit} KB.`);
      setBrand(await apiUpload<BrandView>("PUT", businessPath(props.businessId, `/brand/${kind}`), file));
    }, `Your ${kind} is saved. Customers see it straight away.`);
  };
  const remove = (kind: Kind) => void upload.run(async () => {
    setBrand(await api<BrandView>("DELETE", businessPath(props.businessId, `/brand/${kind}`)));
    if (kind === "logo" && form.avatar === "logo") setForm({ ...form, avatar: "zaina" });
  }, `Your ${kind} is removed.`);

  return (
    <div className="stack">
      <section className="card">
        <h2>Your brand</h2>
        <p className="muted">How your business looks wherever {assistant} speaks for it: the chat on your website, your own page behind your QR code, and the page where customers pay you.</p>
        <div className="brand-preview" ref={(node) => node?.style.setProperty("--preview", form.color)} aria-label="Preview">
          <div className={`brand-preview-door${brand.cover_url ? " has-cover" : ""}`}>
            {brand.cover_url ? <img className="brand-preview-cover" src={brand.cover_url} alt="" /> : null}
            <div className="brand-preview-brand">
              <span className={`brand-preview-logo${brand.logo_url ? "" : " letters"}`}>{brand.logo_url ? <img src={brand.logo_url} alt="" /> : initials(name)}</span>
              <div><strong>{name}</strong>{form.tagline.trim() ? <span>{form.tagline.trim()}</span> : null}</div>
            </div>
          </div>
          <div className="brand-preview-chat">
            <div className="brand-preview-head">
              <span className={`brand-preview-face${showLogo ? " logo" : ""}`}><img src={showLogo ? brand.logo_url! : ZAINA_FACE_DATA_URI} alt="" /></span>
              <div><strong>{assistant}</strong><span>{role.charAt(0).toUpperCase() + role.slice(1)} · {name}</span></div>
            </div>
            <p className="brand-preview-bubble">Hi, I'm {assistant}, the {role} at {name}. How can I help you today?</p>
            <p className="brand-preview-bubble mine">Do you have space on Saturday?</p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Logo and cover</h2>
        <div className="brand-pictures">
          <PictureField kind="logo" title="Logo" hint={`Square works best. PNG, JPEG or WebP, up to ${brand.limits.logo_kb} KB.`} url={brand.logo_url} canEdit={canEdit} busy={upload.busy} onPick={(file) => put("logo", file)} onRemove={() => remove("logo")} />
          <PictureField kind="cover" title="Cover picture" hint={`A wide photo of your place or your work. Up to ${brand.limits.cover_kb} KB.`} url={brand.cover_url} canEdit={canEdit} busy={upload.busy} onPick={(file) => put("cover", file)} onRemove={() => remove("cover")} />
        </div>
        <Message message={upload.message} />
      </section>

      <form
        className="form card"
        onSubmit={async (event) => {
          event.preventDefault();
          await save.run(() => api("PATCH", businessPath(props.businessId, "/settings"), { widgetColor: form.color, brandTagline: form.tagline.trim() || null, chatAvatar: form.avatar, menuStyle: form.menu }), "Saved. Customers see your brand from their next visit.");
        }}
      >
        <h2>Colour, welcome line and picture</h2>
        <div className="form-row">
          <Field label="Your colour" hint="Buttons, the chat's header and your page use it."><input type="color" disabled={!canEdit} value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} /></Field>
          <Field label="Welcome line" hint="A short line under your name. For example: Hair and beauty in Nyali, open every day.">
            <input maxLength={120} disabled={!canEdit} value={form.tagline} onChange={(event) => setForm({ ...form, tagline: event.target.value })} />
          </Field>
          <Field label="Menu colours" hint="How your page looks to guests. Always dark suits a bar or club at night.">
            <select disabled={!canEdit} value={form.menu} onChange={(event) => setForm({ ...form, menu: event.target.value as "auto" | "light" | "dark" })}>
              <option value="auto">Follow the guest's phone</option>
              <option value="light">Always light</option>
              <option value="dark">Always dark</option>
            </select>
          </Field>
        </div>
        <fieldset className="choice">
          <legend>The picture in the chat</legend>
          <label className="check"><input type="radio" name="avatar" disabled={!canEdit} checked={form.avatar === "zaina"} onChange={() => setForm({ ...form, avatar: "zaina" })} /><span>{assistant}'s face: a friendly host your customers recognise</span></label>
          <label className="check"><input type="radio" name="avatar" disabled={!canEdit || !brand.logo_url} checked={form.avatar === "logo"} onChange={() => setForm({ ...form, avatar: "logo" })} /><span>Our logo{brand.logo_url ? "" : " (add a logo first)"}</span></label>
        </fieldset>
        <Message message={save.message} />
        {canEdit ? <div className="actions"><Button kind="primary" type="submit" busy={save.busy}>Save</Button></div> : <p className="muted small">Managers and owners can change these.</p>}
      </form>
    </div>
  );
}

function PictureField(props: { kind: Kind; title: string; hint: string; url: string | null; canEdit: boolean; busy: boolean; onPick: (file: File | undefined) => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="brand-picture">
      <span className={`brand-thumb ${props.kind}${props.url ? "" : " empty"}`}>{props.url ? <img src={props.url} alt={`Your ${props.kind}`} /> : <span>None yet</span>}</span>
      <div>
        <h3>{props.title}</h3>
        <p className="muted small">{props.hint}</p>
        {props.canEdit ? (
          <div className="actions start">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="visually-hidden"
              aria-label={`Choose a ${props.kind}`}
              onChange={(event) => {
                props.onPick(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <Button small busy={props.busy} onClick={() => input.current?.click()}>{props.url ? "Replace" : "Upload"}</Button>
            {props.url ? <Button small kind="ghost" busy={props.busy} onClick={props.onRemove}>Remove</Button> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

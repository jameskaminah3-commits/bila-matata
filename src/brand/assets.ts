// src/brand/assets.ts
//
// A business's own pictures (migration 0019): its logo and a cover, shown
// wherever Zaina speaks for it (the chat box, its page behind the QR code,
// the payment page). Kept in the database, inside the business (row-level
// security): small, few, and backed up with everything else.
//
// A picture is what its first bytes say it is (PNG, JPEG or WebP), never what
// the upload claims; nothing that can carry script (SVG, HTML) is accepted.

import { createHash } from "node:crypto";
import { inBusiness } from "../db/tenant.ts";

export const BRAND_KINDS = ["logo", "cover"] as const;
export type BrandKind = (typeof BRAND_KINDS)[number];
export const isBrandKind = (value: unknown): value is BrandKind => BRAND_KINDS.includes(value as BrandKind);

/** The biggest each may be: a logo is small; a cover is a photograph. */
export const BRAND_MAX_BYTES: Record<BrandKind, number> = { logo: 300 * 1024, cover: 1024 * 1024 };

export type BrandImageType = "image/png" | "image/jpeg" | "image/webp";
export type BrandAssetInfo = { kind: BrandKind; contentType: BrandImageType; sha256: string; updatedAt: Date };
export type BrandAssets = { logo: BrandAssetInfo | null; cover: BrandAssetInfo | null };

/** What a file really is, from its first bytes; null when it isn't a picture we take. */
export function sniffImage(bytes: Buffer): BrandImageType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Checks an upload: a real picture of an accepted kind, within its size. */
export function checkBrandImage(kind: BrandKind, bytes: unknown): { ok: true; contentType: BrandImageType; bytes: Buffer } | { ok: false; message: string } {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { ok: false, message: "Choose a picture: a PNG, JPEG or WebP file." };
  const limit = BRAND_MAX_BYTES[kind];
  if (bytes.length > limit) return { ok: false, message: `That picture is too big: the ${kind} can be up to ${Math.round(limit / 1024)} KB.` };
  const contentType = sniffImage(bytes);
  if (!contentType) return { ok: false, message: "That file isn't a PNG, JPEG or WebP picture." };
  return { ok: true, contentType, bytes };
}

const CACHE_MS = Number(process.env.BUSINESS_CACHE_MS ?? "") || 30_000;
const cache = new Map<string, { at: number; assets: BrandAssets }>();

/** Which pictures a business has (not the pictures themselves). */
export async function brandAssetsOf(businessId: string): Promise<BrandAssets> {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.assets;
  const rows = await inBusiness(async (_db, client) => (await client.query<BrandAssetInfo>(
    `select kind, content_type as "contentType", sha256, updated_at as "updatedAt" from brand_assets where business_id = $1`,
    [businessId],
  )).rows, businessId);
  const assets: BrandAssets = { logo: rows.find((row) => row.kind === "logo") ?? null, cover: rows.find((row) => row.kind === "cover") ?? null };
  cache.set(businessId, { at: Date.now(), assets });
  return assets;
}

/** One picture, to send to a browser. */
export async function readBrandAsset(businessId: string, kind: BrandKind): Promise<(BrandAssetInfo & { bytes: Buffer }) | null> {
  const rows = await inBusiness(async (_db, client) => (await client.query<BrandAssetInfo & { bytes: Buffer }>(
    `select kind, content_type as "contentType", sha256, updated_at as "updatedAt", bytes from brand_assets where business_id = $1 and kind = $2`,
    [businessId, kind],
  )).rows, businessId);
  return rows[0] ?? null;
}

export async function saveBrandAsset(businessId: string, kind: BrandKind, image: { contentType: BrandImageType; bytes: Buffer }, updatedBy: string | null): Promise<BrandAssetInfo> {
  const sha256 = createHash("sha256").update(image.bytes).digest("hex");
  const rows = await inBusiness(async (_db, client) => (await client.query<BrandAssetInfo>(
    `insert into brand_assets (business_id, kind, content_type, bytes, sha256, updated_by)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (business_id, kind) do update set content_type = excluded.content_type, bytes = excluded.bytes, sha256 = excluded.sha256, updated_by = excluded.updated_by, updated_at = now()
     returning kind, content_type as "contentType", sha256, updated_at as "updatedAt"`,
    [businessId, kind, image.contentType, image.bytes, sha256, updatedBy],
  )).rows, businessId);
  cache.delete(businessId);
  return rows[0];
}

export async function removeBrandAsset(businessId: string, kind: BrandKind): Promise<boolean> {
  const removed = await inBusiness(async (_db, client) => (await client.query(`delete from brand_assets where business_id = $1 and kind = $2`, [businessId, kind])).rowCount ?? 0, businessId);
  cache.delete(businessId);
  return removed > 0;
}

/** A picture's address: it changes when the picture does, so browsers may keep it. */
export function brandAssetUrl(baseUrl: string, businessId: string, asset: BrandAssetInfo | null): string | null {
  return asset ? `${baseUrl}/brand/${encodeURIComponent(businessId)}/${asset.kind}?v=${asset.sha256.slice(0, 12)}` : null;
}

/** Text that reads on a colour: dark on a light colour, white on a dark one. */
export function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#111827" : "#ffffff";
}

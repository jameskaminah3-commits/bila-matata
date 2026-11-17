// src/prices/images.ts
//
// A picture of a catalogue item (migration 0031): a photo the team uploaded,
// kept in the database inside the business (like its logo, brand/assets.ts),
// or the address of a picture the business's own feed already has. Its
// public address carries the photo's fingerprint, so browsers and WhatsApp
// may keep it; Zaina shares that address when a customer wants to see the
// item. A picture is what its first bytes say it is (PNG, JPEG or WebP).

import { createHash } from "node:crypto";
import { sniffImage, type BrandImageType } from "../brand/assets.ts";
import type { PriceItem } from "../db/schema.ts";
import { inBusiness } from "../db/tenant.ts";

/** Phones' photos are shrunk in the browser before upload; this is the most kept. */
export const ITEM_PICTURE_MAX_BYTES = 1024 * 1024;

export function checkItemPicture(bytes: unknown): { ok: true; contentType: BrandImageType; bytes: Buffer } | { ok: false; message: string } {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { ok: false, message: "Choose a photo: a PNG, JPEG or WebP picture." };
  if (bytes.length > ITEM_PICTURE_MAX_BYTES) return { ok: false, message: "That photo is too big (up to 1 MB)." };
  const contentType = sniffImage(bytes);
  if (!contentType) return { ok: false, message: "That file isn't a PNG, JPEG or WebP picture." };
  return { ok: true, contentType, bytes };
}

/** Saves the item's photo and marks the item with its fingerprint. False when there's no such item. */
export async function saveItemPicture(businessId: string, itemId: string, image: { contentType: BrandImageType; bytes: Buffer }, userId: string | null): Promise<boolean> {
  const sha256 = createHash("sha256").update(image.bytes).digest("hex");
  return inBusiness(async (_db, client) => {
    const { rowCount } = await client.query("update price_items set image_version = $3, updated_at = now() where business_id = $1 and id = $2", [businessId, itemId, sha256.slice(0, 12)]);
    if (!rowCount) return false;
    await client.query(
      `insert into catalogue_images (business_id, item_id, content_type, bytes, sha256, updated_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (business_id, item_id) do update set content_type = excluded.content_type, bytes = excluded.bytes, sha256 = excluded.sha256, updated_by = excluded.updated_by, updated_at = now()`,
      [businessId, itemId, image.contentType, image.bytes, sha256, userId],
    );
    return true;
  }, businessId);
}

export async function removeItemPicture(businessId: string, itemId: string): Promise<boolean> {
  return inBusiness(async (_db, client) => {
    await client.query("update price_items set image_version = null, updated_at = now() where business_id = $1 and id = $2", [businessId, itemId]);
    const { rowCount } = await client.query("delete from catalogue_images where business_id = $1 and item_id = $2", [businessId, itemId]);
    return Boolean(rowCount);
  }, businessId);
}

export async function readItemPicture(businessId: string, itemId: string): Promise<{ contentType: string; bytes: Buffer; sha256: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return null;
  return inBusiness(async (_db, client) => {
    const { rows } = await client.query<{ content_type: string; bytes: Buffer; sha256: string }>("select content_type, bytes, sha256 from catalogue_images where business_id = $1 and item_id = $2", [businessId, itemId]);
    return rows[0] ? { contentType: rows[0].content_type, bytes: rows[0].bytes, sha256: rows[0].sha256 } : null;
  }, businessId);
}

/**
 * The item's picture address: the uploaded photo on this service (absolute
 * when the service's public address is known), else the feed's own picture.
 */
export function itemPictureUrl(item: Pick<PriceItem, "id" | "businessId" | "imageUrl" | "imageVersion">, base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "") ?? ""): string | null {
  if (item.imageVersion) return `${base}/catalogue/${item.businessId}/${item.id}?v=${item.imageVersion}`;
  return item.imageUrl ?? null;
}

// src/prices/section-images.ts
//
// A picture for a section of the catalogue ("Whisky", "Snacks"), the banner
// the business's page opens that section with. Kept in the database like the
// items' pictures (catalogue_section_images, migration 0039), by the section's
// name in lower case, and served at /catalogue/<business>/sections/<key>?v=<fingerprint>.

import { createHash } from "node:crypto";
import { inBusiness } from "../db/tenant.ts";
import type { BrandImageType } from "../brand/assets.ts";

/** How a section is kept: its name, trimmed, in lower case. */
export const sectionKey = (section: string) => section.trim().replace(/\s+/g, " ").toLowerCase();

export async function saveSectionPicture(businessId: string, section: string, image: { contentType: BrandImageType; bytes: Buffer }, userId: string | null): Promise<string> {
  const sha256 = createHash("sha256").update(image.bytes).digest("hex");
  await inBusiness((_db, client) => client.query(
    `insert into catalogue_section_images (business_id, section_key, content_type, bytes, sha256, updated_by) values ($1, $2, $3, $4, $5, $6)
     on conflict (business_id, section_key) do update set content_type = excluded.content_type, bytes = excluded.bytes, sha256 = excluded.sha256, updated_by = excluded.updated_by, updated_at = now()`,
    [businessId, sectionKey(section), image.contentType, image.bytes, sha256, userId]), businessId);
  return sha256.slice(0, 12);
}

export async function removeSectionPicture(businessId: string, section: string): Promise<void> {
  await inBusiness((_db, client) => client.query("delete from catalogue_section_images where business_id = $1 and section_key = $2", [businessId, sectionKey(section)]), businessId);
}

export async function readSectionPicture(businessId: string, key: string): Promise<{ contentType: string; bytes: Buffer; sha256: string } | null> {
  const { rows } = await inBusiness((_db, client) => client.query<{ content_type: string; bytes: Buffer; sha256: string }>(
    "select content_type, bytes, sha256 from catalogue_section_images where business_id = $1 and section_key = $2", [businessId, sectionKey(key)]), businessId);
  return rows[0] ? { contentType: rows[0].content_type, bytes: rows[0].bytes, sha256: rows[0].sha256 } : null;
}

/** Each section's picture address (same origin, pinned to its fingerprint), by section key. */
export async function sectionPictureUrls(businessId: string): Promise<Map<string, string>> {
  const { rows } = await inBusiness((_db, client) => client.query<{ section_key: string; sha256: string }>(
    "select section_key, sha256 from catalogue_section_images where business_id = $1", [businessId]), businessId);
  return new Map(rows.map((row) => [row.section_key, `/catalogue/${encodeURIComponent(businessId)}/sections/${encodeURIComponent(row.section_key)}?v=${row.sha256.slice(0, 12)}`]));
}

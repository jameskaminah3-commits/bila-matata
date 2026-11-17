-- Pictures of what a business sells (src/prices/images.ts): a photo the team
-- took or uploaded, kept in the database inside the business (row-level
-- security) like its logo; or the address of a picture the business's own
-- feed or website already has. Zaina shares the picture's link when a
-- customer wants to see an item.

create table catalogue_images (
  business_id text not null references businesses (id) on delete cascade,
  item_id uuid not null references price_items (id) on delete cascade,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  bytes bytea not null check (octet_length(bytes) between 1 and 1048576),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (business_id, item_id)
);
alter table catalogue_images enable row level security;
create policy business_rows on catalogue_images to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on catalogue_images to zaina_app;

alter table price_items
  -- A picture elsewhere (the business's feed or website), https only.
  add column image_url text check (image_url is null or (image_url like 'https://%' and length(image_url) <= 500)),
  -- The uploaded picture's fingerprint (its address changes when it does); null when none is uploaded.
  add column image_version text check (image_version is null or image_version ~ '^[0-9a-f]{12}$');

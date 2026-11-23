-- A picture for a section of a business's catalogue ("Whisky", "Snacks"):
-- the banner its page opens that section with. One per section, kept by the
-- section's name in lower case, under the business's own row rules.
create table catalogue_section_images (
  business_id text not null references businesses (id) on delete cascade,
  section_key text not null check (section_key = lower(btrim(section_key)) and char_length(section_key) between 1 and 80),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  bytes bytea not null check (octet_length(bytes) between 1 and 1048576),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (business_id, section_key)
);
alter table catalogue_section_images enable row level security;
create policy business_rows on catalogue_section_images to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on catalogue_section_images to zaina_app;

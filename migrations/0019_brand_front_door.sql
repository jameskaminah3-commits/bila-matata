-- 0019_brand_front_door.sql
--
--   platform payments  Zaina never collects money for a business: customers
--                      pay into the business's own account. Being paid through
--                      a subaccount of the platform's account stays possible,
--                      but only for a business the studio turns it on for.
--                      Businesses already paid that way keep it.
--   brand              how a business looks wherever Zaina speaks for it: a
--                      welcome line, its logo and a cover picture, and whether
--                      the chat shows Zaina's face or the business's logo.
--   front door         a page of the business's own on this service
--                      (/c/<business>) with a QR code that opens it, for a
--                      business with no website; and how many people came
--                      through it and started a chat, by day.

alter table businesses add column platform_payments boolean not null default false;
update businesses b set platform_payments = true
  from booking_settings s where s.business_id = b.id and s.paystack_mode = 'subaccount';

alter table business_settings add column brand_tagline text check (brand_tagline is null or length(btrim(brand_tagline)) between 2 and 120);
alter table business_settings add column chat_avatar text not null default 'zaina' check (chat_avatar in ('zaina', 'logo'));
alter table business_settings add column front_door boolean not null default true;

create table brand_assets (
  business_id text not null references businesses (id) on delete cascade,
  kind text not null check (kind in ('logo', 'cover')),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  bytes bytea not null check (octet_length(bytes) between 1 and 1048576),
  -- Its address changes when the picture does, so browsers can keep it for a long time.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (business_id, kind)
);
alter table brand_assets enable row level security;
create policy business_rows on brand_assets to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on brand_assets to zaina_app;

create table front_door_days (
  business_id text not null references businesses (id) on delete cascade,
  day date not null,
  -- qr: the printed code was scanned; link: the address was opened some other way.
  source text not null check (source in ('qr', 'link')),
  visits integer not null default 0 check (visits >= 0),
  chats integer not null default 0 check (chats >= 0),
  primary key (business_id, day, source)
);
alter table front_door_days enable row level security;
create policy business_rows on front_door_days to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update on front_door_days to zaina_app;

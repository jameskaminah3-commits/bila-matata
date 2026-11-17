-- One record per customer of a business (src/customers): their chats,
-- requests, bookings and orders together, what they've told the business
-- they prefer, and what's still open or worth a follow-up.
--
--   customers            keyed by phone (its last 9 digits, as erasure finds
--                        them) or, without one, by email; or by the id the
--                        business's own system vouched for (signed in)
--   *.customer_id        chats, leads, bookings and orders linked to it
--   business_settings.customer_recognition   Zaina greets a returning
--                        customer on a verified channel (on unless turned off)
--
-- A record's phone is only ever the one it was made with (or a verified
-- one): a phone is never added to a record found by email.

create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  name text check (name is null or length(name) <= 120),
  phone text check (phone is null or length(phone) <= 40),
  phone_key text check (phone_key is null or phone_key ~ '^[0-9]{7,9}$'),
  email text check (email is null or length(email) <= 200),
  -- The business's own system's id for a customer signed in on its site.
  external_id text check (external_id is null or length(external_id) <= 120),
  -- [{ text, by: "zaina" | "team", at }]: what they like, in their words.
  preferences jsonb not null default '[]' check (jsonb_typeof(preferences) = 'array'),
  team_note text check (team_note is null or length(team_note) <= 1000),
  -- Follow-up suggestions from before this are done.
  followed_up_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index customers_phone_idx on customers (business_id, phone_key) where phone_key is not null;
create unique index customers_external_idx on customers (business_id, external_id) where external_id is not null;
create index customers_email_idx on customers (business_id, lower(email)) where email is not null;
create index customers_seen_idx on customers (business_id, last_seen_at desc);

alter table customers enable row level security;
create policy business_rows on customers to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on customers to zaina_app;

-- Forgetting a customer leaves the business's records, unlinked.
alter table chat_sessions add column customer_id uuid references customers (id) on delete set null;
create index chat_sessions_customer_idx on chat_sessions (business_id, customer_id) where customer_id is not null;

alter table leads add column customer_id uuid references customers (id) on delete set null;
create index leads_customer_idx on leads (business_id, customer_id) where customer_id is not null;

alter table bookings add column customer_id uuid references customers (id) on delete set null;
create index bookings_customer_idx on bookings (business_id, customer_id) where customer_id is not null;

alter table orders add column customer_id uuid references customers (id) on delete set null;
create index orders_customer_idx on orders (business_id, customer_id) where customer_id is not null;

alter table business_settings add column customer_recognition boolean not null default true;

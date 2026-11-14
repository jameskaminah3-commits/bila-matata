-- Phase 4: Zaina inside a business's own system (docs/INTEGRATION.md).
--
-- The studio turns the connection on for a business (studio_enabled); the
-- business's manager then gives its system's address and chooses what Zaina
-- may ask. Read-only first: writes (booking.create) need allow_writes too.
-- The connection secret is a business secret (business_secrets, encrypted),
-- never stored here.

create table integrations (
  business_id text primary key references businesses (id) on delete cascade,
  studio_enabled boolean not null default false,
  endpoint text check (endpoint is null or (endpoint ~ '^https://' and length(endpoint) <= 500)),
  -- What the system is called to customers ("our shop", "our booking system").
  label text check (label is null or length(label) <= 60),
  actions text[] not null default '{}',
  allow_writes boolean not null default false,
  events_url text check (events_url is null or (events_url ~ '^https://' and length(events_url) <= 500)),
  events text[] not null default '{}',
  last_ok_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 300),
  last_error_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table integrations enable row level security;
create policy business_rows on integrations to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on integrations to zaina_app;

-- Each call Zaina made (and each event sent), for the dashboard and support. Kept 30 days.
create table integration_calls (
  id bigserial primary key,
  business_id text not null references businesses (id) on delete cascade,
  at timestamptz not null default now(),
  action text not null check (length(action) <= 40),
  ok boolean not null,
  ms integer,
  error text check (error is null or length(error) <= 300)
);
create index integration_calls_recent_idx on integration_calls (business_id, at desc);
alter table integration_calls enable row level security;
create policy business_rows on integration_calls to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, delete on integration_calls to zaina_app;
grant usage on sequence integration_calls_id_seq to zaina_app;

-- A customer signed in on the business's own site, as its system vouched for them (a signed token).
alter table chat_sessions add column verified_customer jsonb;

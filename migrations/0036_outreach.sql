-- Reaching customers when they aren't chatting (src/outreach), within their
-- consent and each channel's rules:
--
--   service messages   a reminder before a booking, a follow-up on an
--                      enquiry while its WhatsApp window is still open, a
--                      feedback request after an order or stay. Anyone who
--                      replies STOP gets none of them.
--   offers             campaigns the business approves (bringing customers
--                      back, reminders to reorder, promotions), only to
--                      customers who said yes to offers.
--
--   customers.*                 consent: stopped, offers agreed (and how), asked
--   outreach_messages           every message sent or skipped, and why; ratings
--   campaigns                   offers drafted, approved and sent
--   business_settings.outreach  what the business turned on, its WhatsApp templates

alter table customers
  add column outreach_stopped_at timestamptz,
  add column offers_agreed_at timestamptz,
  add column offers_source text check (offers_source is null or length(offers_source) <= 200),
  add column offers_asked_at timestamptz,
  add column unsubscribe_token text not null default replace(gen_random_uuid()::text, '-', '');
create unique index customers_unsubscribe_idx on customers (business_id, unsubscribe_token);

alter table business_settings add column outreach jsonb check (outreach is null or jsonb_typeof(outreach) = 'object');

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  message text not null check (length(message) between 1 and 700),
  audience text not null check (audience in ('everyone', 'lapsed', 'regulars')),
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'cancelled')),
  created_by uuid references staff_users (id) on delete set null,
  approved_by uuid references staff_users (id) on delete set null,
  approved_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index campaigns_recent_idx on campaigns (business_id, created_at desc);

create table outreach_messages (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  customer_id uuid references customers (id) on delete cascade,
  kind text not null check (kind in ('reminder', 'follow_up', 'feedback', 'offer')),
  -- What it's about, so each is sent once: a booking, an order, a chat, a campaign.
  ref text not null,
  campaign_id uuid references campaigns (id) on delete cascade,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  channel text check (channel is null or channel in ('whatsapp', 'whatsapp_template', 'email')),
  reason text check (reason is null or length(reason) <= 300),
  text text check (text is null or length(text) <= 1000),
  rating integer check (rating is null or rating between 1 and 5),
  rated_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index outreach_once_idx on outreach_messages (business_id, kind, ref);
create index outreach_recent_idx on outreach_messages (business_id, created_at desc);
create index outreach_customer_idx on outreach_messages (business_id, customer_id, created_at desc);

alter table campaigns enable row level security;
alter table outreach_messages enable row level security;
create policy business_rows on campaigns to zaina_app using (business_id = app_business()) with check (business_id = app_business());
create policy business_rows on outreach_messages to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on campaigns, outreach_messages to zaina_app;

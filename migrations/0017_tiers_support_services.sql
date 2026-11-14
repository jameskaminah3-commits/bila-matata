-- 0017_tiers_support_services.sql
--
-- Three things that make Zaina a product a business pays for by tier:
--
--   tiers     a business is on Starter (answers, prices, leads, hand-off) or
--             Full (those, plus availability, exact totals, bookings and
--             checkout). The tier is what Zaina and the dashboard obey; a
--             plan carries a tier, and choosing a plan sets the business's.
--             Plans also carry their one-off set-up fee.
--   support   a business's team asks the studio for help from its
--             dashboard; the studio answers from its own. Threads and
--             messages are the platform's own rows (owner connection only).
--   services  the studio's starting prices, on the price list its own Zaina
--             quotes from (the same figures the website shows).

-- ── Tiers ─────────────────────────────────────────────────────────────
-- Businesses already here keep everything they have (full).
alter table businesses add column tier text not null default 'full' check (tier in ('starter', 'full'));
alter table plans add column tier text not null default 'full' check (tier in ('starter', 'full'));
alter table plans add column setup_fee_minor bigint not null default 0 check (setup_fee_minor between 0 and 100000000000);

-- ── Support ───────────────────────────────────────────────────────────
create table support_threads (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  subject text not null check (length(btrim(subject)) between 3 and 160),
  topic text not null default 'question' check (topic in ('question', 'problem', 'billing', 'setup', 'idea')),
  -- open: the studio owes an answer. answered: the studio replied. closed: done (a new message reopens it).
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  opened_by uuid references staff_users (id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- When each side last read the thread: newer messages from the other side are unread.
  business_read_at timestamptz,
  studio_read_at timestamptz,
  closed_at timestamptz
);
create index support_threads_business_idx on support_threads (business_id, last_message_at desc);
create index support_threads_open_idx on support_threads (last_message_at desc) where status = 'open';
-- Like every table that holds a business's rows, it is kept to that business
-- for the restricted role (which is granted nothing here: only the owner
-- connection reads support).
alter table support_threads enable row level security;
create policy business_rows on support_threads to zaina_app using (business_id = app_business()) with check (business_id = app_business());

create table support_messages (
  id bigserial primary key,
  thread_id uuid not null references support_threads (id) on delete cascade,
  author_id uuid references staff_users (id),
  from_studio boolean not null,
  body text not null check (length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index support_messages_thread_idx on support_messages (thread_id, id);

-- ── The studio's services: starting prices ────────────────────────────
insert into price_items (business_id, section, name, description, price_minor, currency, unit, sort_order) values
  ('bilamatata', 'Studio services', 'Website and mobile app development', 'Starting price. Business websites, online shops and apps; the exact price is in a free written quote.', 2500000, 'KES', 'and up', 30),
  ('bilamatata', 'Studio services', 'AI automation and workflow systems', 'Starting price. Enquiries, invoices, reminders and follow-ups automated; the exact price is in a free written quote.', 1500000, 'KES', 'and up', 31),
  ('bilamatata', 'Studio services', 'Data analysis and business intelligence', 'Starting price. Dashboards, sales and stock analysis, data clean-up; the exact price is in a free written quote.', 1000000, 'KES', 'and up', 32),
  ('bilamatata', 'Studio services', 'Strategic research and professional writing', 'Starting price. Market research, business plans, proposals and reports; the exact price is in a free written quote.', 500000, 'KES', 'and up', 33);

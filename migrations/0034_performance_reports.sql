-- The monthly Business Performance Report (src/reports/performance.ts): each
-- business's owners and managers get last month's report by email early on
-- the 1st. One row per business and month, so it's sent once, with what it
-- said then.

create table performance_reports (
  business_id text not null references businesses (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  report jsonb not null,
  sent_to integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (business_id, month)
);

alter table performance_reports enable row level security;
create policy business_rows on performance_reports to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on performance_reports to zaina_app;

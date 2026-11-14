-- Phase 6: the studio's onboarding tracker (src/onboarding/tracker.ts,
-- docs/ONBOARDING.md). Most steps are read from the business's real setup;
-- this keeps the path the studio chose, the steps only a person can tick,
-- and notes.

create table onboarding_trackers (
  business_id text primary key references businesses (id) on delete cascade,
  path text check (path is null or path in ('notebook', 'website', 'calendar', 'system')),
  ticks jsonb not null default '{}'::jsonb,
  note text check (note is null or length(note) <= 2000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table onboarding_trackers enable row level security;
create policy business_rows on onboarding_trackers to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on onboarding_trackers to zaina_app;

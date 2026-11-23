-- What's on at a business, posted by its team (on the dashboard, or by
-- WhatsApp): today's special, tonight's karaoke, a live band on Friday,
-- happy hour every weekday. Zaina knows it, and the business's page shows it.
-- One day (on_date), a run of days (on_date to until_date), or every week
-- on a weekday (weekday 0 = Sunday ... 6 = Saturday).
create table whats_on (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  text text not null check (char_length(text) between 2 and 200),
  on_date date,
  until_date date,
  weekday smallint check (weekday between 0 and 6),
  created_by uuid,
  created_at timestamptz not null default now(),
  check ((weekday is null) <> (on_date is null)),
  check (until_date is null or (on_date is not null and until_date >= on_date))
);
create index whats_on_business_idx on whats_on (business_id, on_date);
alter table whats_on enable row level security;
create policy business_rows on whats_on to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on whats_on to zaina_app;

-- The team can post to it from WhatsApp too.
alter table owner_changes drop constraint owner_changes_kind_check;
alter table owner_changes add constraint owner_changes_kind_check
  check (kind in ('price', 'stock', 'new_item', 'closed_days', 'delivery_area', 'whats_on'));

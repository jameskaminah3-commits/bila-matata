-- 0018_persona_notifications.sql
--
--   persona        Zaina works as a member of each business's team: she has a
--                  role on it ("guest experience host"), which the business
--                  can change. Empty: a role that fits what the business is.
--   notifications  the addresses a business adds to hear about its chats, on
--                  top of its team members' own alerts: what each gets
--                  (alerts with a link to take over, and/or the conversation
--                  written out). How many a business may add depends on its
--                  plan (plans.notification_emails; empty: 2 on Starter, 5
--                  on Full).

alter table business_settings add column persona_role text check (persona_role is null or length(btrim(persona_role)) between 2 and 60);
update business_settings set persona_role = 'sales host' where business_id = 'bilamatata';

alter table plans add column notification_emails integer check (notification_emails is null or notification_emails between 0 and 50);

create table notification_recipients (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' and length(email) <= 200),
  label text check (label is null or length(btrim(label)) between 1 and 60),
  -- Instant emails about waiting chats, callbacks, new leads and bookings, each with a link to open (and take over) the chat.
  notify_alerts boolean not null default true,
  -- The conversation written out, with each of those and when a chat is closed.
  send_transcripts boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (business_id, email)
);
create index notification_recipients_business_idx on notification_recipients (business_id, created_at);
alter table notification_recipients enable row level security;
create policy business_rows on notification_recipients to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on notification_recipients to zaina_app;

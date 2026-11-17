-- Running the business from WhatsApp (src/owner). A member of the team links
-- their own WhatsApp number from the dashboard (a code they send from that
-- phone proves it's theirs); their messages to the business's number then
-- reach Zaina as the team's assistant, not as a customer's chat. She answers
-- questions about the business and prepares changes, and nothing changes
-- until they reply YES.
--
--   staff_whatsapp   a team member's linked number, or the code to link it
--   owner_messages   the conversation with each of them
--   owner_changes    every change prepared: what it was, what it affected,
--                    who said YES or NO, and when (the log)

create table staff_whatsapp (
  business_id text not null references businesses (id) on delete cascade,
  user_id uuid not null references staff_users (id) on delete cascade,
  -- The linked number, as WhatsApp sends it (digits, country code first).
  address text check (address is null or address ~ '^[0-9]{8,15}$'),
  link_code text check (link_code is null or link_code ~ '^[0-9]{6}$'),
  link_expires_at timestamptz,
  linked_at timestamptz,
  primary key (business_id, user_id)
);
create unique index staff_whatsapp_address_idx on staff_whatsapp (business_id, address) where address is not null;
create unique index staff_whatsapp_code_idx on staff_whatsapp (business_id, link_code) where link_code is not null;

create table owner_messages (
  id bigserial primary key,
  business_id text not null references businesses (id) on delete cascade,
  user_id uuid not null references staff_users (id) on delete cascade,
  role text not null check (role in ('owner', 'zaina')),
  content text not null check (length(content) <= 4000),
  message_id text,
  created_at timestamptz not null default now()
);
create unique index owner_messages_once_idx on owner_messages (business_id, message_id) where message_id is not null;
create index owner_messages_recent_idx on owner_messages (business_id, user_id, id desc);

create table owner_changes (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  user_id uuid not null references staff_users (id) on delete cascade,
  kind text not null check (kind in ('price', 'stock', 'new_item', 'closed_days', 'delivery_area')),
  payload jsonb not null,
  summary text not null check (length(summary) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'applied', 'cancelled', 'expired', 'failed')),
  result text check (result is null or length(result) <= 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz
);
create index owner_changes_recent_idx on owner_changes (business_id, created_at desc);
create index owner_changes_pending_idx on owner_changes (business_id, user_id) where status = 'pending';

alter table staff_whatsapp enable row level security;
alter table owner_messages enable row level security;
alter table owner_changes enable row level security;
create policy business_rows on staff_whatsapp to zaina_app using (business_id = app_business()) with check (business_id = app_business());
create policy business_rows on owner_messages to zaina_app using (business_id = app_business()) with check (business_id = app_business());
create policy business_rows on owner_changes to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on staff_whatsapp, owner_messages, owner_changes to zaina_app;
grant usage on sequence owner_messages_id_seq to zaina_app;

-- Signing in in two steps: after the password, a 6-digit code emailed to the
-- account (src/staff/two-step.ts). Also the one-time hand-over after signing
-- in with Google, and devices a person chose to trust for 30 days. Codes and
-- device tokens are stored only as keyed hashes. These are the platform's own
-- tables, read on the owner connection: the business role can't see them.

create table staff_sign_in_codes (
  id uuid primary key,
  user_id uuid not null references staff_users (id) on delete cascade,
  kind text not null check (kind in ('code', 'handoff')),
  code_hash text not null,
  target text not null default 'app' check (target in ('app', 'admin')),
  attempts integer not null default 0,
  sends integer not null default 1,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index staff_sign_in_codes_user_idx on staff_sign_in_codes (user_id, created_at desc);
create index staff_sign_in_codes_handoff_idx on staff_sign_in_codes (code_hash) where kind = 'handoff';
alter table staff_sign_in_codes enable row level security;

create table staff_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references staff_users (id) on delete cascade,
  token_hash text not null unique,
  -- A new password (which bumps the account's token version) forgets every trusted device.
  token_version integer not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null
);
create index staff_trusted_devices_user_idx on staff_trusted_devices (user_id);
alter table staff_trusted_devices enable row level security;

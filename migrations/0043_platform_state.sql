-- What the platform keeps for itself, never a business's:
-- platform_keys: keys it makes on its own (the web push key pair), the
--   private half sealed with the platform's secrets key;
-- platform_signals: when an outside service last reached it (Meta verifying
--   the WhatsApp webhook, Meta's last signed delivery), for the set-up page.
create table platform_keys (
  name text primary key,
  public_value text not null,
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  key_id text not null,
  created_at timestamptz not null default now()
);
alter table platform_keys enable row level security;

create table platform_signals (
  name text primary key,
  at timestamptz not null default now()
);
alter table platform_signals enable row level security;

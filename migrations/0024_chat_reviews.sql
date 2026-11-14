-- Phase 5: the studio reads real chats and marks each one good or an issue,
-- with what went wrong, and tracks the fix (src/review/routes.ts).

create table chat_reviews (
  id bigserial primary key,
  business_id text not null references businesses (id) on delete cascade,
  session_id uuid not null,
  verdict text not null check (verdict in ('good', 'issue')),
  tags text[] not null default '{}',
  note text check (note is null or length(note) <= 1000),
  reviewer uuid,
  fixed_at timestamptz,
  fixed_note text check (fixed_note is null or length(fixed_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, session_id),
  foreign key (business_id, session_id) references chat_sessions (business_id, id) on delete cascade
);
create index chat_reviews_open_idx on chat_reviews (business_id) where verdict = 'issue' and fixed_at is null;
alter table chat_reviews enable row level security;
create policy business_rows on chat_reviews to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on chat_reviews to zaina_app;
grant usage on sequence chat_reviews_id_seq to zaina_app;

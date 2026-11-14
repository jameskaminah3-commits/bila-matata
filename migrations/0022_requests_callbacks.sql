-- 0022_requests_callbacks.sql
--
-- What a customer leaves for the team is now one of three kinds:
--   lead       get back to me (as before)
--   request    something the business doesn't list, passed on instead of a no
--   callback   call me at a time I chose; the team is reminded when it's due

alter table leads add column kind text not null default 'lead' check (kind in ('lead', 'request', 'callback'));
alter table leads add column callback_at timestamptz;
alter table leads add column callback_window text check (callback_window is null or length(callback_window) <= 120);
alter table leads add column callback_reminded_at timestamptz;
create index leads_callbacks_due_idx on leads (callback_at) where kind = 'callback' and callback_reminded_at is null;

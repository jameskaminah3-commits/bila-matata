-- 0016_studio_invoices.sql
--
-- The studio's own invoices, paid on bilamatata.co.ke/pay: project work
-- (websites and apps, automation, data analysis, research and writing) and
-- Zaina set-up fees. Zaina's monthly plans keep their own invoices (0012),
-- paid from the dashboard.
--
-- These are the platform's own rows, not a business's: only the owner
-- connection reads or writes them (nothing is granted to zaina_app).
--
--   studio_invoices          what a client owes: a reference they can't guess
--                            (BM- and 8 characters), who it's for, what for,
--                            how much, and how it was paid.
--   studio_invoice_payments  each attempt to pay one through Paystack. The
--                            reference starts "bm_", which is how the
--                            platform's webhook tells them apart.
--
-- Also: the studio's own price list (what its Zaina quotes on the website).

create table studio_invoices (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^BM-[A-Z2-9]{8}$'),
  client_name text not null check (length(btrim(client_name)) between 1 and 120),
  client_email text check (client_email is null or client_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- What the invoice is for, as the client reads it on the payment page and Paystack's receipt.
  description text not null check (length(btrim(description)) between 3 and 300),
  category text not null check (category in ('zaina_setup', 'software', 'automation', 'data', 'research', 'other')),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000000),
  currency text not null default 'KES' check (currency in ('KES', 'USD')),
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  due_at timestamptz,
  paid_at timestamptz,
  -- How it was paid: through Paystack, or by hand (bank or M-Pesa, recorded by the studio).
  method text check (method is null or method in ('paystack', 'manual')),
  -- Paystack's transaction id, or the receipt of a payment made by hand.
  receipt text check (receipt is null or length(receipt) <= 120),
  notes text check (notes is null or length(notes) <= 1000),
  created_by uuid references staff_users (id),
  recorded_by uuid references staff_users (id),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'paid') = (paid_at is not null and method is not null)),
  check ((status = 'void') = (voided_at is not null))
);
create index studio_invoices_list_idx on studio_invoices (created_at desc);

create table studio_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references studio_invoices (id) on delete cascade,
  reference text not null unique check (reference ~ '^bm_[0-9a-f]{24}$'),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('KES', 'USD')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  payer_email text,
  authorization_url text,
  receipt text,
  -- Why it failed, or what's wrong with it (paid twice: refund it in Paystack).
  note text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index studio_invoice_payments_invoice_idx on studio_invoice_payments (invoice_id, created_at desc);
create index studio_invoice_payments_pending_idx on studio_invoice_payments (created_at) where status = 'pending';

-- ── The studio's price list: what its Zaina quotes ────────────────────
insert into price_items (business_id, section, name, description, price_minor, currency, unit, sort_order) values
  ('bilamatata', 'Zaina AI', 'Starter Sales Concierge', 'Answers customers day and night from your catalogue and price list, and hands leads to your team on WhatsApp.', 670000, 'KES', 'a month', 10),
  ('bilamatata', 'Zaina AI', 'Starter Sales Concierge set-up', 'One-off: we load your catalogue, prices and answers, and install the chat on your website.', 1000000, 'KES', 'once', 11),
  ('bilamatata', 'Zaina AI', 'Full Booking & Quote Engine', 'Everything in Starter, plus live availability checks, exact quotes, and bookings created from start to finish with deposits by M-Pesa or card.', 1100000, 'KES', 'a month', 20),
  ('bilamatata', 'Zaina AI', 'Full Booking & Quote Engine set-up', 'One-off: we set up what you sell, your availability, deposit rules and payments, and install the chat.', 2000000, 'KES', 'once', 21);

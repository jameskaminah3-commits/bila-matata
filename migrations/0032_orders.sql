-- Orders, end to end (src/orders): an order from the catalogue is its own
-- record, as a booking is. Zaina prices it (items, the delivery zone's fee),
-- holds the stock it takes, and sends the business's own payment link; a
-- payment confirms it, as it confirms a booking. The team moves it on (out
-- for delivery, ready for collection, done) and the customer hears each step.
--
--   orders               one per order; lines as priced when it was placed
--   payments.order_id    a payment is for a booking or for an order, never both
--   price_items.stock_quantity   how many are left (null: not counted)
--   business_settings.order_settings   delivery zones and fees, collection,
--                        minimum order, pay on delivery, who confirms, the hold

create table orders (
  id uuid primary key default gen_random_uuid(),
  business_id text not null references businesses (id) on delete cascade,
  reference text not null check (reference ~ '^ORD-[0-9A-F]{6}$'),
  session_id uuid,
  status text not null check (status in ('requested', 'awaiting_payment', 'confirmed', 'out_for_delivery', 'ready_for_collection', 'completed', 'cancelled', 'expired')),
  customer_name text not null check (length(customer_name) between 1 and 120),
  customer_phone text check (customer_phone is null or length(customer_phone) <= 40),
  customer_email text check (customer_email is null or length(customer_email) <= 200),
  customer_notes text check (customer_notes is null or length(customer_notes) <= 500),
  -- [{ itemId, name, quantity, unitMinor, priceText, lineTotalMinor }]: as priced when placed.
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  currency text not null check (currency in ('KES', 'USD')),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  delivery_fee_minor bigint not null default 0 check (delivery_fee_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  -- The customer pays on delivery or collection (cash or M-Pesa), as the business allows.
  pay_on_delivery boolean not null default false,
  -- A price was a range: the team set the total when accepting.
  priced_by_team boolean not null default false,
  fulfilment text not null check (fulfilment in ('delivery', 'collection')),
  zone text check (zone is null or length(zone) <= 80),
  address text check (address is null or length(address) <= 200),
  wanted text check (wanted is null or length(wanted) <= 120),
  -- The secret in the order's payment link.
  pay_token text not null unique,
  -- Until when the stock is kept for an unpaid order.
  hold_expires_at timestamptz,
  -- Whether the order's counted items are taken out of stock right now.
  stock_reserved boolean not null default false,
  -- Something for the team to sort out (a payment after the stock ran out).
  conflict text,
  staff_note text check (staff_note is null or length(staff_note) <= 500),
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  unique (business_id, id),
  unique (business_id, reference)
);
create index orders_list_idx on orders (business_id, status, created_at desc);
create index orders_session_idx on orders (business_id, session_id) where session_id is not null;
create index orders_holds_idx on orders (hold_expires_at) where status = 'awaiting_payment';
create unique index orders_idempotency_idx on orders (business_id, idempotency_key) where idempotency_key is not null;

alter table orders enable row level security;
create policy business_rows on orders to zaina_app using (business_id = app_business()) with check (business_id = app_business());
grant select, insert, update, delete on orders to zaina_app;

alter table payments alter column booking_id drop not null;
alter table payments add column order_id uuid;
alter table payments add constraint payments_order_fk foreign key (business_id, order_id) references orders (business_id, id) on delete cascade;
alter table payments add constraint payments_one_target check ((booking_id is null) <> (order_id is null));
create index payments_order_idx on payments (business_id, order_id) where order_id is not null;

alter table price_items add column stock_quantity integer check (stock_quantity is null or stock_quantity between 0 and 1000000);

alter table business_settings
  add column order_settings jsonb check (order_settings is null or jsonb_typeof(order_settings) = 'object');

-- An order's payment link, like a booking's, finds its business by its token.
create or replace function payment_route(kind text, token text) returns text
  language sql stable security definer
  set search_path = public, pg_temp
  as $$
    select case kind
      when 'pay' then (select business_id from bookings where pay_token = token limit 1)
      when 'order' then (select business_id from orders where pay_token = token limit 1)
      when 'mpesa' then (select business_id from payments where callback_token = token limit 1)
      when 'paystack' then (select business_id from payments where method = 'paystack' and provider_reference = token limit 1)
    end
  $$;

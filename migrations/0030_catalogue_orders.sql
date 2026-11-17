-- The catalogue and orders (src/prices, src/orders):
--
--   price_items   whether an item is in stock right now; where it came from
--                 (typed in by the team, or the business's own product feed,
--                 kept in step every day), its id there, and its page.
--   leads         an order a customer placed through Zaina is a lead of kind
--                 'order', with its lines and total in details (the team
--                 confirms it; the customer pays the business directly).
--   business_settings.catalogue_feed   the feed's address and last reading.

alter table price_items
  add column available boolean not null default true,
  add column source text not null default 'manual' check (source in ('manual', 'feed')),
  add column external_id text check (external_id is null or length(external_id) <= 200),
  add column url text check (url is null or (url like 'https://%' and length(url) <= 500));

alter table leads drop constraint if exists leads_kind_check;
alter table leads add constraint leads_kind_check check (kind in ('lead', 'request', 'callback', 'order'));
alter table leads add column details jsonb check (details is null or jsonb_typeof(details) = 'object');

alter table business_settings
  add column catalogue_feed jsonb check (catalogue_feed is null or jsonb_typeof(catalogue_feed) = 'object');

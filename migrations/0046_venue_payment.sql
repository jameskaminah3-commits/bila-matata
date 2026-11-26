-- How guests pay the business at its place, as the owner chooses to show it
-- on the menu page and the printed table cards: an M-Pesa Buy Goods till, or
-- a Paybill number with its account, and the name M-Pesa shows so guests can
-- check they're paying the right business. Money goes straight to the
-- business; this service never handles it.
alter table business_settings add column venue_payment jsonb;

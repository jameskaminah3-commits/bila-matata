-- 0020_qr_destination_cards.sql
--
--   qr destination  where a printed code sends a customer: the business's own
--                   page on this service, its website (the chat opens), or its
--                   WhatsApp number. The code itself never changes, so what is
--                   printed stays good when the business changes this.
--   business cards  the details printed on the business's cards, and which
--                   design; scans of a card are counted on their own.

alter table business_settings add column qr_destination text not null default 'page' check (qr_destination in ('page', 'website', 'whatsapp'));
alter table business_settings add column card_details jsonb;

alter table front_door_days drop constraint front_door_days_source_check;
alter table front_door_days add constraint front_door_days_source_check check (source in ('qr', 'link', 'card'));

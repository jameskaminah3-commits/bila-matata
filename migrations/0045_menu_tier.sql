-- The Menu plan, for restaurants, bars and hotels that want their menu
-- before Zaina: the branded menu page, its QR code, table cards and What's
-- on, with no chat and no WhatsApp replies. A third tier beside Starter and
-- Full; nothing already stored changes.
alter table businesses drop constraint if exists businesses_tier_check;
alter table businesses add constraint businesses_tier_check check (tier in ('menu', 'starter', 'full'));
alter table plans drop constraint if exists plans_tier_check;
alter table plans add constraint plans_tier_check check (tier in ('menu', 'starter', 'full'));

-- The studio's own price list, so its Zaina quotes the Menu plan too.
insert into price_items (business_id, section, name, description, price_minor, currency, unit, sort_order)
select 'bilamatata', 'Menu plan', 'Menu plan', 'For restaurants, bars and hotels: a branded QR menu page with What''s on, table cards and business cards, updated by your team. No chat.', 490000, 'KES', 'a month', 5
where exists (select 1 from businesses where id = 'bilamatata')
  and not exists (select 1 from price_items where business_id = 'bilamatata' and name = 'Menu plan');
insert into price_items (business_id, section, name, description, price_minor, currency, unit, sort_order)
select 'bilamatata', 'Menu plan', 'Menu plan set-up', 'One-off: we load your menu, set it in your brand and prepare your QR code and table cards.', 500000, 'KES', 'once', 6
where exists (select 1 from businesses where id = 'bilamatata')
  and not exists (select 1 from price_items where business_id = 'bilamatata' and name = 'Menu plan set-up');

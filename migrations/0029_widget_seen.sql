-- Where a business's chat was last seen on the web (src/widget/install.ts):
-- the last website it opened on, and the websites it was refused on because
-- they aren't on the business's list yet, so the dashboard can say whether the
-- chat is really on its website and what to fix. Addresses only, never visitors.

alter table business_settings
  add column widget_seen jsonb
    check (widget_seen is null or jsonb_typeof(widget_seen) = 'object');

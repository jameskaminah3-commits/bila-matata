-- Businesses shown on bilamatata.com under "Businesses powered by Zaina".
-- Off for every business: only the studio turns it on, in /admin, once the
-- business has agreed to be shown. Nothing already stored changes.
alter table businesses add column if not exists featured_on_studio boolean not null default false;

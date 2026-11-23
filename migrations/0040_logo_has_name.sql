-- When a business's logo already spells its name ("TAPAS GOLD"), its page
-- shows the logo large, as the heading, instead of a small logo and the same
-- name again in type.
alter table business_settings
  add column logo_has_name boolean not null default false;

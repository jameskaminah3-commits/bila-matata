-- How a business's page looks to its customers: following each guest's phone
-- (light or dark), or always light, or always dark (a club in low light).
alter table business_settings
  add column menu_style text not null default 'auto' check (menu_style in ('auto', 'light', 'dark'));

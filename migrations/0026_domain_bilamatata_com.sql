-- The studio moves to bilamatata.com. Its own chat (the 'bilamatata'
-- business) is allowed on the new address as well as the old one, links to
-- the new address may be passed on, and its website and email follow, unless
-- someone already changed them by hand. Nothing is removed.

update businesses set allowed_origins = allowed_origins || array['https://bilamatata.com']
where id = 'bilamatata' and not ('https://bilamatata.com' = any(allowed_origins));

update businesses set allowed_origins = allowed_origins || array['https://www.bilamatata.com']
where id = 'bilamatata' and not ('https://www.bilamatata.com' = any(allowed_origins));

update business_settings set allowed_link_hosts = allowed_link_hosts || array['bilamatata.com']
where business_id = 'bilamatata' and not ('bilamatata.com' = any(allowed_link_hosts));

update business_settings set website_url = 'https://bilamatata.com'
where business_id = 'bilamatata' and website_url = 'https://bilamatata.co.ke';

update business_settings set support_email = 'hello@bilamatata.com'
where business_id = 'bilamatata' and support_email = 'hello@bilamatata.co.ke';

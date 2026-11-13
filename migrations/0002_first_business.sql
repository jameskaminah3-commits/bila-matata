-- 0002_first_business.sql
--
-- Bila Matata, the studio that runs this service, is business number one: the
-- Zaina on bilamatata.co.ke answers visitors about the studio's own work
-- (Zaina itself, websites and apps, automation, data analysis, research).
-- Starting settings:
--   staffed hours   08:00–18:00 Kenya time, Monday to Saturday
--   unclaimed chat  back to Zaina, with a callback request, after 10 minutes
--   model budget    5 million tokens a day
--   transcripts     deleted 90 days after the last message
-- The public key is what the website's widget sends; it is not a secret.

insert into businesses (
  id, name, public_key, allowed_origins, time_zone, staffed_hours,
  unclaimed_timeout_minutes, daily_token_cap, retention_days
) values (
  'bilamatata',
  'Bila Matata',
  'pk_bilamatata_live',
  array['https://bilamatata.co.ke', 'https://www.bilamatata.co.ke'],
  'Africa/Nairobi',
  '{"days": [1, 2, 3, 4, 5, 6], "open": "08:00", "close": "18:00"}',
  10,
  5000000,
  90
);

-- What a business does through Zaina, in capabilities it can combine
-- (src/capabilities/catalog.ts): a hotel can take room bookings, table
-- reservations and spa appointments, and arrange airport transfers. Empty:
-- its capabilities follow from its type, as before.

alter table business_settings
  add column capabilities jsonb
    check (capabilities is null or (jsonb_typeof(capabilities) = 'object' and jsonb_typeof(capabilities -> 'enabled') = 'array'));

-- 0021_playbooks_interview_learning.sql
--
--   industry        what kind of business it is (stays, salon, restaurant,
--                   clinic, shop, services, other): Zaina works by that
--                   industry's playbook. Empty: it follows from the type.
--   interview       the setup interview's answers (written up as one
--                   knowledge document Zaina searches).
--   website sync    the website Zaina reads, and whether it is read again
--                   every week, so she keeps in step with it.
--   learning        a question nobody could answer is resolved when the
--                   team answers it (the answer becomes knowledge) or
--                   dismisses it.

alter table business_settings add column industry text check (industry is null or industry in ('stays', 'salon', 'restaurant', 'clinic', 'shop', 'services', 'other'));
alter table business_settings add column interview jsonb;
alter table business_settings add column website_sync jsonb;

alter table knowledge_misses add column resolution text check (resolution is null or resolution in ('answered', 'dismissed'));
alter table knowledge_misses add column resolved_at timestamptz;
alter table knowledge_misses add column resolved_by uuid;
create index knowledge_misses_open_idx on knowledge_misses (business_id, created_at desc) where resolution is null;

-- Businesses the platform team created went live at once, but the moment
-- wasn't recorded: resuming one after a pause sent it back to setting up,
-- its page dark. They went live when they were created.
update businesses
  set went_live_at = created_at
  where went_live_at is null and source = 'platform' and status <> 'onboarding';

-- Columns the re-test dispatch needs to drive email cadence:
--   sent_at          — when the "your re-test is ready" email went out
--   reminder_sent_at — when the single 3-day reminder went out (null = none)
-- Reset each time a re-test is (re)queued so a new cycle starts clean.

alter table public.retests
  add column sent_at timestamptz,
  add column reminder_sent_at timestamptz;

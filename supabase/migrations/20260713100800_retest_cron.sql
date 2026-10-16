-- Daily schedule for the retest-dispatch edge function (spec: "Daily cron
-- (Edge Function)").
--
-- pg_cron fires net.http_post (pg_net) against the function's URL once a day.
-- The URL and shared secret aren't known at migration time and differ per
-- environment, so they're read from database settings. When they're unset
-- (e.g. local `db reset`), scheduling is skipped cleanly — the loop is still
-- exercised locally by invoking the function directly.
--
-- To enable in production, set the two settings then re-run schedule_retest_dispatch():
--   alter database postgres set app.settings.retest_dispatch_url =
--     'https://<project-ref>.functions.supabase.co/retest-dispatch';
--   alter database postgres set app.settings.retest_dispatch_secret = '<CRON_SECRET>';
--   select public.schedule_retest_dispatch();

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.schedule_retest_dispatch()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := current_setting('app.settings.retest_dispatch_url', true);
  v_secret text := current_setting('app.settings.retest_dispatch_secret', true);
  v_job_name text := 'retest-dispatch-daily';
begin
  -- Clear any previous definition so this is idempotent.
  perform cron.unschedule(v_job_name)
  where exists (select 1 from cron.job where jobname = v_job_name);

  if v_url is null or v_url = '' then
    return 'skipped: app.settings.retest_dispatch_url is not set';
  end if;

  perform cron.schedule(
    v_job_name,
    '0 8 * * *', -- 08:00 daily (UTC in local, server tz in prod)
    format(
      $cmd$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{}'::jsonb
      )$cmd$,
      v_url,
      coalesce(v_secret, '')
    )
  );

  return 'scheduled: ' || v_job_name;
end;
$$;

-- Attempt to schedule now; no-ops locally where the settings are unset.
do $$
begin
  raise notice '%', public.schedule_retest_dispatch();
end $$;

-- Scheduling for the two edge functions.
--
-- Both jobs fire HOURLY. The functions decide whether it is the right moment
-- (default 8am Australia/Sydney, so daylight saving needs no cron edits) and
-- the weekly digest uses claim_job_run so it goes out once per week no matter
-- how many hourly pings land inside the send window.
--
-- The function URL and secret are read from database settings, which differ per
-- deployment. Re-running the scheduler with the settings unset leaves any
-- existing job alone.
--
-- Enable per deployment:
--   alter database postgres set app.settings.retest_dispatch_url = 'https://<ref>.functions.supabase.co/retest-dispatch';
--   alter database postgres set app.settings.retest_dispatch_secret = '<CRON_SECRET>';
--   select public.schedule_retest_dispatch();
--   (and the same pair with weekly_digest_* and select public.schedule_weekly_digest();)

create function public._schedule_edge_job(p_job text, p_url_setting text, p_secret_setting text)
returns text language plpgsql security definer set search_path = public as
$$
declare
  v_url text := current_setting(p_url_setting, true);
  v_secret text := current_setting(p_secret_setting, true);
begin
  if v_url is null or v_url = '' then
    return 'skipped: ' || p_url_setting || ' is not set';
  end if;
  if v_secret is null or v_secret = '' then
    return 'skipped: ' || p_secret_setting || ' is not set';
  end if;

  perform cron.unschedule(p_job) where exists (select 1 from cron.job where jobname = p_job);

  perform cron.schedule(
    p_job,
    '0 * * * *',
    format(
      $cmd$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body := '{}'::jsonb)$cmd$,
      v_url, v_secret)
  );
  return 'scheduled: ' || p_job;
end;
$$;

create function public.schedule_retest_dispatch()
returns text language sql security definer set search_path = public as
$$ select public._schedule_edge_job('retest-dispatch-hourly',
     'app.settings.retest_dispatch_url', 'app.settings.retest_dispatch_secret') $$;

create function public.schedule_weekly_digest()
returns text language sql security definer set search_path = public as
$$ select public._schedule_edge_job('weekly-digest-hourly',
     'app.settings.weekly_digest_url', 'app.settings.weekly_digest_secret') $$;

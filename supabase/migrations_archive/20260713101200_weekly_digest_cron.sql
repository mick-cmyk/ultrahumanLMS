-- Weekly schedule for the weekly-digest edge function (spec Phase 4). Same
-- deploy-gated pattern as the re-test cron: reads the function URL + secret
-- from database settings, skips cleanly locally.
--
-- To enable in production:
--   alter database postgres set app.settings.weekly_digest_url =
--     'https://<project-ref>.functions.supabase.co/weekly-digest';
--   alter database postgres set app.settings.weekly_digest_secret = '<CRON_SECRET>';
--   select public.schedule_weekly_digest();

create or replace function public.schedule_weekly_digest()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := current_setting('app.settings.weekly_digest_url', true);
  v_secret text := current_setting('app.settings.weekly_digest_secret', true);
  v_job_name text := 'weekly-digest-monday';
begin
  perform cron.unschedule(v_job_name)
  where exists (select 1 from cron.job where jobname = v_job_name);

  if v_url is null or v_url = '' then
    return 'skipped: app.settings.weekly_digest_url is not set';
  end if;

  perform cron.schedule(
    v_job_name,
    '0 9 * * 1', -- 09:00 every Monday
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

do $$
begin
  raise notice '%', public.schedule_weekly_digest();
end $$;

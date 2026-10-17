-- One call that points both hourly jobs at a deployment's edge functions.
-- scripts/email-setup.ts calls it with the service role, so nothing has to be
-- pasted into the SQL editor and no secret is stored as a database setting:
-- the URL and secret are embedded in each cron job's command when it is
-- scheduled. Safe to run again; it replaces both jobs.

create function public.schedule_edge_jobs(p_functions_base_url text, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_base text := regexp_replace(coalesce(p_functions_base_url, ''), '/+$', '');
begin
  if v_base = '' or p_secret is null or length(p_secret) < 16 then
    raise exception 'a functions base URL and a secret of at least 16 characters are required';
  end if;

  -- Transaction-local settings, read straight back by the two scheduler functions.
  perform set_config('app.settings.retest_dispatch_url', v_base || '/retest-dispatch', true);
  perform set_config('app.settings.retest_dispatch_secret', p_secret, true);
  perform set_config('app.settings.weekly_digest_url', v_base || '/weekly-digest', true);
  perform set_config('app.settings.weekly_digest_secret', p_secret, true);

  return jsonb_build_object(
    'retest_dispatch', public.schedule_retest_dispatch(),
    'weekly_digest', public.schedule_weekly_digest()
  );
end;
$$;

revoke all on function public.schedule_edge_jobs(text, text) from public, anon, authenticated;
grant execute on function public.schedule_edge_jobs(text, text) to service_role;

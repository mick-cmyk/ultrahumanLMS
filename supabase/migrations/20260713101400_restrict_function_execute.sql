-- Harden function execution.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, which on
-- Supabase means the `anon` role can call them over /rest/v1/rpc without
-- signing in. Supabase's own security advisor flags this. Nothing in this
-- schema should be reachable logged-out, so:
--   * learner-facing functions  -> authenticated (+ service_role)
--   * token-scoped / cron-only  -> service_role only
--
-- Written as a loop so it also covers functions added by earlier migrations
-- without having to list every signature by hand. Re-run it after adding any
-- new function.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon', fn.sig);

    if fn.proname in ('build_retest','grade_retest','users_in_scope_of',
                      'report_summary_for','digest_recipients',
                      'schedule_retest_dispatch','schedule_weekly_digest') then
      execute format('grant execute on function %s to service_role', fn.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', fn.sig);
    end if;
  end loop;
end $$;

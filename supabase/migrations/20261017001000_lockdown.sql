-- Final grants. Everything is denied first, then the app's needs are listed
-- once, explicitly. Review items M1 (no direct progress writes), M5 (no
-- internal functions reachable by learners) and the anon privileges.
--
-- Rule for future migrations: a new table or function is born with no access
-- (see the foundation migration). Add its grant here or in its own migration.

-- Tables -------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant select on public.units, public.users, public.user_scopes, public.courses,
                public.modules, public.lessons, public.quizzes, public.assignments,
                public.lesson_progress, public.retests
  to authenticated;

-- Admin writes go through the admin's own session, gated by RLS. Column lists
-- keep ids, paths, emails and demo tags out of reach.
grant insert (parent_id, kind, name, state, suburb, logo_url, brand_color)
  on public.units to authenticated;
grant update (parent_id, kind, name, state, suburb, logo_url, brand_color, active)
  on public.units to authenticated;
grant update (full_name, unit_id, role, active) on public.users to authenticated;
grant insert, delete on public.user_scopes to authenticated;
grant insert, update, delete on public.courses, public.modules, public.lessons,
                                public.quizzes, public.assignments
  to authenticated;
-- lesson_progress, retests: select only. retest_tokens, app_settings,
-- job_runs: nothing.

-- Functions ----------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Used inside RLS policies (the policy runs as the caller, so the caller needs
-- execute). Each reads auth.uid() itself; none takes a viewer id.
grant execute on function
  public.app_role(),
  public.in_my_scope(uuid),
  public.visible_unit(uuid),
  public.user_sees_course(uuid)
  to authenticated;

-- Called by the app as the logged-in user.
grant execute on function
  public.record_watch_progress(uuid, double precision),
  public.get_lesson_quiz(uuid),
  public.record_quiz_attempt(uuid, jsonb, integer),
  public.my_open_retests(integer),
  public.build_my_retest(uuid, integer, integer),
  public.grade_my_retest(uuid, jsonb, numeric, integer, integer),
  public.report_course_rollup(uuid),
  public.report_courses_summary(),
  public.users_in_reporting_scope(),
  public.preview_rule_reach(jsonb),
  public.can_manage_unit(uuid),
  public.can_manage_user(uuid),
  public.can_provision_email(text, uuid),
  public.set_user_active(uuid, boolean),
  public.my_brand()
  to authenticated;

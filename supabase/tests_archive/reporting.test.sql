-- pgTAP tests for Phase 3 reporting + scope.
-- Against the seeded local db, then `npm run test:db`. Rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.course(p_title text) returns uuid language sql as
  $$ select id from public.courses where title = p_title $$;

create function pg_temp.summary(p_title text)
returns table(assigned bigint, completed bigint, verified bigint)
language sql as $$
  select assigned, completed, retention_verified
  from public.report_courses_summary() where title = p_title
$$;

do $$
begin
  if pg_temp.course('LG OLED 2026 Range') is null then
    raise exception 'Seed data missing — run supabase db reset then npm run seed first';
  end if;
end $$;

-- ---- Admin: sees everyone ----
select pg_temp.as_user('mick@example.com');

select is((select assigned from pg_temp.summary('LG OLED 2026 Range')), 10::bigint,
  'admin: OLED reaches 10 (JB VIC+NSW incl. managers, HN Frankston, Mia; Emma excluded)');
select is((select assigned from pg_temp.summary('Council Venue Induction')), 3::bigint,
  'admin: induction reaches all 3 council staff');
select is((select completed from pg_temp.summary('LG OLED 2026 Range')), 0::bigint,
  'admin: nobody has completed OLED yet');
select is(
  public.preview_rule_reach(jsonb_build_object(
    'org_ids', jsonb_build_array((select id from public.orgs where name='JB Hi-Fi')::text),
    'states', '["VIC","NSW"]'::jsonb)),
  7::bigint, 'admin: JB VIC+NSW rule reaches 7 (6 learners + the Chadstone manager)');
select is(public.preview_rule_reach('{"all":true}'::jsonb),
  (select count(*) from public.users where active), 'admin: all:true reaches every active user');

-- ---- Coordinator (Jason, NARTA): group scope only ----
select pg_temp.as_user('jason@example.com');

select is((select assigned from pg_temp.summary('LG OLED 2026 Range')), 10::bigint,
  'coordinator: OLED reach unchanged (all matched users are in NARTA orgs)');
select is((select assigned from pg_temp.summary('Council Venue Induction')), 0::bigint,
  'coordinator: council induction is invisible — council is not in the group');
select is(public.preview_rule_reach('{"all":true}'::jsonb), 0::bigint,
  'coordinator: preview_rule_reach is admin-only');

-- ---- Manager (Priya, JB Chadstone): store scope ----
select pg_temp.as_user('mgr.chadstone@example.com');

select is(
  (select count(*) from public.report_course_rollup(pg_temp.course('LG OLED 2026 Range'))),
  3::bigint, 'manager: OLED rollup is just the 3 active Chadstone staff');
select is(
  (select count(*) from public.report_course_rollup(pg_temp.course('LG OLED 2026 Range'))
   where store_name <> 'JB Hi-Fi Chadstone'),
  0::bigint, 'manager: never sees another store');

-- ---- Course completion reflects progress ----
select pg_temp.as_user('ava.jb.south@example.com');
select public.record_watch_progress((select id from public.lessons where title='Why OLED blacks matter'), 0.95);
select public.record_watch_progress((select id from public.lessons where title='OLED vs Mini-LED in 60 seconds'), 0.95);
select public.record_quiz_attempt((select id from public.lessons where title='Why OLED blacks matter'),
  '{"oled-blacks-q1":1,"oled-blacks-q2":1,"oled-blacks-q3":1}'::jsonb);

select is(public.course_is_complete(
  (select id from public.users where email='ava.jb.south@example.com'),
  pg_temp.course('LG OLED 2026 Range')),
  false, 'course incomplete with only one lesson quiz passed');

select public.record_quiz_attempt((select id from public.lessons where title='OLED vs Mini-LED in 60 seconds'),
  '{"oled-mini-q1":1,"oled-mini-q2":1,"oled-mini-q3":1}'::jsonb);

select is(public.course_is_complete(
  (select id from public.users where email='ava.jb.south@example.com'),
  pg_temp.course('LG OLED 2026 Range')),
  true, 'course complete once every lesson is watched + quiz-passed');

select * from finish();
rollback;

-- Self-contained: builds its own fixtures, never relies on seed data.
begin;
select plan(1);  -- replaced by no_plan semantics in the shim

create function pg_temp.rows_changed(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
grant execute on function pg_temp.rows_changed(text) to public;

-- ---------------------------------------------------------------- fixtures
-- Units: S (supplier root) > B (retail brand) > R (state rep) > T1, T2 (stores)
--                           > B2 (other brand) > T3
insert into public.units (id, parent_id, kind, name) values
 ('a0000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'brand', 'B'),
 ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'region', 'R'),
 ('a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'store', 'T1'),
 ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', 'store', 'T2'),
 ('a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'brand', 'B2'),
 ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000006', 'store', 'T3');

insert into auth.users (id, email) values
 ('b0000000-0000-0000-0000-000000000001', 'admin@t.test'),
 ('b0000000-0000-0000-0000-000000000002', 'l1viewer@t.test'),
 ('b0000000-0000-0000-0000-000000000003', 'l2mgr@t.test'),
 ('b0000000-0000-0000-0000-000000000004', 'l3mgr@t.test'),
 ('b0000000-0000-0000-0000-000000000005', 'floor1@t.test'),
 ('b0000000-0000-0000-0000-000000000006', 'floor3@t.test'),
 ('b0000000-0000-0000-0000-000000000007', 'direct@t.test');

update public.users set role='admin',   unit_id='a0000000-0000-0000-0000-000000000001' where id='b0000000-0000-0000-0000-000000000001';
update public.users set role='viewer',  unit_id='a0000000-0000-0000-0000-000000000002' where id='b0000000-0000-0000-0000-000000000002';
update public.users set role='manager', unit_id='a0000000-0000-0000-0000-000000000003' where id='b0000000-0000-0000-0000-000000000003';
update public.users set role='manager', unit_id='a0000000-0000-0000-0000-000000000004' where id='b0000000-0000-0000-0000-000000000004';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000004' where id='b0000000-0000-0000-0000-000000000005';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000007' where id='b0000000-0000-0000-0000-000000000006';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000001' where id='b0000000-0000-0000-0000-000000000007';
insert into public.user_scopes values
 ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002'),
 ('b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000003'),
 ('b0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000004');

insert into public.courses (id, title, published) values ('c0000000-0000-0000-0000-000000000001','C',true);
insert into public.modules (id, course_id, title) values ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','M');
insert into public.lessons (id, module_id, title) values ('e0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','L');
insert into public.quizzes (lesson_id, pass_mark, questions) values ('e0000000-0000-0000-0000-000000000001', 0.8,
 '[{"id":"q1","text":"a","options":["x","y"],"correct_index":0,"explanation":"e1"},
   {"id":"q2","text":"b","options":["x","y"],"correct_index":1,"explanation":"e2"}]');
insert into public.assignments (course_id, rule) values ('c0000000-0000-0000-0000-000000000001', '{"unit_ids":["a0000000-0000-0000-0000-000000000003"]}');

-- ------------------------------------------------------ path maintenance
select is((select path from public.units where id='a0000000-0000-0000-0000-000000000004'),
  array['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004']::uuid[],
  'path holds the ancestor chain');
select throws_ok($$insert into public.units (kind,name) values ('supplier','Second root')$$, '23505', null, 'only one root');

-- ------------------------------------------------ privilege baseline (M1/M5)
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')
             -- The exceptions: the public sign-up page (20261124000100_self_registration.sql)
             -- and the public welcome page wording (20261127000100_site_text.sql).
             and p.proname not in ('registration_options', 'welcome_text')), 0,
  'anon can execute no public function except the sign-up page options and welcome wording');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind in ('r','v') and
           (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert'))), 0,
  'anon has no table access');
select ok(not has_function_privilege('authenticated', 'public.user_matches_rule(uuid,jsonb)', 'execute'), 'authenticated cannot call user_matches_rule');
select ok(not has_function_privilege('authenticated', 'public.users_in_scope_of(uuid)', 'execute'), 'authenticated cannot call users_in_scope_of');
select ok(not has_function_privilege('authenticated', 'public.report_summary_for(uuid)', 'execute'), 'authenticated cannot call report_summary_for');
select ok(not has_function_privilege('authenticated', 'public.check_retest_token(text)', 'execute'), 'authenticated cannot call check_retest_token');
select ok(not has_function_privilege('authenticated', 'public.purge_demo_data(text)', 'execute'), 'authenticated cannot purge demo data');
select ok(not has_table_privilege('authenticated', 'public.lesson_progress', 'insert'), 'no direct insert on lesson_progress');
select ok(not has_table_privilege('authenticated', 'public.retests', 'update'), 'no direct update on retests');
select ok(not has_table_privilege('authenticated', 'public.retest_tokens', 'select'), 'no access to retest_tokens');
select ok(not has_column_privilege('authenticated', 'public.users', 'email', 'update'), 'email not user-updatable');

-- ------------------------------------------------------------- rule engine
select ok(public.user_matches_rule('b0000000-0000-0000-0000-000000000005', '{"unit_ids":["a0000000-0000-0000-0000-000000000003"]}'), 'store learner is inside the region subtree');
select ok(not public.user_matches_rule('b0000000-0000-0000-0000-000000000006', '{"unit_ids":["a0000000-0000-0000-0000-000000000003"]}'), 'other brand learner is outside');
select ok(not public.user_matches_rule('b0000000-0000-0000-0000-000000000005', '{}'), 'empty rule matches nobody');
select ok(not public.user_matches_rule('b0000000-0000-0000-0000-000000000005', '{"unit_ids":[]}'), 'empty unit_ids matches nobody');
select ok(public.user_matches_rule('b0000000-0000-0000-0000-000000000005', '{"all":true}'), 'all matches');
select ok(not public.user_matches_rule('b0000000-0000-0000-0000-000000000005', '{"all":true,"exclude_user_ids":["b0000000-0000-0000-0000-000000000005"]}'), 'exclude beats all');
select ok(public.user_matches_rule('b0000000-0000-0000-0000-000000000007', '{"include_user_ids":["b0000000-0000-0000-0000-000000000007"]}'), 'direct staff reachable by include');
select ok(public.user_matches_rule('b0000000-0000-0000-0000-000000000007', '{"unit_ids":["a0000000-0000-0000-0000-000000000001"]}'), 'direct staff under supplier root matches root unit');
select ok(not public.user_matches_rule('b0000000-0000-0000-0000-000000000005', '{"unit_ids":["a0000000-0000-0000-0000-000000000003"],"states":["VIC"]}'), 'state filter ANDs (units have no state)');

-- --------------------------------------------------- scope / RLS as L1 viewer
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select count(*)::int from public.units), 5, 'L1 sees own subtree plus ancestors: S,B,R,T1,T2');
select is((select count(*)::int from public.users where role='learner'), 1, 'L1 sees only learners in B subtree');
select ok(public.in_my_scope('a0000000-0000-0000-0000-000000000004'), 'T1 in L1 scope');
select ok(not public.in_my_scope('a0000000-0000-0000-0000-000000000007'), 'T3 not in L1 scope');
select ok(not public.can_manage_user('b0000000-0000-0000-0000-000000000005'), 'viewer cannot manage');
select is(pg_temp.rows_changed($q$update public.users set full_name='x' where id='b0000000-0000-0000-0000-000000000005'$q$), 0, 'viewer update touches no rows');
reset role;

-- ----------------------------------------------------- manager hierarchy
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select ok(public.can_manage_user('b0000000-0000-0000-0000-000000000005'), 'L2 manages store learner');
select ok(public.can_manage_user('b0000000-0000-0000-0000-000000000004'), 'L2 manages store manager below');
select ok(not public.can_manage_user('b0000000-0000-0000-0000-000000000002'), 'L2 cannot manage L1 viewer');
select ok(not public.can_manage_user('b0000000-0000-0000-0000-000000000006'), 'L2 cannot manage other brand learner');
select ok(not public.can_manage_user('b0000000-0000-0000-0000-000000000001'), 'L2 cannot manage admin');
select ok(not public.can_manage_user('b0000000-0000-0000-0000-000000000003'), 'L2 cannot manage self-level peer (self)');
select ok(public.can_provision_email('new@t.test','a0000000-0000-0000-0000-000000000004'), 'L2 can add to a store in scope');
select ok(not public.can_provision_email('new@t.test','a0000000-0000-0000-0000-000000000007'), 'L2 cannot add outside scope');
select ok(public.can_provision_email('floor1@t.test','a0000000-0000-0000-0000-000000000005'), 'L2 may move a learner it already manages');
select ok(not public.can_provision_email('floor3@t.test','a0000000-0000-0000-0000-000000000005'), 'existing out-of-scope email cannot be pulled in');
select ok(not public.can_provision_email('l1viewer@t.test','a0000000-0000-0000-0000-000000000005'), 'existing viewer cannot be pulled in');
select is(pg_temp.rows_changed($q$update public.users set role='admin' where id='b0000000-0000-0000-0000-000000000005'$q$), 0, 'manager promotion touches no rows');
reset role;
select is((select role from public.users where id='b0000000-0000-0000-0000-000000000005'), 'learner', 'role unchanged after refused promotion');

select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select ok(public.can_manage_user('b0000000-0000-0000-0000-000000000005'), 'L3 manages own floor staff');
select ok(not public.can_manage_user('b0000000-0000-0000-0000-000000000003'), 'L3 cannot manage L2 above');
select ok(not public.can_manage_unit('a0000000-0000-0000-0000-000000000005'), 'L3 cannot manage sibling store');
reset role;

-- floor staff isolation
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is((select count(*)::int from public.users), 1, 'learner sees only self');
select ok(public.user_sees_course('c0000000-0000-0000-0000-000000000001'), 'assigned learner sees course');
select throws_ok($$insert into public.lesson_progress (user_id, lesson_id, watch_pct) values ('b0000000-0000-0000-0000-000000000005','e0000000-0000-0000-0000-000000000001',1)$$, '42501', null, 'cannot fake progress');
reset role;
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select ok(not public.user_sees_course('c0000000-0000-0000-0000-000000000001'), 'unassigned learner does not see course');
reset role;

-- ----------------------------------------------------------- learning flow
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select lives_ok($$select public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 0.95)$$, 'record watch');
select ok((select (get_lesson_quiz::text not like '%correct_index%') from (select public.get_lesson_quiz('e0000000-0000-0000-0000-000000000001')) s(get_lesson_quiz)), 'quiz payload hides answers');
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":1,"q2":0}') ->> 'passed')::boolean, false, 'wrong answers fail');
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":0,"q2":1}') ->> 'passed')::boolean, true, 'right answers pass');
select is((select count(*)::int from public.my_open_retests()), 0, 'retest not open before due');
reset role;
select is((select count(*)::int from public.retests where user_id='b0000000-0000-0000-0000-000000000005'), 1, 'retest scheduled on pass');
update public.retests set due_at = now() - interval '1 hour' where user_id='b0000000-0000-0000-0000-000000000005';

select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is((select count(*)::int from public.my_open_retests()), 1, 'retest open once due');
select is((public.build_my_retest((select retest_id from public.my_open_retests())) ->> 'valid')::boolean, true, 'retest builds');
select is((public.grade_my_retest((select retest_id from public.my_open_retests()), '{"q1":1,"q2":0}') ->> 'passed')::boolean, false, 'failed retest');
select is((select count(*)::int from public.my_open_retests()), 0, 'failed retest requeued into the future');
reset role;
select is((select status from public.retests where user_id='b0000000-0000-0000-0000-000000000005'), 'requeued', 'status requeued');
update public.retests set due_at = now() - interval '1 hour' where user_id='b0000000-0000-0000-0000-000000000005';
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is((public.grade_my_retest((select retest_id from public.my_open_retests()), '{"q1":0,"q2":1}') ->> 'passed')::boolean, true, 'second cycle passes');
select is((public.grade_my_retest((select id from public.retests limit 1), '{"q1":0,"q2":1}') ->> 'reason'), 'already_passed', 'cannot grade twice');
reset role;
-- another learner cannot touch this retest
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select is((public.build_my_retest((select id from public.retests limit 1)) ->> 'reason'), 'not_found', 'other learner gets not_found');
reset role;

-- ------------------------------------------------------------- reporting
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select count(*)::int from public.report_course_rollup('c0000000-0000-0000-0000-000000000001')), 3, 'L2 rollup: floor1, L3 manager and L2 themself (rules match by unit, not role)');
reset role;

-- ----------------------------------------------------------- demo guard
select throws_ok($$insert into public.units (parent_id, kind, name, demo_tag) values ('a0000000-0000-0000-0000-000000000001','store','Demo','t')$$, null, null, 'demo row refused in production');
update public.app_settings set value='demo' where key='environment';
select lives_ok($$insert into public.units (id, parent_id, kind, name, demo_tag) values ('a0000000-0000-0000-0000-0000000000f1','a0000000-0000-0000-0000-000000000001','store','Demo','t')$$, 'demo row allowed in demo env');
select is((public.demo_row_counts() ->> 'units')::int, 1, 'demo_row_counts sees it');
select lives_ok($$select public.purge_demo_data('t')$$, 'purge works');
select is((public.demo_row_counts() ->> 'units')::int, 0, 'purge removed it');
select is((select count(*)::int from public.units where demo_tag is null), 7, 'purge left real rows alone');
update public.app_settings set value='production' where key='environment';

select * from finish();
rollback;

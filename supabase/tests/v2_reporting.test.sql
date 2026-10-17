-- Reporting: completion, retention verification, scoped roll-ups, digest
-- recipients and reach preview.
-- Self-contained: builds its own fixtures, never relies on seed data.
-- Run with `supabase test db` (pgTAP), or inside a rolled-back transaction.
begin;
select * from no_plan();

-- ---------------------------------------------------------------- fixtures
-- Units: S > B > R > T1, T2 (stores);  S > B2 > T3
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
 ('b0000000-0000-0000-0000-000000000007', 'direct@t.test'),
 ('b0000000-0000-0000-0000-000000000008', 'floor2@t.test');
update public.users set role='admin',   unit_id='a0000000-0000-0000-0000-000000000001' where id='b0000000-0000-0000-0000-000000000001';
update public.users set role='viewer',  unit_id='a0000000-0000-0000-0000-000000000002' where id='b0000000-0000-0000-0000-000000000002';
update public.users set role='manager', unit_id='a0000000-0000-0000-0000-000000000003' where id='b0000000-0000-0000-0000-000000000003';
update public.users set role='manager', unit_id='a0000000-0000-0000-0000-000000000004' where id='b0000000-0000-0000-0000-000000000004';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000004' where id='b0000000-0000-0000-0000-000000000005';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000007' where id='b0000000-0000-0000-0000-000000000006';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000001' where id='b0000000-0000-0000-0000-000000000007';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000005' where id='b0000000-0000-0000-0000-000000000008';
insert into public.user_scopes values
 ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002'),
 ('b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000003'),
 ('b0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000004');

-- C1: M1 (L1 quiz, L2 watch only), M2 (L3 quiz). Assigned to region R.
-- C2: unpublished, assigned to everyone.  C3: published, assigned to nobody.
-- C4: published, no modules at all.
insert into public.courses (id, title, published) values
 ('c0000000-0000-0000-0000-000000000001','C1',true),
 ('c0000000-0000-0000-0000-000000000002','C2',false),
 ('c0000000-0000-0000-0000-000000000003','C3',true),
 ('c0000000-0000-0000-0000-000000000004','C4',true);
insert into public.modules (id, course_id, title, sort_order) values
 ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','M1',1),
 ('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','M2',2),
 ('d0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000002','M-C2',1),
 ('d0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000003','M-C3',1);
insert into public.lessons (id, module_id, title) values
 ('e0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','L1'),
 ('e0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','L2 watch only'),
 ('e0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000002','L3'),
 ('e0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000003','L-C2'),
 ('e0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000004','L-C3');
insert into public.quizzes (lesson_id, pass_mark, questions) values
 ('e0000000-0000-0000-0000-000000000001', 0.8, '[{"id":"q1","text":"a","options":["x","y"],"correct_index":0,"explanation":"e"}]'),
 ('e0000000-0000-0000-0000-000000000003', 0.8, '[{"id":"q3","text":"c","options":["x","y"],"correct_index":0,"explanation":"e"}]');
insert into public.assignments (course_id, rule) values
 ('c0000000-0000-0000-0000-000000000001', '{"unit_ids":["a0000000-0000-0000-0000-000000000003"]}'),
 ('c0000000-0000-0000-0000-000000000002', '{"all":true}');

-- Progress, written directly (the flows are covered in v2_learning).
--   floor1: finished the course, both re-tests passed  -> complete + retention-verified
--   floor2: finished the course, M2 re-test pending    -> complete, not verified
--   l3mgr : only the first quiz lesson                 -> not complete
insert into public.lesson_progress (user_id, lesson_id, watch_pct, watched_at, quiz_score, quiz_attempts, quiz_passed_at)
select u, l, 1, now(), case when q then 1 end, case when q then 1 else 0 end, case when q then now() end
from (values
  ('b0000000-0000-0000-0000-000000000005'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, true),
  ('b0000000-0000-0000-0000-000000000005'::uuid, 'e0000000-0000-0000-0000-000000000002'::uuid, false),
  ('b0000000-0000-0000-0000-000000000005'::uuid, 'e0000000-0000-0000-0000-000000000003'::uuid, true),
  ('b0000000-0000-0000-0000-000000000008'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, true),
  ('b0000000-0000-0000-0000-000000000008'::uuid, 'e0000000-0000-0000-0000-000000000002'::uuid, false),
  ('b0000000-0000-0000-0000-000000000008'::uuid, 'e0000000-0000-0000-0000-000000000003'::uuid, true),
  ('b0000000-0000-0000-0000-000000000004'::uuid, 'e0000000-0000-0000-0000-000000000001'::uuid, true)
) v(u, l, q);
insert into public.retests (user_id, module_id, due_at, status, passed_at) values
 ('b0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001', now() - interval '3 days', 'passed', now() - interval '2 days'),
 ('b0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000002', now() - interval '3 days', 'passed', now() - interval '2 days'),
 ('b0000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000001', now() - interval '3 days', 'passed', now() - interval '2 days'),
 ('b0000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000002', now() + interval '3 days', 'pending', null);

-- ------------------------------------------------- completion definitions
select ok(public.course_is_complete('b0000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000001'), 'floor1 completed C1');
select ok(public.course_is_complete('b0000000-0000-0000-0000-000000000008','c0000000-0000-0000-0000-000000000001'), 'floor2 completed C1');
select ok(not public.course_is_complete('b0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000001'), 'l3mgr has not completed C1');
select ok(not public.course_is_complete('b0000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000004'), 'a course with no lessons is never complete');
select ok(public.course_is_retention_verified('b0000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000001'), 'floor1 is retention-verified');
select ok(not public.course_is_retention_verified('b0000000-0000-0000-0000-000000000008','c0000000-0000-0000-0000-000000000001'), 'floor2 is not: M2 re-test still pending');
select ok(public.module_is_retention_verified('b0000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000001'), 'floor2 verified M1');
select ok(not public.module_is_retention_verified('b0000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000002'), 'floor2 not verified M2');
select ok(not public.course_is_retention_verified('b0000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000004'), 'a course with no modules is never verified');
select ok(not public.course_is_retention_verified('b0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000001'), 'incomplete is never verified');
-- Verification needs completion as well as a passed re-test.
insert into public.retests (user_id, module_id, due_at, status, passed_at)
values ('b0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000002', now() - interval '3 days', 'passed', now());
select ok(not public.module_is_retention_verified('b0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000002'), 'a passed re-test without the module finished does not verify');
delete from public.retests where user_id='b0000000-0000-0000-0000-000000000004';

-- --------------------------------------------------- the headline numbers
select is((select assigned from public.report_summary_for('b0000000-0000-0000-0000-000000000001') where title='C1'), 4::bigint, 'admin: 4 assigned (rules match by unit, not role)');
select is((select completed from public.report_summary_for('b0000000-0000-0000-0000-000000000001') where title='C1'), 2::bigint, 'admin: 2 completed');
select is((select retention_verified from public.report_summary_for('b0000000-0000-0000-0000-000000000001') where title='C1'), 1::bigint, 'admin: 1 retention-verified');
select is((select count(*)::int from public.report_summary_for('b0000000-0000-0000-0000-000000000001')), 1, 'unpublished and unassigned courses are left out');
select is((select assigned from public.report_summary_for('b0000000-0000-0000-0000-000000000002')), 4::bigint, 'L1 viewer sees the whole brand');
select is((select assigned from public.report_summary_for('b0000000-0000-0000-0000-000000000003')), 4::bigint, 'L2 sees the region');
select is((select assigned from public.report_summary_for('b0000000-0000-0000-0000-000000000004')), 2::bigint, 'L3 sees own store: manager and floor1');
select is((select completed from public.report_summary_for('b0000000-0000-0000-0000-000000000004')), 1::bigint, 'L3 completed count is store only');
select is((select retention_verified from public.report_summary_for('b0000000-0000-0000-0000-000000000004')), 1::bigint, 'L3 verified count is store only');

-- Deactivated staff drop out of every denominator.
update public.users set active = false where id = 'b0000000-0000-0000-0000-000000000008';
select is((select assigned from public.report_summary_for('b0000000-0000-0000-0000-000000000001') where title='C1'), 3::bigint, 'deactivated staff leave the denominator');
select is((select completed from public.report_summary_for('b0000000-0000-0000-0000-000000000001') where title='C1'), 1::bigint, 'and the completed count');
update public.users set active = true where id = 'b0000000-0000-0000-0000-000000000008';

-- An inactive viewer sees nothing.
update public.users set active = false where id = 'b0000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.report_summary_for('b0000000-0000-0000-0000-000000000003')), 0, 'inactive viewer gets no report');
select is((select count(*)::int from public.users_in_scope_of('b0000000-0000-0000-0000-000000000003')), 0, 'inactive viewer has no scope');
update public.users set active = true where id = 'b0000000-0000-0000-0000-000000000003';

-- Exclusions apply to the numbers.
update public.assignments set rule = '{"unit_ids":["a0000000-0000-0000-0000-000000000003"],"exclude_user_ids":["b0000000-0000-0000-0000-000000000005"]}'
 where course_id = 'c0000000-0000-0000-0000-000000000001';
select is((select assigned from public.report_summary_for('b0000000-0000-0000-0000-000000000001') where title='C1'), 3::bigint, 'excluded user is not counted as assigned');
select is((select retention_verified from public.report_summary_for('b0000000-0000-0000-0000-000000000001') where title='C1'), 0::bigint, 'nor as verified');
update public.assignments set rule = '{"unit_ids":["a0000000-0000-0000-0000-000000000003"]}' where course_id = 'c0000000-0000-0000-0000-000000000001';

-- --------------------------------------------------- who can see what
select ok(exists (select 1 from public.users_in_scope_of('b0000000-0000-0000-0000-000000000002') where id = 'b0000000-0000-0000-0000-000000000005'), 'L1 scope includes its store staff');
select ok(not exists (select 1 from public.users_in_scope_of('b0000000-0000-0000-0000-000000000002') where id = 'b0000000-0000-0000-0000-000000000006'), 'L1 scope excludes the other brand');
select ok(not exists (select 1 from public.users_in_scope_of('b0000000-0000-0000-0000-000000000002') where id = 'b0000000-0000-0000-0000-000000000007'), 'L1 scope excludes direct supplier staff');
select is((select count(*)::int from public.users_in_scope_of('b0000000-0000-0000-0000-000000000001')), 8, 'admin scope is everyone active');
select ok((select jsonb_array_length(ancestors) = 4 from public.users_in_scope_of('b0000000-0000-0000-0000-000000000001') where id = 'b0000000-0000-0000-0000-000000000005'), 'ancestors run from root to store');
select ok((select ancestors -> 0 ->> 'kind' = 'supplier' from public.users_in_scope_of('b0000000-0000-0000-0000-000000000001') where id = 'b0000000-0000-0000-0000-000000000005'), 'chain starts at the root');

select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select count(*)::int from public.report_course_rollup('c0000000-0000-0000-0000-000000000001')), 4, 'L2 roll-up covers the region');
select is((select assigned from public.report_courses_summary() where title='C1'), 4::bigint, 'L2 wrapper matches the internal worker');
reset role;

select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select is((select count(*)::int from public.report_course_rollup('c0000000-0000-0000-0000-000000000001')), 2, 'L3 roll-up covers the store only');
select ok(not exists (select 1 from public.report_course_rollup('c0000000-0000-0000-0000-000000000001') where user_id = 'b0000000-0000-0000-0000-000000000008'), 'L3 cannot see the sibling store');
reset role;

select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is((select count(*)::int from public.report_course_rollup('c0000000-0000-0000-0000-000000000001')), 1, 'a learner roll-up is just themselves');
select is((select user_id from public.report_course_rollup('c0000000-0000-0000-0000-000000000001')), 'b0000000-0000-0000-0000-000000000005'::uuid, 'and it is the right person');
select is((select count(*)::int from public.users_in_reporting_scope()), 1, 'learner reporting scope is one row');
reset role;

select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select is((select count(*)::int from public.report_courses_summary()), 0, 'an unassigned learner has an empty report');
reset role;

-- ------------------------------------------------------ digest recipients
select is((select count(*)::int from public.digest_recipients()), 3, 'digest goes to admin and both managers, not viewers or learners');
select ok(not exists (select 1 from public.digest_recipients() where role in ('viewer','learner')), 'no viewers or learners');
update public.users set active = false where id = 'b0000000-0000-0000-0000-000000000004';
select is((select count(*)::int from public.digest_recipients()), 2, 'deactivated manager is dropped');
update public.users set active = true where id = 'b0000000-0000-0000-0000-000000000004';

-- ---------------------------------------------------- reach preview (admin)
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(public.preview_rule_reach('{"unit_ids":["a0000000-0000-0000-0000-000000000003"]}'), 4::bigint, 'admin preview: region reaches 4');
select is(public.preview_rule_reach('{"all":true}'), 8::bigint, 'admin preview: all reaches everyone active');
select is(public.preview_rule_reach('{}'), 0::bigint, 'empty rule reaches nobody');
reset role;
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is(public.preview_rule_reach('{"all":true}'), 0::bigint, 'managers get no reach numbers');
reset role;
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is(public.preview_rule_reach('{"all":true}'), 0::bigint, 'learners get no reach numbers');
reset role;

-- ------------------------------------------------------ privilege checks
select ok(not has_function_privilege('authenticated', 'public.digest_recipients()', 'execute'), 'authenticated cannot list digest recipients');
select ok(not has_function_privilege('anon', 'public.digest_recipients()', 'execute'), 'anon cannot list digest recipients');
select ok(not has_function_privilege('authenticated', 'public.course_is_complete(uuid,uuid)', 'execute'), 'authenticated cannot call course_is_complete');
select ok(not has_function_privilege('authenticated', 'public.course_is_retention_verified(uuid,uuid)', 'execute'), 'authenticated cannot call course_is_retention_verified');
select ok(not has_function_privilege('authenticated', 'public.module_is_retention_verified(uuid,uuid)', 'execute'), 'authenticated cannot call module_is_retention_verified');
select ok(has_function_privilege('authenticated', 'public.report_courses_summary()', 'execute'), 'the summary wrapper is callable');
select ok(has_function_privilege('authenticated', 'public.report_course_rollup(uuid)', 'execute'), 'the roll-up wrapper is callable');
select ok(has_function_privilege('authenticated', 'public.preview_rule_reach(jsonb)', 'execute'), 'reach preview is callable');
select ok(has_function_privilege('service_role', 'public.digest_recipients()', 'execute'), 'service role can list digest recipients');
select ok(has_function_privilege('service_role', 'public.report_summary_for(uuid)', 'execute'), 'service role can build digests');

select * from finish();
rollback;

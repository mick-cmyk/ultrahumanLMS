-- SCORM 1.2 import: package visibility, file access through storage RLS, the
-- commit path, completion mapping onto lesson_progress, no backsliding, the
-- re-test rule, and that a SCORM lesson can't be completed by faking a watch.
-- Self-contained: builds its own fixtures, never relies on seed data.
-- Run with `supabase test db` (pgTAP), or `npm run test:db:local`.
begin;
select * from no_plan();

-- ---------------------------------------------------------------- fixtures
insert into public.units (id, parent_id, kind, name) values
 ('a1000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'store', 'T1'),
 ('a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'store', 'T2');

insert into auth.users (id, email) values
 ('b1000000-0000-0000-0000-000000000001', 'admin@t.test'),
 ('b1000000-0000-0000-0000-000000000002', 'floor1@t.test'),
 ('b1000000-0000-0000-0000-000000000003', 'floor2@t.test');
update public.users set role='admin', unit_id='a1000000-0000-0000-0000-000000000001' where id='b1000000-0000-0000-0000-000000000001';
update public.users set role='learner', unit_id='a1000000-0000-0000-0000-000000000002' where id='b1000000-0000-0000-0000-000000000002';
update public.users set role='learner', unit_id='a1000000-0000-0000-0000-000000000003' where id='b1000000-0000-0000-0000-000000000003';

insert into public.scorm_packages (id, title, launch_href, manifest) values
 ('f1000000-0000-0000-0000-000000000001', 'Pkg A', 'index.html', '{"mastery_score": 80}'),
 ('f1000000-0000-0000-0000-000000000002', 'Pkg B', 'start.html', '{}'),
 ('f1000000-0000-0000-0000-000000000009', 'Unused', 'x.html', '{}');

-- Course SC (assigned to T1 only):
--   M1: S1 (scorm, pkg A) + V1 (video with quiz)     -> re-test once both done
--   M2: S2 (scorm, pkg B) only                       -> no questions, no re-test
insert into public.courses (id, title, published) values ('c1000000-0000-0000-0000-000000000001','SC',true);
insert into public.modules (id, course_id, title, sort_order) values
 ('d1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','M1',1),
 ('d1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','M2',2);
insert into public.lessons (id, module_id, title, kind, scorm_package_id) values
 ('e1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','S1','scorm','f1000000-0000-0000-0000-000000000001'),
 ('e1000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000002','S2','scorm','f1000000-0000-0000-0000-000000000002');
insert into public.lessons (id, module_id, title) values
 ('e1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','V1');
insert into public.quizzes (lesson_id, pass_mark, questions) values
 ('e1000000-0000-0000-0000-000000000002', 0.5,
  '[{"id":"q1","text":"a","options":["x","y"],"correct_index":0,"explanation":"e1"}]');
insert into public.assignments (course_id, rule) values
 ('c1000000-0000-0000-0000-000000000001', '{"unit_ids":["a1000000-0000-0000-0000-000000000002"]}');

insert into storage.objects (bucket_id, name) values
 ('scorm', 'f1000000-0000-0000-0000-000000000001/index.html'),
 ('scorm', 'f1000000-0000-0000-0000-000000000001/media/clip.mp4'),
 ('scorm', 'f1000000-0000-0000-0000-000000000009/x.html'),
 ('scorm', 'not-a-package/readme.txt');

-- ------------------------------------------------------------------- schema
select throws_ok($$insert into public.lessons (module_id, title, kind) values ('d1000000-0000-0000-0000-000000000001','bad','scorm')$$,
  '23514', null, 'a scorm lesson must have a package');
select throws_ok($$insert into public.lessons (module_id, title, scorm_package_id) values ('d1000000-0000-0000-0000-000000000001','bad','f1000000-0000-0000-0000-000000000002')$$,
  '23514', null, 'a video lesson cannot carry a package');
select throws_ok($$insert into public.scorm_packages (title, launch_href) values ('bad','../../etc/passwd')$$,
  '23514', null, 'launch path cannot climb out of the package');
select throws_ok($$insert into public.scorm_packages (title, launch_href) values ('bad','https://evil.test/x.html')$$,
  '23514', null, 'launch path cannot be another site');
select throws_ok($$delete from public.scorm_packages where id = 'f1000000-0000-0000-0000-000000000001'$$,
  '23001', null, 'a package in use cannot be deleted');
select is(public.scorm_object_package('f1000000-0000-0000-0000-000000000001/a/b.js'),
  'f1000000-0000-0000-0000-000000000001'::uuid, 'object path maps to its package');
select ok(public.scorm_object_package('../f1000000-0000-0000-0000-000000000001/a.js') is null, 'odd paths map to no package');

-- ------------------------------------------------------- learner on T1
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select is((select count(*)::int from public.scorm_packages), 2, 'learner sees only packages used by their lessons');
select is((select count(*)::int from storage.objects where bucket_id = 'scorm'), 2, 'learner can read files of their own package only');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('scorm','f1000000-0000-0000-0000-000000000001/evil.html')$$,
  '42501', null, 'learner cannot upload package files');
select throws_ok($$insert into public.scorm_packages (title, launch_href) values ('x','x.html')$$,
  '42501', null, 'learner cannot create packages');
select throws_ok($$insert into public.scorm_attempts (user_id, lesson_id, lesson_status) values ('b1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','passed')$$,
  '42501', null, 'learner cannot write attempts directly');

select is(public.get_scorm_launch('e1000000-0000-0000-0000-000000000001') ->> 'launch_href', 'index.html', 'launch info for an assigned scorm lesson');
select ok(public.get_scorm_launch('e1000000-0000-0000-0000-000000000001') -> 'attempt' = 'null'::jsonb, 'no attempt yet');
select ok(public.get_scorm_launch('e1000000-0000-0000-0000-000000000002') is null, 'no launch info for a video lesson');

select throws_ok($$select public.record_watch_progress('e1000000-0000-0000-0000-000000000001', 1)$$,
  'P0001', 'lesson not found or not assigned to you', 'cannot complete a scorm lesson by faking a watch');
select throws_ok($$select public.record_scorm_commit('e1000000-0000-0000-0000-000000000002', '{"lesson_status":"passed"}')$$,
  'P0001', 'lesson not found or not assigned to you', 'cannot scorm-commit a video lesson');
select throws_ok($$select public.record_scorm_commit('e1000000-0000-0000-0000-000000000001', '{"lesson_status":"aced"}')$$,
  'P0001', 'invalid lesson_status aced', 'unknown status rejected');

-- In progress: saves state, no completion.
select is(public.record_scorm_commit('e1000000-0000-0000-0000-000000000001',
  '{"lesson_status":"incomplete","lesson_location":"page3","suspend_data":"abc"}', 120) ->> 'completed',
  'false', 'incomplete is not complete');
select ok(not exists (select 1 from public.lesson_progress where lesson_id = 'e1000000-0000-0000-0000-000000000001'), 'no progress row while incomplete');
select is(public.get_scorm_launch('e1000000-0000-0000-0000-000000000001') -> 'attempt' ->> 'lesson_location', 'page3', 'resume location kept');
select is(public.get_scorm_launch('e1000000-0000-0000-0000-000000000001') -> 'attempt' ->> 'suspend_data', 'abc', 'suspend data kept');

-- Garbage score is dropped, not fatal.
select lives_ok($$select public.record_scorm_commit('e1000000-0000-0000-0000-000000000001', '{"score_raw":"lots"}')$$, 'bad score does not lose the commit');

-- Passed: completion mapped onto lesson_progress.
select is(public.record_scorm_commit('e1000000-0000-0000-0000-000000000001',
  '{"lesson_status":"passed","score_raw":"90","score_max":"100"}', 60) ->> 'completed',
  'true', 'passed completes the lesson');
select ok((select watched_at is not null and quiz_passed_at is not null
           from public.lesson_progress where lesson_id = 'e1000000-0000-0000-0000-000000000001'),
  'passed stamps watched_at and quiz_passed_at');
select is((select quiz_score from public.lesson_progress where lesson_id = 'e1000000-0000-0000-0000-000000000001'),
  0.9::double precision, 'score mapped to a fraction');
select is((public.get_scorm_launch('e1000000-0000-0000-0000-000000000001') -> 'attempt' ->> 'total_seconds')::int, 180, 'session time accumulates');

-- No backsliding: reopening and reporting failed keeps it complete.
select is(public.record_scorm_commit('e1000000-0000-0000-0000-000000000001', '{"lesson_status":"failed"}') ->> 'lesson_status',
  'passed', 'a later failed does not undo passed');

-- M1 isn't complete until V1 is done too, so no re-test yet.
select ok(not exists (select 1 from public.retests where module_id = 'd1000000-0000-0000-0000-000000000001'), 'no re-test while the module is unfinished');
select lives_ok($$select public.record_watch_progress('e1000000-0000-0000-0000-000000000002', 1)$$, 'video lesson in the same module still watchable');
select lives_ok($$select public.record_quiz_attempt('e1000000-0000-0000-0000-000000000002', '{"q1":0}')$$, 'quiz in the same module still works');
select ok(exists (select 1 from public.retests where module_id = 'd1000000-0000-0000-0000-000000000001'), 'module with a quiz gets its re-test once everything is done');

-- M2 is SCORM only: completing it gives no re-test (nothing to ask).
select lives_ok($$select public.record_scorm_commit('e1000000-0000-0000-0000-000000000003', '{"lesson_status":"completed"}')$$, 'completed also counts');
reset role;
select ok(public.module_is_complete('b1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002'), 'scorm-only module counts as complete');
select ok(not exists (select 1 from public.retests where module_id = 'd1000000-0000-0000-0000-000000000002'), 'scorm-only module gets no re-test');

-- --------------------------------------------- learner on T2 (not assigned)
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select count(*)::int from public.scorm_packages), 0, 'unassigned learner sees no packages');
select is((select count(*)::int from storage.objects where bucket_id = 'scorm'), 0, 'unassigned learner can read no package files');
select ok(public.get_scorm_launch('e1000000-0000-0000-0000-000000000001') is null, 'unassigned learner gets no launch info');
select throws_ok($$select public.record_scorm_commit('e1000000-0000-0000-0000-000000000001', '{"lesson_status":"passed"}')$$,
  'P0001', 'lesson not found or not assigned to you', 'unassigned learner cannot commit');
select is((select count(*)::int from public.scorm_attempts), 0, 'cannot see other people''s attempts');
reset role;

-- ------------------------------------------------------------------- admin
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select count(*)::int from public.scorm_packages), 3, 'admin sees every package');
select is((select count(*)::int from storage.objects where bucket_id = 'scorm'), 4, 'admin reads every file in the bucket');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('scorm','f1000000-0000-0000-0000-000000000009/y.html')$$, 'admin can upload package files');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('scorm','loose-file.html')$$,
  '42501', null, 'uploads must sit under a package id');
select lives_ok($$insert into public.scorm_packages (title, launch_href) values ('New','index.html')$$, 'admin can register a package');
reset role;

-- --------------------------------------------------------------- privileges
select ok(not has_function_privilege('anon', 'public.record_scorm_commit(uuid, jsonb, integer, integer)', 'execute'), 'anon cannot commit');
select ok(not has_function_privilege('authenticated', 'public._schedule_retest_if_due(uuid, uuid, integer)', 'execute'), 'scheduling helper is internal');

select * from finish();
rollback;

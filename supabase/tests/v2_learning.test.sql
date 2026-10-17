-- Learning engine: watch tracking, quiz hiding and scoring, re-test scheduling,
-- grading, caps, interleaving and the email token functions.
-- Self-contained: builds its own fixtures, never relies on seed data.
-- Run with `supabase test db` (pgTAP), or inside a rolled-back transaction.
begin;
select * from no_plan();

create function pg_temp.rows_changed(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;

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
 ('b0000000-0000-0000-0000-000000000004', 'l3mgr@t.test'),
 ('b0000000-0000-0000-0000-000000000005', 'floor1@t.test'),
 ('b0000000-0000-0000-0000-000000000006', 'floor3@t.test'),
 ('b0000000-0000-0000-0000-000000000008', 'floor2@t.test');
update public.users set role='manager', unit_id='a0000000-0000-0000-0000-000000000004' where id='b0000000-0000-0000-0000-000000000004';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000004' where id='b0000000-0000-0000-0000-000000000005';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000007' where id='b0000000-0000-0000-0000-000000000006';
update public.users set role='learner', unit_id='a0000000-0000-0000-0000-000000000005' where id='b0000000-0000-0000-0000-000000000008';

-- Course C: M1 (L1 quiz q1,q2; L2 watch only) then M2 (L3 quiz q3,q4).
insert into public.courses (id, title, published) values ('c0000000-0000-0000-0000-000000000001','C',true);
insert into public.modules (id, course_id, title, sort_order) values
 ('d0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','M1',1),
 ('d0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','M2',2);
insert into public.lessons (id, module_id, title) values
 ('e0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','L1'),
 ('e0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','L2 watch only'),
 ('e0000000-0000-0000-0000-000000000003','d0000000-0000-0000-0000-000000000002','L3');
insert into public.quizzes (lesson_id, pass_mark, questions) values
 ('e0000000-0000-0000-0000-000000000001', 0.8,
  '[{"id":"q1","text":"a","options":["x","y"],"correct_index":0,"explanation":"e1"},
    {"id":"q2","text":"b","options":["x","y"],"correct_index":1,"explanation":"e2"}]'),
 ('e0000000-0000-0000-0000-000000000003', 0.8,
  '[{"id":"q3","text":"c","options":["x","y"],"correct_index":0,"explanation":"e3"},
    {"id":"q4","text":"d","options":["x","y"],"correct_index":1,"explanation":"e4"}]');
insert into public.assignments (course_id, rule) values
 ('c0000000-0000-0000-0000-000000000001', '{"unit_ids":["a0000000-0000-0000-0000-000000000003"]}');

-- floor1 = b..05 (T1), floor2 = b..08 (T2), floor3 = b..06 (T3, not assigned)

-- ============================================================ watch tracking
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select ok(public.get_lesson_quiz('e0000000-0000-0000-0000-000000000001') is null, 'quiz hidden before the video is watched');
select throws_ok($$select public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":0,"q2":1}')$$,
  'P0001', 'quiz not available: watch the lesson first', 'cannot answer before watching');
select ok((public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 0.5)).watched_at is null, 'below threshold is not watched');
select ok(public.get_lesson_quiz('e0000000-0000-0000-0000-000000000001') is null, 'quiz still hidden below threshold');
select ok((public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 0.95)).watched_at is not null, 'crossing the threshold stamps watched_at');
select is((public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 0.2)).watch_pct::double precision, 0.95::double precision, 'watch percentage never goes down');
select is((public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 5)).watch_pct::double precision, 1::double precision, 'watch percentage clamps to 1');
select is((public.record_watch_progress('e0000000-0000-0000-0000-000000000001', -3)).watch_pct::double precision, 1::double precision, 'negative input cannot lower it');

select ok(public.get_lesson_quiz('e0000000-0000-0000-0000-000000000001') is not null, 'quiz visible once watched');
select ok(public.get_lesson_quiz('e0000000-0000-0000-0000-000000000001')::text not like '%correct_index%', 'quiz payload has no answers');
select ok(public.get_lesson_quiz('e0000000-0000-0000-0000-000000000001')::text not like '%explanation%', 'quiz payload has no explanations');
select is(jsonb_array_length(public.get_lesson_quiz('e0000000-0000-0000-0000-000000000001') -> 'questions'), 2, 'quiz has both questions');
select ok(public.get_lesson_quiz('e0000000-0000-0000-0000-000000000002') is null, 'watch-only lesson has no quiz');
reset role;

-- ====================================================== access and identity
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000006', true);
set local role authenticated;
select throws_ok($$select public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 1)$$,
  'P0001', 'lesson not found or not assigned to you', 'unassigned learner cannot record progress');
reset role;

select set_config('request.jwt.claim.sub','', true);
set local role authenticated;
select throws_ok($$select public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 1)$$,
  'P0001', 'not authenticated', 'no session, no progress');
select throws_ok($$select public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{}')$$,
  'P0001', 'not authenticated', 'no session, no quiz attempt');
reset role;

update public.courses set published = false where id = 'c0000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select throws_ok($$select public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 1)$$,
  'P0001', 'lesson not found or not assigned to you', 'unpublished course is closed');
select ok(public.get_lesson_quiz('e0000000-0000-0000-0000-000000000001') is null, 'unpublished course quiz is hidden');
reset role;
update public.courses set published = true where id = 'c0000000-0000-0000-0000-000000000001';

update public.users set active = false where id = 'b0000000-0000-0000-0000-000000000005';
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select throws_ok($$select public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 1)$$,
  'P0001', 'user is not active', 'inactive user cannot record progress');
select throws_ok($$select public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{}')$$,
  'P0001', 'user is not active', 'inactive user cannot answer');
reset role;
update public.users set active = true where id = 'b0000000-0000-0000-0000-000000000005';

-- ================================================================== scoring
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{}') ->> 'passed')::boolean, false, 'no answers fails');
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{}') ->> 'score')::numeric, 0::numeric, 'no answers scores zero');
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":"","q2":null}') ->> 'correct_count')::int, 0, 'blank answers are wrong');
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":0,"q2":0}') ->> 'passed')::boolean, false, 'half right fails at 0.8');
reset role;

-- Pass mark is inclusive: exactly 0.5 passes a 0.5 quiz.
update public.quizzes set pass_mark = 0.5 where lesson_id = 'e0000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":0,"q2":0}') ->> 'passed')::boolean, true, 'score equal to pass mark passes');
reset role;
update public.quizzes set pass_mark = 0.8 where lesson_id = 'e0000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":0,"q2":1}') ->> 'score')::numeric, 1::numeric, 'perfect score');
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":1,"q2":0}') ->> 'passed')::boolean, false, 'a later bad attempt reports fail');
reset role;
select is((select quiz_score::double precision from public.lesson_progress where user_id='b0000000-0000-0000-0000-000000000005' and lesson_id='e0000000-0000-0000-0000-000000000001'),
  1::double precision, 'best score is kept');
select ok((select quiz_passed_at is not null from public.lesson_progress where user_id='b0000000-0000-0000-0000-000000000005' and lesson_id='e0000000-0000-0000-0000-000000000001'),
  'a pass is never un-passed');
select is((select quiz_attempts from public.lesson_progress where user_id='b0000000-0000-0000-0000-000000000005' and lesson_id='e0000000-0000-0000-0000-000000000001'),
  7, 'every attempt is counted');
select is((select count(*)::int from public.retests where user_id='b0000000-0000-0000-0000-000000000005'), 0,
  'no re-test while the module still has an unwatched lesson');

-- ================================================ re-test scheduling
-- Quiz pass is the last step: floor2 watches the watch-only lesson first.
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select lives_ok($$select public.record_watch_progress('e0000000-0000-0000-0000-000000000002', 1)$$, 'floor2 watches the watch-only lesson');
select lives_ok($$select public.record_watch_progress('e0000000-0000-0000-0000-000000000001', 0.95)$$, 'floor2 watches the quiz lesson');
select is((public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":0,"q2":1}') ->> 'passed')::boolean, true, 'floor2 passes');
reset role;
select is((select count(*)::int from public.retests where user_id='b0000000-0000-0000-0000-000000000008' and module_id='d0000000-0000-0000-0000-000000000001'), 1,
  'quiz pass that completes the module schedules a re-test');
select ok((select due_at between now() + interval '4 days 23 hours' and now() + interval '5 days 1 hour'
           from public.retests where user_id='b0000000-0000-0000-0000-000000000008' and module_id='d0000000-0000-0000-0000-000000000001'),
  're-test is due about 5 days out');

select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select lives_ok($$select public.record_quiz_attempt('e0000000-0000-0000-0000-000000000001', '{"q1":0,"q2":1}')$$, 'a second pass is allowed');
reset role;
select is((select count(*)::int from public.retests where user_id='b0000000-0000-0000-0000-000000000008' and module_id='d0000000-0000-0000-0000-000000000001'), 1,
  'a second pass does not duplicate the re-test');

-- Watch is the last step: floor1 already passed the quiz, now watches the last lesson.
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select lives_ok($$select public.record_watch_progress('e0000000-0000-0000-0000-000000000002', 1)$$, 'floor1 watches the last lesson');
reset role;
select is((select count(*)::int from public.retests where user_id='b0000000-0000-0000-0000-000000000005' and module_id='d0000000-0000-0000-0000-000000000001'), 1,
  'watching the last lesson of a finished module also schedules the re-test');

-- ================================================================ re-tests
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select is((select count(*)::int from public.my_open_retests()), 0, 'not open before due');
select is((public.build_my_retest((select id from public.retests where user_id='b0000000-0000-0000-0000-000000000008' limit 1)) ->> 'reason'), 'not_due', 'build refuses before due');
select is((public.grade_my_retest((select id from public.retests where user_id='b0000000-0000-0000-0000-000000000008' limit 1), '{"q1":0,"q2":1}') ->> 'reason'), 'not_due', 'grade refuses before due');
reset role;
update public.retests set due_at = now() - interval '1 hour' where user_id='b0000000-0000-0000-0000-000000000008';

select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select is((select count(*)::int from public.my_open_retests()), 1, 'open once due');
select is((public.build_my_retest((select retest_id from public.my_open_retests())) ->> 'valid')::boolean, true, 'builds once due');
select ok(public.build_my_retest((select retest_id from public.my_open_retests()))::text not like '%correct_index%', 're-test payload has no answers');
select is(jsonb_array_length(public.build_my_retest((select retest_id from public.my_open_retests())) -> 'questions'), 2, 'M1 re-test draws both M1 questions');
select is((public.grade_my_retest((select retest_id from public.my_open_retests()), '{"zzz":1}') ->> 'reason'), 'no_gradable_answers', 'unknown question ids grade nothing');
select is((public.grade_my_retest((select retest_id from public.my_open_retests()), '[]') ->> 'reason'), 'no_gradable_answers', 'non-object answers grade nothing');
reset role;
select is((select attempts from public.retests where user_id='b0000000-0000-0000-0000-000000000008'), 0, 'ungradable submissions do not burn a cycle');

-- Cycle cap.
update public.retests set attempts = 3 where user_id='b0000000-0000-0000-0000-000000000008';
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select is((select count(*)::int from public.my_open_retests()), 0, 'capped re-test is not open');
select is((public.build_my_retest((select id from public.retests where user_id='b0000000-0000-0000-0000-000000000008' limit 1)) ->> 'reason'), 'capped', 'build refuses when capped');
select is((public.grade_my_retest((select id from public.retests where user_id='b0000000-0000-0000-0000-000000000008' limit 1), '{"q1":0,"q2":1}') ->> 'reason'), 'capped', 'grade refuses when capped');
reset role;

-- Final allowed cycle: failing it reports capped.
update public.retests set attempts = 2 where user_id='b0000000-0000-0000-0000-000000000008';
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select is((public.grade_my_retest((select retest_id from public.my_open_retests()), '{"q1":1,"q2":0}') ->> 'capped')::boolean, true, 'failing the last cycle reports capped');
reset role;
select is((select attempts from public.retests where user_id='b0000000-0000-0000-0000-000000000008'), 3, 'attempts counted');
select is((select last_score::double precision from public.retests where user_id='b0000000-0000-0000-0000-000000000008'), 0::double precision, 'last score recorded');

-- A pass records everything.
update public.retests set attempts = 0, status = 'requeued', due_at = now() - interval '1 hour' where user_id='b0000000-0000-0000-0000-000000000008';
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select is((public.grade_my_retest((select retest_id from public.my_open_retests()), '{"q1":0,"q2":1}') ->> 'passed')::boolean, true, 'pass');
reset role;
select is((select status from public.retests where user_id='b0000000-0000-0000-0000-000000000008'), 'passed', 'status passed');
select ok((select passed_at is not null from public.retests where user_id='b0000000-0000-0000-0000-000000000008'), 'passed_at stamped');
select is((select last_score::double precision from public.retests where user_id='b0000000-0000-0000-0000-000000000008'), 1::double precision, 'perfect last score');

-- Inactive learners cannot build or grade.
update public.users set active = false where id = 'b0000000-0000-0000-0000-000000000005';
update public.retests set due_at = now() - interval '1 hour' where user_id='b0000000-0000-0000-0000-000000000005';
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select throws_ok($$select public.build_my_retest((select id from public.retests where user_id='b0000000-0000-0000-0000-000000000005' limit 1))$$,
  'P0001', 'user is not active', 'inactive learner cannot build');
select is((select count(*)::int from public.my_open_retests()), 0, 'inactive learner has no open re-tests');
reset role;
update public.users set active = true where id = 'b0000000-0000-0000-0000-000000000005';

-- Interleaving: floor2 has passed M1's re-test, then finishes M2.
insert into public.lesson_progress (user_id, lesson_id, watch_pct, watched_at, quiz_score, quiz_attempts, quiz_passed_at)
values ('b0000000-0000-0000-0000-000000000008','e0000000-0000-0000-0000-000000000003', 1, now(), 1, 1, now());
insert into public.retests (user_id, module_id, due_at, status)
values ('b0000000-0000-0000-0000-000000000008','d0000000-0000-0000-0000-000000000002', now() - interval '1 hour', 'pending');
select set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000008', true);
set local role authenticated;
select is((select count(*)::int
           from jsonb_array_elements(public.build_my_retest((select retest_id from public.my_open_retests() where module_title = 'M2')) -> 'questions') e
           where e ->> 'id' in ('q1','q2')), 1, 'M2 re-test carries one question from the passed M1');
select is((select count(*)::int
           from jsonb_array_elements(public.build_my_retest((select retest_id from public.my_open_retests() where module_title = 'M2')) -> 'questions') e
           where e ->> 'id' in ('q3','q4')), 1, 'and one from M2');
select is((public.grade_my_retest((select retest_id from public.my_open_retests() where module_title = 'M2'), '{"q3":0,"q1":0}') ->> 'total')::int, 2,
  'interleaved questions are gradable against the course pool');
reset role;

-- ============================================================ email tokens
insert into public.retests (user_id, module_id, due_at, status)
values ('b0000000-0000-0000-0000-000000000005','d0000000-0000-0000-0000-000000000001', now(), 'pending')
on conflict (user_id, module_id) do nothing;  -- present already when the scheduling checks above pass
create temp table tok_ids as
  select (select id from public.retests where user_id='b0000000-0000-0000-0000-000000000008' and module_id='d0000000-0000-0000-0000-000000000002') as m2_retest,
         (select id from public.retests where user_id='b0000000-0000-0000-0000-000000000008' and module_id='d0000000-0000-0000-0000-000000000001') as m1_retest_passed,
         (select id from public.retests where user_id='b0000000-0000-0000-0000-000000000005' and module_id='d0000000-0000-0000-0000-000000000001') as floor1_retest;
update public.retests set status = 'pending', attempts = 0 where id = (select m2_retest from tok_ids);
insert into public.retest_tokens (token, retest_id, expires_at) values
 ('tok-valid',   (select m2_retest from tok_ids),         now() + interval '7 days'),
 ('tok-expired', (select m2_retest from tok_ids),         now() - interval '1 hour'),
 ('tok-passed',  (select m1_retest_passed from tok_ids),  now() + interval '7 days'),
 ('tok-floor1',  (select floor1_retest from tok_ids),     now() + interval '7 days');

select is((public.check_retest_token('nope') ->> 'reason'), 'not_found', 'unknown token');
select is((public.check_retest_token('tok-valid') ->> 'valid')::boolean, true, 'valid token');
select is((public.check_retest_token('tok-valid') ->> 'email'), 'floor2@t.test', 'token resolves to the right person');
select is((public.check_retest_token('tok-expired') ->> 'reason'), 'expired', 'expired token');
select is((public.check_retest_token('tok-passed') ->> 'reason'), 'already_passed', 'token for a passed re-test');

update public.users set active = false where id = 'b0000000-0000-0000-0000-000000000005';
select is((public.check_retest_token('tok-floor1') ->> 'reason'), 'inactive', 'token for a deactivated user');
update public.users set active = true where id = 'b0000000-0000-0000-0000-000000000005';

insert into public.retests (id, user_id, module_id, due_at, status)
values ('f0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000004','d0000000-0000-0000-0000-000000000001', now(), 'pending');
insert into public.retest_tokens (token, retest_id, expires_at) values ('tok-mgr','f0000000-0000-0000-0000-000000000001', now() + interval '7 days');
select is((public.check_retest_token('tok-mgr') ->> 'reason'), 'not_learner', 'a token cannot open a session for a manager');

select lives_ok($$select public.use_retest_token('tok-valid')$$, 'token can be marked used');
select is((public.check_retest_token('tok-valid') ->> 'reason'), 'used', 'used token is refused');
create temp table used_at0 as select used_at from public.retest_tokens where token = 'tok-valid';
select lives_ok($$select public.use_retest_token('tok-valid')$$, 'marking twice is harmless');
select is((select used_at from public.retest_tokens where token = 'tok-valid'), (select used_at from used_at0), 'second use does not move the timestamp');

-- ======================================================= privilege checks
select ok(not has_function_privilege('authenticated', 'public.use_retest_token(text)', 'execute'), 'authenticated cannot burn tokens');
select ok(not has_function_privilege('anon', 'public.use_retest_token(text)', 'execute'), 'anon cannot burn tokens');
select ok(not has_function_privilege('authenticated', 'public.lesson_is_complete(uuid,uuid)', 'execute'), 'authenticated cannot call lesson_is_complete');
select ok(not has_function_privilege('authenticated', 'public.module_is_complete(uuid,uuid)', 'execute'), 'authenticated cannot call module_is_complete');
select ok(has_function_privilege('authenticated', 'public.record_watch_progress(uuid,double precision)', 'execute'), 'learners can record progress');
select ok(has_function_privilege('authenticated', 'public.get_lesson_quiz(uuid)', 'execute'), 'learners can fetch quizzes');
select ok(has_function_privilege('authenticated', 'public.my_open_retests(integer)', 'execute'), 'learners can list their re-tests');
select ok(has_function_privilege('service_role', 'public.check_retest_token(text)', 'execute'), 'service role can check tokens');

select * from finish();
rollback;

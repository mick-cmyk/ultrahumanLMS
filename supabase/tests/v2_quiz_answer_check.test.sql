-- One question at a time: check_quiz_answer marks a single answer with the
-- explanation, only for a watched lesson in an assigned, published course,
-- and records nothing (scoring still happens in record_quiz_attempt).
-- Run with `supabase test db` (pgTAP), or `npm run test:db:local`.
begin;
select * from no_plan();

insert into public.units (id, parent_id, kind, name) values
 ('a3000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'store', 'T1'),
 ('a3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000001', 'store', 'T2');
insert into auth.users (id, email) values
 ('b3000000-0000-0000-0000-000000000001', 'floor1@qa.test'),
 ('b3000000-0000-0000-0000-000000000002', 'floor2@qa.test');
update public.users set role='learner', unit_id='a3000000-0000-0000-0000-000000000002' where id='b3000000-0000-0000-0000-000000000001';
update public.users set role='learner', unit_id='a3000000-0000-0000-0000-000000000003' where id='b3000000-0000-0000-0000-000000000002';

insert into public.courses (id, title, published) values ('c3000000-0000-0000-0000-000000000001', 'C', true);
insert into public.modules (id, course_id, title, sort_order) values
 ('d3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'M1', 1);
insert into public.lessons (id, module_id, title) values
 ('e3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'L1');
insert into public.quizzes (lesson_id, pass_mark, questions) values
 ('e3000000-0000-0000-0000-000000000001', 0.8,
  '[{"id":"q1","text":"a","options":["x","y","z"],"correct_index":2,"explanation":"Because z."},
    {"id":"q2","text":"b","options":["x","y"],"correct_index":0}]');
insert into public.assignments (course_id, rule) values
 ('c3000000-0000-0000-0000-000000000001', '{"unit_ids":["a3000000-0000-0000-0000-000000000002"]}');

-- Assigned learner.
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok($$select public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q1', 2)$$,
  'P0001', 'quiz not available: watch the lesson first', 'no marking before the video is watched');
select ok((public.record_watch_progress('e3000000-0000-0000-0000-000000000001', 0.95)).watched_at is not null, 'video watched');

select is((public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q1', 2)) ->> 'correct', 'true', 'right answer is marked correct');
select is((public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q1', 2)) ->> 'explanation', 'Because z.', 'the explanation comes back');
select is((public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q1', 0)) ->> 'correct', 'false', 'wrong answer is marked wrong');
select is((public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q1', 0)) ->> 'correct_index', '2', 'a wrong answer shows which one was right');
select ok((public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q2', 0)) ? 'explanation', 'a question with no explanation still answers');
select throws_ok($$select public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q1', 3)$$,
  'P0001', 'pick one of the answers', 'an answer that does not exist is refused');
select throws_ok($$select public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q1', -1)$$,
  'P0001', 'pick one of the answers', 'a negative answer is refused');
select throws_ok($$select public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'nope', 0)$$,
  'P0001', 'quiz not available: watch the lesson first', 'an unknown question is refused');
select is((select quiz_attempts from public.lesson_progress
           where user_id = 'b3000000-0000-0000-0000-000000000001' and lesson_id = 'e3000000-0000-0000-0000-000000000001'),
          0, 'checking answers records no attempt');

-- The attempt is still scored by record_quiz_attempt.
select is((public.record_quiz_attempt('e3000000-0000-0000-0000-000000000001', '{"q1":2,"q2":0}')) ->> 'passed', 'true', 'finishing the quiz still scores it');
reset role;

-- A learner the course is not assigned to gets nothing, even with progress.
insert into public.lesson_progress (user_id, lesson_id, watch_pct, watched_at)
values ('b3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001', 1, now());
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$select public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q1', 2)$$,
  'P0001', 'quiz not available: watch the lesson first', 'unassigned learner cannot check answers');
reset role;

-- An unpublished course gives nothing either.
update public.courses set published = false where id = 'c3000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', 'b3000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok($$select public.check_quiz_answer('e3000000-0000-0000-0000-000000000001', 'q1', 2)$$,
  'P0001', 'quiz not available: watch the lesson first', 'no marking on an unpublished course');
reset role;

select ok(not has_function_privilege('anon', 'public.check_quiz_answer(uuid, text, integer)', 'execute'), 'anon cannot check answers');
select ok(has_function_privilege('authenticated', 'public.check_quiz_answer(uuid, text, integer)', 'execute'), 'logged-in staff can check answers');

select * from finish();
rollback;

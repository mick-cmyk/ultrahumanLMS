-- The quick check one question at a time: check_retest_answer marks one
-- answer, the first answer is stored and always wins (asking again, or sending
-- a different answer at the end, changes nothing), and only the owner of a due,
-- unpassed, uncapped quick check can use it.
-- Run with `supabase test db` (pgTAP), or `npm run test:db:local`.
begin;
select * from no_plan();

insert into public.units (id, parent_id, kind, name) values
 ('a4000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'store', 'T1');
insert into auth.users (id, email) values
 ('b4000000-0000-0000-0000-000000000001', 'floor1@rc.test'),
 ('b4000000-0000-0000-0000-000000000002', 'floor2@rc.test');
update public.users set role='learner', unit_id='a4000000-0000-0000-0000-000000000002'
 where id in ('b4000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000002');

insert into public.courses (id, title, published) values ('c4000000-0000-0000-0000-000000000001', 'C', true);
insert into public.modules (id, course_id, title, sort_order) values
 ('d4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 'M1', 1);
insert into public.lessons (id, module_id, title) values
 ('e4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'L1');
insert into public.quizzes (lesson_id, pass_mark, questions) values
 ('e4000000-0000-0000-0000-000000000001', 0.8,
  '[{"id":"q1","text":"a","options":["x","y","z"],"correct_index":1,"explanation":"Because y."},
    {"id":"q2","text":"b","options":["x","y"],"correct_index":0,"explanation":"Because x."}]');
insert into public.assignments (course_id, rule) values
 ('c4000000-0000-0000-0000-000000000001', '{"unit_ids":["a4000000-0000-0000-0000-000000000002"]}');

-- floor1: a due quick check. floor2: one not due yet.
insert into public.retests (id, user_id, module_id, due_at, status) values
 ('f4000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', now() - interval '1 hour', 'sent'),
 ('f4000000-0000-0000-0000-000000000002', 'b4000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000001', now() + interval '2 days', 'pending');

select set_config('request.jwt.claim.sub', 'b4000000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- Marking one answer at a time.
select is((public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q1', 0)) ->> 'correct', 'false', 'a wrong answer is marked wrong');
select is((public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q1', 0)) ->> 'explanation', 'Because y.', 'the explanation comes back');
select is((public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q1', 0)) ->> 'correct_index', '1', 'it shows the right answer');

-- The first answer stands.
select is((public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q1', 1)) ->> 'correct', 'false', 'answering again cannot change the first answer');
select is((public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q1', 1)) ->> 'chosen', '0', 'the stored first answer comes back');

select throws_ok($$select public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q2', 5)$$,
  'P0001', 'pick one of the answers', 'an answer that does not exist is refused');
select throws_ok($$select public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'nope', 0)$$,
  'P0001', 'question not found', 'a question outside the course is refused');
select throws_ok($$select public.check_retest_answer('f4000000-0000-0000-0000-000000000002', 'q1', 1)$$,
  'P0001', 'this check is not available', 'someone else''s quick check is refused');

select is((public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q2', 0)) ->> 'correct', 'true', 'a right answer is marked right');

-- Grading uses the stored answers, even if the browser sends others.
select is((public.grade_my_retest('f4000000-0000-0000-0000-000000000001', '{"q1":1,"q2":0}')) ->> 'correct_count', '1',
  'a changed answer sent at the end does not count');
select is((select status from public.retests where id = 'f4000000-0000-0000-0000-000000000001'), 'requeued', '1 of 2 fails and requeues');
select is((select attempts from public.retests where id = 'f4000000-0000-0000-0000-000000000001'), 1, 'the cycle moves on');
reset role;

-- The next cycle starts clean.
update public.retests set due_at = now() - interval '1 minute' where id = 'f4000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', 'b4000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q1', 1)) ->> 'correct', 'true', 'the next quick check takes a fresh answer');
select is((public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q2', 0)) ->> 'correct', 'true', 'and the second question too');
select is((public.grade_my_retest('f4000000-0000-0000-0000-000000000001', '{}')) ->> 'passed', 'true', 'stored answers alone are graded');
select throws_ok($$select public.check_retest_answer('f4000000-0000-0000-0000-000000000001', 'q1', 1)$$,
  'P0001', 'this check is not available', 'nothing to check once passed');
reset role;

-- Not due yet.
select set_config('request.jwt.claim.sub', 'b4000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$select public.check_retest_answer('f4000000-0000-0000-0000-000000000002', 'q1', 1)$$,
  'P0001', 'this check is not available', 'a quick check that is not due cannot be answered');
select throws_ok($$select * from public.retest_answers$$, '42501', null, 'staff cannot read stored answers directly');
reset role;

select ok(not has_function_privilege('anon', 'public.check_retest_answer(uuid, text, integer, integer)', 'execute'), 'anon cannot check answers');

select * from finish();
rollback;

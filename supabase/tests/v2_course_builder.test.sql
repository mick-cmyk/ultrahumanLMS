-- Course builder: admins can build a course through their own session,
-- learners and managers can't write content, module intros are readable by
-- assigned learners, and the quiz shape check refuses anything the grading
-- functions couldn't handle.
-- Self-contained: builds its own fixtures, never relies on seed data.
-- Run with `supabase test db` (pgTAP), or `npm run test:db:local`.
begin;
select * from no_plan();

-- ---------------------------------------------------------------- fixtures
insert into public.units (id, parent_id, kind, name) values
 ('a2000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'store', 'S1');

insert into auth.users (id, email) values
 ('b2000000-0000-0000-0000-000000000001', 'admin@cb.test'),
 ('b2000000-0000-0000-0000-000000000002', 'floor@cb.test'),
 ('b2000000-0000-0000-0000-000000000003', 'boss@cb.test');
update public.users set role='admin', unit_id='a2000000-0000-0000-0000-000000000001' where id='b2000000-0000-0000-0000-000000000001';
update public.users set role='learner', unit_id='a2000000-0000-0000-0000-000000000002' where id='b2000000-0000-0000-0000-000000000002';
update public.users set role='manager', unit_id='a2000000-0000-0000-0000-000000000002' where id='b2000000-0000-0000-0000-000000000003';
insert into public.user_scopes (user_id, unit_id) values ('b2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002');

-- ------------------------------------------------------- shape check (owner)
select throws_ok($$insert into public.courses (id, title) values ('c2000000-0000-0000-0000-000000000009','tmp');
  insert into public.modules (id, course_id, title) values ('d2000000-0000-0000-0000-000000000009','c2000000-0000-0000-0000-000000000009','tmp');
  insert into public.lessons (id, module_id, title) values ('e2000000-0000-0000-0000-000000000009','d2000000-0000-0000-0000-000000000009','tmp');
  insert into public.quizzes (lesson_id, questions) values ('e2000000-0000-0000-0000-000000000009', '{"not":"a list"}')$$,
  '23514', null, 'questions must be a list');
select is(public.quiz_questions_problem('[]'), null, 'an empty list is fine');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x","y"],"correct_index":1,"explanation":"e"}]'), null, 'a good question passes');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x","y"],"correct_index":0}]'), null, 'explanation is optional');
select is(public.quiz_questions_problem('[{"text":"a","options":["x","y"],"correct_index":0}]'), 'question 1 has no id', 'id required');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x","y"],"correct_index":0},{"id":"q1","text":"b","options":["x","y"],"correct_index":0}]'),
  'question 2 repeats the id q1', 'ids are unique');
select is(public.quiz_questions_problem('[{"id":"q1","text":"  ","options":["x","y"],"correct_index":0}]'), 'question 1 has no text', 'text required');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x"],"correct_index":0}]'), 'question 1 needs 2 to 6 answers', 'at least two answers');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["1","2","3","4","5","6","7"],"correct_index":0}]'), 'question 1 needs 2 to 6 answers', 'at most six answers');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x",""],"correct_index":0}]'), 'question 1 has a blank answer', 'no blank answers');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x",3],"correct_index":0}]'), 'question 1 has a blank answer', 'answers are text');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x","y"]}]'), 'question 1 has no correct answer', 'correct answer required');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x","y"],"correct_index":2}]'), 'question 1 points at an answer that does not exist', 'correct answer in range');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x","y"],"correct_index":0.5}]'), 'question 1 points at an answer that does not exist', 'correct answer is a whole number');
select is(public.quiz_questions_problem('[{"id":"q1","text":"a","options":["x","y"],"correct_index":"0"}]'), 'question 1 has no correct answer', 'correct answer is a number');

-- ------------------------------------------------------- admin builds a course
select set_config('request.jwt.claim.sub','b2000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok($$insert into public.courses (id, title, description) values ('c2000000-0000-0000-0000-000000000001','Built','In the app')$$, 'admin creates a course');
select lives_ok($$insert into public.modules (id, course_id, title, intro, sort_order) values ('d2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','M1','Why this matters',1)$$, 'admin creates a module with an intro');
select lives_ok($$insert into public.lessons (id, module_id, title, bunny_video_id, duration_seconds, script, sort_order) values
  ('e2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','L1','0b2f8f7e-1111-4c4c-9d9d-123456789abc',90,'Notes',1)$$, 'admin creates a lesson');
select lives_ok($$insert into public.quizzes (lesson_id, pass_mark, questions) values ('e2000000-0000-0000-0000-000000000001', 0.8,
  '[{"id":"q1","text":"a","options":["x","y"],"correct_index":0,"explanation":"e"}]')$$, 'admin adds questions');
select throws_ok($$update public.quizzes set questions = '[{"id":"q1","text":"a","options":["x","y"],"correct_index":5}]' where lesson_id = 'e2000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'admin cannot save a broken question');
select lives_ok($$update public.modules set intro = 'Updated intro' where id = 'd2000000-0000-0000-0000-000000000001'$$, 'admin edits the intro');
select is((select count(*)::int from public.courses where id = 'c2000000-0000-0000-0000-000000000001' and not published), 1, 'new courses start as drafts');
reset role;

-- assign it and publish (as the owner, to keep the fixture short)
update public.courses set published = true where id = 'c2000000-0000-0000-0000-000000000001';
insert into public.assignments (course_id, rule) values ('c2000000-0000-0000-0000-000000000001', '{"unit_ids":["a2000000-0000-0000-0000-000000000002"]}');

-- ----------------------------------------------------------- learner
select set_config('request.jwt.claim.sub','b2000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select intro from public.modules where id = 'd2000000-0000-0000-0000-000000000001'), 'Updated intro', 'assigned learner reads the module intro');
select is((select count(*)::int from public.quizzes), 0, 'learner cannot read quiz answers');
select throws_ok($$insert into public.courses (title) values ('Mine')$$, '42501', null, 'learner cannot create a course');
update public.modules set intro = 'hacked' where id = 'd2000000-0000-0000-0000-000000000001';
update public.lessons set bunny_video_id = 'hacked' where id = 'e2000000-0000-0000-0000-000000000001';
delete from public.lessons where id = 'e2000000-0000-0000-0000-000000000001';
reset role;
select is((select intro from public.modules where id = 'd2000000-0000-0000-0000-000000000001'), 'Updated intro', 'learner update of an intro changes nothing');
select is((select bunny_video_id from public.lessons where id = 'e2000000-0000-0000-0000-000000000001'), '0b2f8f7e-1111-4c4c-9d9d-123456789abc', 'learner update of a video changes nothing');

-- ----------------------------------------------------------- manager
select set_config('request.jwt.claim.sub','b2000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok($$insert into public.modules (course_id, title) values ('c2000000-0000-0000-0000-000000000001','Sneaky')$$, '42501', null, 'manager cannot add a module');
select throws_ok($$insert into public.quizzes (lesson_id, questions) values ('e2000000-0000-0000-0000-000000000001','[]')$$, '42501', null, 'manager cannot write questions');
reset role;

-- --------------------------------------------------------------- privileges
select ok(not has_function_privilege('authenticated', 'public.quiz_questions_problem(jsonb)', 'execute'), 'shape checker is internal');
select ok(not has_function_privilege('anon', 'public.quiz_questions_problem(jsonb)', 'execute'), 'anon cannot call the shape checker');

select * from finish();
rollback;

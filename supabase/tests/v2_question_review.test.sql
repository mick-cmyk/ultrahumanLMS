-- Question review: changing questions, written prompts or the before-video
-- sentence clears a lesson's review; only admins can tick it again; pending
-- changes on a live course are held in lesson_drafts until an admin swaps
-- them in, which marks the lesson reviewed; learners never see drafts.
-- Self-contained: builds its own fixtures, never relies on seed data.
-- Run with `supabase test db` (pgTAP), or `npm run test:db:local`.
begin;
select * from no_plan();

-- ---------------------------------------------------------------- fixtures
insert into public.units (id, parent_id, kind, name) values
 ('a4000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'store', 'S1');
insert into auth.users (id, email) values
 ('b4000000-0000-0000-0000-000000000001', 'admin@qr.test'),
 ('b4000000-0000-0000-0000-000000000002', 'floor@qr.test'),
 ('b4000000-0000-0000-0000-000000000003', 'boss@qr.test');
update public.users set role='admin', unit_id='a4000000-0000-0000-0000-000000000001' where id='b4000000-0000-0000-0000-000000000001';
update public.users set role='learner', unit_id='a4000000-0000-0000-0000-000000000002' where id='b4000000-0000-0000-0000-000000000002';
update public.users set role='manager', unit_id='a4000000-0000-0000-0000-000000000002' where id='b4000000-0000-0000-0000-000000000003';
insert into public.user_scopes (user_id, unit_id) values ('b4000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000002');

insert into public.courses (id, title) values ('c4000000-0000-0000-0000-000000000001', 'Review me');
insert into public.modules (id, course_id, title) values ('d4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 'M1');
insert into public.lessons (id, module_id, title) values ('e4000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000001', 'L1');

-- ---------------------------------------------------------------- shape check
select is(public.written_prompts_problem('[]'), null, 'no prompts is fine');
select is(public.written_prompts_problem('[{"id":"w1","prompt":"Why?","model_answer":null,"max_words":40}]'), null, 'a good prompt passes');
select is(public.written_prompts_problem('[{"id":"w1","prompt":"a"},{"id":"w1","prompt":"b"}]'), 'written prompt 2 repeats the id w1', 'prompt ids are unique');
select is(public.written_prompts_problem('[{"id":"w1","prompt":"a","max_words":3}]'), 'written prompt 1 has a word limit outside 5 to 300', 'word limit range');
select is(public.written_prompts_problem('{"x":1}'), 'written prompts must be a list', 'must be a list');

-- ---------------------------------------------------------------- draft course
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$insert into public.quizzes (lesson_id, questions) values ('e4000000-0000-0000-0000-000000000001',
  '[{"id":"q1","text":"a","options":["x","y"],"correct_index":0,"explanation":"e"}]')$$, 'admin adds questions');
select is((select reviewed_at from public.lessons where id = 'e4000000-0000-0000-0000-000000000001'), null, 'new questions start unreviewed');
select ok((public.mark_lesson_reviewed('e4000000-0000-0000-0000-000000000001') ->> 'reviewed_at') is not null, 'admin ticks the lesson reviewed');
select is((select reviewed_by from public.lessons where id = 'e4000000-0000-0000-0000-000000000001'), 'b4000000-0000-0000-0000-000000000001'::uuid, 'reviewer is recorded');
update public.quizzes set questions = '[{"id":"q1","text":"changed","options":["x","y"],"correct_index":1}]' where lesson_id = 'e4000000-0000-0000-0000-000000000001';
select is((select reviewed_at from public.lessons where id = 'e4000000-0000-0000-0000-000000000001'), null, 'editing questions clears the review');
select lives_ok($$select public.mark_lesson_reviewed('e4000000-0000-0000-0000-000000000001')$$, 'reviewed again');
update public.lessons set title = 'Renamed' where id = 'e4000000-0000-0000-0000-000000000001';
select ok((select reviewed_at is not null from public.lessons where id = 'e4000000-0000-0000-0000-000000000001'), 'renaming a lesson keeps the review');
update public.lessons set expectancy = 'You will explain it.' where id = 'e4000000-0000-0000-0000-000000000001';
select is((select reviewed_at from public.lessons where id = 'e4000000-0000-0000-0000-000000000001'), null, 'changing the before-video sentence clears the review');
select lives_ok($$select public.mark_lesson_reviewed('e4000000-0000-0000-0000-000000000001')$$, 'reviewed again');
insert into public.written_prompts (lesson_id, id, prompt) values ('e4000000-0000-0000-0000-000000000001', 'w1', 'Why?');
select is((select reviewed_at from public.lessons where id = 'e4000000-0000-0000-0000-000000000001'), null, 'adding a written prompt clears the review');
select lives_ok($$select public.mark_lesson_reviewed('e4000000-0000-0000-0000-000000000001', false)$$, 'admin can untick');
select lives_ok($$select public.mark_lesson_reviewed('e4000000-0000-0000-0000-000000000001')$$, 'and tick');
reset role;

update public.courses set published = true where id = 'c4000000-0000-0000-0000-000000000001';
insert into public.assignments (course_id, rule) values ('c4000000-0000-0000-0000-000000000001', '{"unit_ids":["a4000000-0000-0000-0000-000000000002"]}');

-- ---------------------------------------------------------------- pending change on a live course
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok($$insert into public.lesson_drafts (lesson_id, questions) values ('e4000000-0000-0000-0000-000000000001', '[{"id":"q1","text":"a","options":["x"],"correct_index":0}]')$$,
  '23514', null, 'a broken draft is refused');
select lives_ok($$insert into public.lesson_drafts (lesson_id, pass_mark, questions, written_prompts, expectancy, note) values
  ('e4000000-0000-0000-0000-000000000001', 0.6,
   '[{"id":"q1","text":"new version","options":["x","y","z"],"correct_index":2,"explanation":"because"},{"id":"q2","text":"second","options":["a","b"],"correct_index":0}]',
   '[{"id":"w2","prompt":"Explain it","model_answer":"Like this","max_words":40}]',
   'New sentence.', 'Imported from the question maker')$$, 'admin stages a change');
select ok((select reviewed_at is not null from public.lessons where id = 'e4000000-0000-0000-0000-000000000001'), 'a staged change leaves the live review alone');
select is((select questions -> 0 ->> 'text' from public.quizzes where lesson_id = 'e4000000-0000-0000-0000-000000000001'), 'changed', 'live questions unchanged while the change waits');
reset role;

-- learner sees the live version only
insert into public.lesson_progress (user_id, lesson_id, watch_pct, watched_at)
values ('b4000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000001', 1, now());
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(public.get_lesson_quiz('e4000000-0000-0000-0000-000000000001') -> 'questions' -> 0 ->> 'text', 'changed', 'learner gets the live questions');
select is((select count(*)::int from public.lesson_drafts), 0, 'learner cannot read drafts');
select throws_ok($$select public.apply_lesson_draft('e4000000-0000-0000-0000-000000000001')$$, null, null, 'learner cannot swap a change in');
select throws_ok($$select public.mark_lesson_reviewed('e4000000-0000-0000-0000-000000000001')$$, null, null, 'learner cannot review');
reset role;

-- manager can't either
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok($$select public.apply_lesson_draft('e4000000-0000-0000-0000-000000000001')$$, null, null, 'manager cannot swap a change in');
select throws_ok($$insert into public.lesson_drafts (lesson_id) values ('e4000000-0000-0000-0000-000000000001')$$, '42501', null, 'manager cannot stage a change');
reset role;

-- admin swaps it in
select set_config('request.jwt.claim.sub','b4000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$select public.apply_lesson_draft('e4000000-0000-0000-0000-000000000001')$$, 'admin swaps the change in');
select is((select jsonb_array_length(questions) from public.quizzes where lesson_id = 'e4000000-0000-0000-0000-000000000001'), 2, 'new questions are live');
select is((select pass_mark::numeric from public.quizzes where lesson_id = 'e4000000-0000-0000-0000-000000000001'), 0.6, 'new pass mark is live');
select is((select string_agg(id, ',' order by id) from public.written_prompts where lesson_id = 'e4000000-0000-0000-0000-000000000001'), 'w2', 'prompts replaced');
select is((select expectancy from public.lessons where id = 'e4000000-0000-0000-0000-000000000001'), 'New sentence.', 'new sentence is live');
select ok((select reviewed_at is not null from public.lessons where id = 'e4000000-0000-0000-0000-000000000001'), 'swapping in marks the lesson reviewed');
select is((select count(*)::int from public.lesson_drafts), 0, 'the draft is gone');
select throws_ok($$select public.apply_lesson_draft('e4000000-0000-0000-0000-000000000001')$$, null, null, 'nothing left to swap in');
-- empty questions in a draft remove the quiz
insert into public.lesson_drafts (lesson_id, questions) values ('e4000000-0000-0000-0000-000000000001', '[]');
select lives_ok($$select public.apply_lesson_draft('e4000000-0000-0000-0000-000000000001')$$, 'a draft with no questions applies');
select is((select count(*)::int from public.quizzes where lesson_id = 'e4000000-0000-0000-0000-000000000001'), 0, 'and removes the quiz');
reset role;

-- deleting a lesson with a draft and a quiz cascades cleanly
insert into public.lessons (id, module_id, title) values ('e4000000-0000-0000-0000-000000000002', 'd4000000-0000-0000-0000-000000000001', 'L2');
insert into public.quizzes (lesson_id, questions) values ('e4000000-0000-0000-0000-000000000002', '[{"id":"q1","text":"a","options":["x","y"],"correct_index":0}]');
insert into public.lesson_drafts (lesson_id) values ('e4000000-0000-0000-0000-000000000002');
select lives_ok($$delete from public.lessons where id = 'e4000000-0000-0000-0000-000000000002'$$, 'lesson delete cascades through quiz and draft');

-- --------------------------------------------------------------- privileges
select ok(not has_function_privilege('authenticated', 'public.written_prompts_problem(jsonb)', 'execute'), 'prompt checker is internal');
select ok(not has_function_privilege('anon', 'public.apply_lesson_draft(uuid)', 'execute'), 'anon cannot swap changes in');
select ok(not has_function_privilege('anon', 'public.mark_lesson_reviewed(uuid, boolean)', 'execute'), 'anon cannot review');

select * from finish();
rollback;

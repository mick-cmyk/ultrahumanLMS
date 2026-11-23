-- Written answers: admins set prompts and the expectancy sentence, learners
-- only see a prompt once they've watched, the model answer stays hidden until
-- they've committed their own answer, an answer can't be rewritten after the
-- model answer is shown, and managers can read their team's answers.
-- Self-contained: builds its own fixtures, never relies on seed data.
-- Run with `supabase test db` (pgTAP), or `npm run test:db:local`.
begin;
select * from no_plan();

-- ---------------------------------------------------------------- fixtures
insert into public.units (id, parent_id, kind, name) values
 ('a3000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'store', 'S1'),
 ('a3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000001', 'store', 'S2');

insert into auth.users (id, email) values
 ('b3000000-0000-0000-0000-000000000001', 'admin@wa.test'),
 ('b3000000-0000-0000-0000-000000000002', 'floor@wa.test'),
 ('b3000000-0000-0000-0000-000000000003', 'boss@wa.test'),
 ('b3000000-0000-0000-0000-000000000004', 'other@wa.test');
update public.users set role='admin', unit_id='a3000000-0000-0000-0000-000000000001' where id='b3000000-0000-0000-0000-000000000001';
update public.users set role='learner', unit_id='a3000000-0000-0000-0000-000000000002' where id='b3000000-0000-0000-0000-000000000002';
update public.users set role='manager', unit_id='a3000000-0000-0000-0000-000000000002' where id='b3000000-0000-0000-0000-000000000003';
update public.users set role='learner', unit_id='a3000000-0000-0000-0000-000000000003' where id='b3000000-0000-0000-0000-000000000004';
insert into public.user_scopes (user_id, unit_id) values ('b3000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-000000000002');

insert into public.courses (id, title, published) values ('c3000000-0000-0000-0000-000000000001', 'Ideas', true);
insert into public.modules (id, course_id, title) values ('d3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'M1');
insert into public.lessons (id, module_id, title) values ('e3000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', 'L1');
insert into public.assignments (course_id, rule) values ('c3000000-0000-0000-0000-000000000001', '{"unit_ids":["a3000000-0000-0000-0000-000000000002"]}');

-- ----------------------------------------------------------- admin
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$update public.lessons set expectancy = 'You will explain to a new starter why a clear expectation comes first.' where id = 'e3000000-0000-0000-0000-000000000001'$$,
  'admin sets the expectancy sentence');
select lives_ok($$insert into public.written_prompts (lesson_id, id, sort_order, prompt, model_answer, max_words) values
  ('e3000000-0000-0000-0000-000000000001', 'p1', 1, 'In one sentence, why does the expectation come first?', 'Because most conflict is a missed expectation.', 40)$$,
  'admin adds a written prompt');
select throws_ok($$insert into public.written_prompts (lesson_id, id, prompt) values ('e3000000-0000-0000-0000-000000000001', 'p2', '   ')$$,
  '23514', null, 'a blank prompt is refused');
reset role;

-- ----------------------------------------------------------- learner, not watched
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select expectancy from public.lessons where id = 'e3000000-0000-0000-0000-000000000001'),
  'You will explain to a new starter why a clear expectation comes first.', 'learner reads the expectancy before watching');
select is(public.get_written_prompts('e3000000-0000-0000-0000-000000000001'), '[]'::jsonb, 'no prompts before the video is watched');
select throws_ok($$select public.submit_written_answer('e3000000-0000-0000-0000-000000000001', 'p1', 'guess')$$,
  null, null, 'cannot answer before watching');
select is((select count(*)::int from public.written_prompts), 0, 'learner cannot read prompt rows (model answers)');
reset role;

insert into public.lesson_progress (user_id, lesson_id, watch_pct, watched_at)
values ('b3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001', 1, now());

-- ----------------------------------------------------------- learner, watched
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(jsonb_array_length(public.get_written_prompts('e3000000-0000-0000-0000-000000000001')), 1, 'prompt shows once watched');
select is(public.get_written_prompts('e3000000-0000-0000-0000-000000000001') -> 0 ->> 'model_answer', null, 'model answer hidden before answering');
select is(public.get_written_prompts('e3000000-0000-0000-0000-000000000001') -> 0 ->> 'prompt',
  'In one sentence, why does the expectation come first?', 'prompt text comes through');
select throws_ok($$select public.submit_written_answer('e3000000-0000-0000-0000-000000000001', 'p1', '   ')$$,
  null, null, 'a blank answer is refused');
select throws_ok($$select public.submit_written_answer('e3000000-0000-0000-0000-000000000001', 'nope', 'x')$$,
  null, null, 'an unknown prompt is refused');
select is(public.submit_written_answer('e3000000-0000-0000-0000-000000000001', 'p1', 'People argue when nobody said what good looks like.') ->> 'model_answer',
  'Because most conflict is a missed expectation.', 'submitting returns the model answer');
select is(public.submit_written_answer('e3000000-0000-0000-0000-000000000001', 'p1', 'Copied the model answer') ->> 'answer',
  'People argue when nobody said what good looks like.', 'a second submit keeps the first answer');
select is(public.get_written_prompts('e3000000-0000-0000-0000-000000000001') -> 0 ->> 'model_answer',
  'Because most conflict is a missed expectation.', 'model answer shows after answering');
select throws_ok($$insert into public.written_answers (user_id, lesson_id, prompt_id, answer) values ('b3000000-0000-0000-0000-000000000002','e3000000-0000-0000-0000-000000000001','p1','direct')$$,
  '42501', null, 'learner cannot write answers directly');
select throws_ok($$update public.written_answers set answer = 'edited' where prompt_id = 'p1'$$,
  '42501', null, 'learner cannot edit an answer directly');
reset role;
select is((select answer from public.written_answers where user_id = 'b3000000-0000-0000-0000-000000000002'),
  'People argue when nobody said what good looks like.', 'learner update of an answer changes nothing');

-- ----------------------------------------------------------- learner elsewhere
insert into public.lesson_progress (user_id, lesson_id, watch_pct, watched_at)
values ('b3000000-0000-0000-0000-000000000004', 'e3000000-0000-0000-0000-000000000001', 1, now());
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select is(public.get_written_prompts('e3000000-0000-0000-0000-000000000001'), '[]'::jsonb, 'unassigned learner gets no prompts');
select is((select count(*)::int from public.written_answers), 0, 'learner cannot read other people''s answers');
reset role;

-- ----------------------------------------------------------- manager
select set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select count(*)::int from public.written_answers where user_id = 'b3000000-0000-0000-0000-000000000002'), 1, 'manager reads their team''s answers');
select throws_ok($$insert into public.written_prompts (lesson_id, id, prompt) values ('e3000000-0000-0000-0000-000000000001', 'p9', 'sneaky')$$,
  '42501', null, 'manager cannot add prompts');
reset role;

-- ----------------------------------------------------------- re-import keeps answers
delete from public.written_prompts where lesson_id = 'e3000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.written_answers), 1, 'removing a prompt keeps what people wrote');

-- --------------------------------------------------------------- privileges
select ok(not has_function_privilege('authenticated', 'public._written_prompts_open(uuid, uuid)', 'execute'), 'gate check is internal');
select ok(not has_function_privilege('anon', 'public.get_written_prompts(uuid)', 'execute'), 'anon cannot read prompts');
select ok(not has_function_privilege('anon', 'public.submit_written_answer(uuid, text, text)', 'execute'), 'anon cannot submit');

select * from finish();
rollback;

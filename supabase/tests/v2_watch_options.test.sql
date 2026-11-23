-- "Staff must watch each video" per course: unticking it sets the course's
-- video lessons to a 0 threshold (so opening the lesson counts), ticking it
-- puts 0.90 back, new lessons follow their course, and the existing watch,
-- quiz and completion rules keep working.
begin;
select * from no_plan();

insert into public.units (id, parent_id, kind, name) values
 ('a5000000-0000-0000-0000-000000000001', null, 'supplier', 'Sup'),
 ('a5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-000000000001', 'store', 'S1');
insert into auth.users (id, email) values
 ('b5000000-0000-0000-0000-000000000001', 'admin@w.test'),
 ('b5000000-0000-0000-0000-000000000002', 'floor@w.test');
update public.users set role='admin', unit_id='a5000000-0000-0000-0000-000000000001' where id='b5000000-0000-0000-0000-000000000001';
update public.users set unit_id='a5000000-0000-0000-0000-000000000002' where id='b5000000-0000-0000-0000-000000000002';

insert into public.courses (id, title, published) values ('c5000000-0000-0000-0000-000000000001', 'C', true);
insert into public.modules (id, course_id, title, sort_order) values ('d5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 'M', 1);
insert into public.lessons (id, module_id, title, sort_order) values ('e5000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'L1', 1);
insert into public.quizzes (lesson_id, pass_mark, questions) values ('e5000000-0000-0000-0000-000000000001', 0.8,
  '[{"id":"q1","text":"a","options":["x","y"],"correct_index":0}]');
insert into public.assignments (course_id, rule) values ('c5000000-0000-0000-0000-000000000001', '{"all":true}');

select is((select require_watch from public.courses where id = 'c5000000-0000-0000-0000-000000000001'), true, 'courses require watching by default');
select is((select watch_threshold from public.lessons where id = 'e5000000-0000-0000-0000-000000000001'), 0.90::numeric, 'lessons start at 90%');

-- admin unticks it
select set_config('request.jwt.claim.sub','b5000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select lives_ok($$update public.courses set require_watch = false where id = 'c5000000-0000-0000-0000-000000000001'$$, 'admin turns watching off');
select lives_ok($$insert into public.lessons (id, module_id, title, sort_order) values ('e5000000-0000-0000-0000-000000000002', 'd5000000-0000-0000-0000-000000000001', 'L2', 2)$$,
  'admin adds a lesson afterwards');
select lives_ok($$update public.lessons set video_aspect = 0.5625 where id = 'e5000000-0000-0000-0000-000000000001'$$, 'admin stores a portrait shape');
select throws_ok($$update public.lessons set video_aspect = 0 where id = 'e5000000-0000-0000-0000-000000000001'$$, '23514', null, 'a silly shape is refused');
reset role;
select is((select watch_threshold from public.lessons where id = 'e5000000-0000-0000-0000-000000000001'), 0::numeric, 'existing lesson drops to 0');
select is((select watch_threshold from public.lessons where id = 'e5000000-0000-0000-0000-000000000002'), 0::numeric, 'a new lesson follows the course');

-- a learner opening the lesson counts as watched, and the quiz opens
select set_config('request.jwt.claim.sub','b5000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select ok((select (public.record_watch_progress('e5000000-0000-0000-0000-000000000001', 0)).watched_at is not null), 'opening the lesson counts as watched');
select ok(public.get_lesson_quiz('e5000000-0000-0000-0000-000000000001') is not null, 'so the quiz is open without watching');
select lives_ok($$update public.courses set require_watch = true where id = 'c5000000-0000-0000-0000-000000000001'$$, 'a learner trying to change the setting is quietly ignored (RLS)');
reset role;
select is((select require_watch from public.courses where id = 'c5000000-0000-0000-0000-000000000001'), false, 'the setting is unchanged');

-- ticking it again puts 90% back (people already counted as watched stay counted)
update public.courses set require_watch = true where id = 'c5000000-0000-0000-0000-000000000001';
select is((select watch_threshold from public.lessons where id = 'e5000000-0000-0000-0000-000000000002'), 0.90::numeric, 'ticking it puts 90% back');
select ok((select watched_at is not null from public.lesson_progress where lesson_id = 'e5000000-0000-0000-0000-000000000001' and user_id = 'b5000000-0000-0000-0000-000000000002'),
  'progress already earned is kept');

select * from finish();
rollback;

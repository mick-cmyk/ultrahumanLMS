-- pgTAP tests for the Phase 2 quiz + re-test engine.
-- Runs against the seeded local db (supabase db reset + npm run seed), then
-- `npm run test:db`. Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- Impersonate a seeded learner for the auth.uid()-scoped functions.
create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.lesson(p_title text) returns uuid language sql as
  $$ select id from public.lessons where title = p_title $$;

do $$
begin
  if pg_temp.lesson('Why OLED blacks matter') is null then
    raise exception 'Seed data missing — run supabase db reset then npm run seed first';
  end if;
end $$;

select pg_temp.as_user('ava.jb.south@example.com');

-- Quiz locked until watched.
select is(public.get_lesson_quiz(pg_temp.lesson('Why OLED blacks matter')), null,
  'quiz is null before the lesson is watched');

-- Watch both lessons.
select public.record_watch_progress(pg_temp.lesson('Why OLED blacks matter'), 0.95);
select public.record_watch_progress(pg_temp.lesson('OLED vs Mini-LED in 60 seconds'), 0.95);

-- Served quiz is stripped of answers.
select is(
  (public.get_lesson_quiz(pg_temp.lesson('Why OLED blacks matter')) -> 'questions' -> 0) ? 'correct_index',
  false, 'served quiz question hides correct_index');
select is(
  (public.get_lesson_quiz(pg_temp.lesson('Why OLED blacks matter')) -> 'questions' -> 0) ? 'options',
  true, 'served quiz question keeps options');

-- Scoring: all correct passes.
select is(
  (public.record_quiz_attempt(pg_temp.lesson('Why OLED blacks matter'),
    '{"oled-blacks-q1":1,"oled-blacks-q2":1,"oled-blacks-q3":1}'::jsonb) ->> 'passed')::boolean,
  true, 'all-correct attempt passes');

-- Feedback reveals correct_index + explanation after submitting.
select is(
  (public.record_quiz_attempt(pg_temp.lesson('Why OLED blacks matter'),
    '{"oled-blacks-q1":0,"oled-blacks-q2":0,"oled-blacks-q3":0}'::jsonb)
    -> 'results' -> 0) ? 'explanation',
  true, 'attempt feedback includes explanation');

-- Below pass mark fails (1 of 3 = 0.33 < 0.8).
select is(
  (public.record_quiz_attempt(pg_temp.lesson('OLED vs Mini-LED in 60 seconds'),
    '{"oled-mini-q1":1,"oled-mini-q2":0,"oled-mini-q3":0}'::jsonb) ->> 'passed')::boolean,
  false, 'one-of-three attempt fails the 80% pass mark');

-- Module not complete yet → no retest.
select is(
  (select count(*) from public.retests r join public.modules m on m.id = r.module_id
   where m.title = 'Panel technology'
     and r.user_id = (select id from public.users where email='ava.jb.south@example.com')),
  0::bigint, 'no retest while module incomplete');

-- Pass the second lesson → module complete → retest created, pending, +5 days.
select public.record_quiz_attempt(pg_temp.lesson('OLED vs Mini-LED in 60 seconds'),
  '{"oled-mini-q1":1,"oled-mini-q2":1,"oled-mini-q3":1}'::jsonb);

select is(
  (select status from public.retests r join public.modules m on m.id = r.module_id
   where m.title='Panel technology'
     and r.user_id=(select id from public.users where email='ava.jb.south@example.com')),
  'pending', 'completing the module creates a pending retest');

select is(
  (select round(extract(epoch from (due_at - now()))/86400)::int
   from public.retests r join public.modules m on m.id = r.module_id
   where m.title='Panel technology'
     and r.user_id=(select id from public.users where email='ava.jb.south@example.com')),
  5, 'retest is due in 5 days');

select is(public.module_is_complete(
  (select id from public.users where email='ava.jb.south@example.com'),
  (select id from public.modules where title='Panel technology')),
  true, 'module_is_complete true once all lessons done');

-- ---- Re-test engine (token-scoped) ----
select set_config('request.jwt.claims', '', true); -- drop the learner claim

-- Build a token for the created retest.
create function pg_temp.retest_id() returns uuid language sql as $$
  select r.id from public.retests r join public.modules m on m.id = r.module_id
  where m.title='Panel technology'
    and r.user_id=(select id from public.users where email='ava.jb.south@example.com')
$$;

insert into public.retest_tokens(token, retest_id, expires_at)
  values ('t_valid', pg_temp.retest_id(), now() + interval '14 days'),
         ('t_used',  pg_temp.retest_id(), now() + interval '14 days'),
         ('t_exp',   pg_temp.retest_id(), now() - interval '1 day');
update public.retest_tokens set used_at = now() where token = 't_used';

select is((public.build_retest('t_valid', 4) ->> 'valid')::boolean, true,
  'build_retest accepts a valid token');
select is(jsonb_array_length(public.build_retest('t_valid', 4) -> 'questions'), 4,
  'build_retest samples the requested number of questions');
select is((public.build_retest('t_valid', 4) -> 'questions' -> 0) ? 'correct_index', false,
  'built retest questions hide correct_index');
select is(public.build_retest('t_used') ->> 'reason', 'used',
  'build_retest rejects a used token');
select is(public.build_retest('t_exp') ->> 'reason', 'expired',
  'build_retest rejects an expired token');

-- Grade a pass, then confirm the token is single-use.
select is((public.grade_retest('t_valid', '{"oled-blacks-q1":1,"oled-mini-q1":1}'::jsonb) ->> 'passed')::boolean,
  true, 'grade_retest passes on correct answers');
select is(public.grade_retest('t_valid', '{"oled-blacks-q1":1}'::jsonb) ->> 'reason', 'used',
  'grade_retest refuses to reuse a spent token');
select is((select status from public.retests where id = pg_temp.retest_id()), 'passed',
  'passing a retest marks it passed (retention-verified)');

select * from finish();
rollback;

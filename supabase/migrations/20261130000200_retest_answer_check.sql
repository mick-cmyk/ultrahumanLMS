-- The quick check, one question at a time, marked straight away with the
-- question maker's explanation (like the quiz after a video).
--
-- The quick check is what proves someone remembered, so the first answer to
-- each question is the one that counts, and the database holds it:
--   * check_retest_answer stores the first answer to a question for this
--     cycle of the quick check (retests.attempts), then marks it. Asking again
--     returns the stored answer's marking, never a new one.
--   * grade_my_retest (recreated below, otherwise unchanged) lays the stored
--     answers over whatever the browser sends, so a checked answer can't be
--     changed at the end. Reloading the page for different questions doesn't
--     help either: every checked answer counts.
-- Each failed cycle bumps retests.attempts, so the next quick check starts
-- with a clean slate.

create table public.retest_answers (
  retest_id   uuid not null references public.retests (id) on delete cascade,
  attempt     integer not null check (attempt >= 0),
  question_id text not null check (length(question_id) between 1 and 100),
  chosen      integer not null check (chosen >= 0),
  answered_at timestamptz not null default now(),
  primary key (retest_id, attempt, question_id)
);
alter table public.retest_answers enable row level security;
-- No policies and no grants: only the functions below touch it.
revoke all on public.retest_answers from public, anon, authenticated;

create function public.check_retest_answer(
  p_retest_id uuid,
  p_question_id text,
  p_chosen integer,
  p_max_cycles integer default 3
)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_module_id uuid;
  v_course_id uuid;
  v_status text;
  v_due timestamptz;
  v_attempts int;
  v_stored int;
  rec record;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user and u.active) then
    raise exception 'user is not active';
  end if;

  select r.module_id, r.status, r.due_at, r.attempts
    into v_module_id, v_status, v_due, v_attempts
  from public.retests r
  where r.id = p_retest_id and r.user_id = v_user;

  if v_module_id is null or v_status = 'passed' or v_attempts >= p_max_cycles or v_due > now() then
    raise exception 'this check is not available';
  end if;

  select m.course_id into v_course_id from public.modules m where m.id = v_module_id;

  -- The whole course pool, so the interleaved question from an earlier module
  -- resolves too (same as grade_my_retest).
  select question -> 'options' as options,
         (question ->> 'correct_index')::int as correct_index,
         question ->> 'explanation' as explanation,
         l.id as lesson_id,
         l.title as lesson_title
    into rec
  from public.lessons l
  join public.quizzes qz on qz.lesson_id = l.id
  join public.modules m on m.id = l.module_id
  cross join lateral jsonb_array_elements(qz.questions) as question
  where m.course_id = v_course_id
    and question ->> 'id' = p_question_id
  limit 1;

  if rec.lesson_id is null then
    raise exception 'question not found';
  end if;
  if p_chosen is null or p_chosen < 0 or p_chosen >= jsonb_array_length(rec.options) then
    raise exception 'pick one of the answers';
  end if;

  insert into public.retest_answers (retest_id, attempt, question_id, chosen)
  values (p_retest_id, v_attempts, p_question_id, p_chosen)
  on conflict (retest_id, attempt, question_id) do nothing;

  select a.chosen into v_stored
  from public.retest_answers a
  where a.retest_id = p_retest_id and a.attempt = v_attempts and a.question_id = p_question_id;

  return jsonb_build_object(
    'id', p_question_id,
    'chosen', v_stored,
    'correct', v_stored = rec.correct_index,
    'correct_index', rec.correct_index,
    'explanation', rec.explanation,
    'lesson_id', rec.lesson_id,
    'lesson_title', rec.lesson_title);
end;
$$;

revoke all on function public.check_retest_answer(uuid, text, integer, integer) from public, anon;
grant execute on function public.check_retest_answer(uuid, text, integer, integer) to authenticated;

-- grade_my_retest as before, plus: stored first answers win.
create or replace function public.grade_my_retest(
  p_retest_id uuid,
  p_answers jsonb,
  p_pass_mark numeric default 0.80,
  p_requeue_delay_days integer default 4,
  p_max_cycles integer default 3
)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_module_id uuid;
  v_course_id uuid;
  v_status text;
  v_due timestamptz;
  v_attempts int;
  v_total int := 0;
  v_correct int := 0;
  v_score double precision;
  v_passed boolean;
  v_results jsonb := '[]'::jsonb;
  v_capped boolean := false;
  qid text;
  v_chosen int;
  rec record;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user and u.active) then
    raise exception 'user is not active';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'no_gradable_answers');
  end if;

  select r.module_id, r.status, r.due_at, r.attempts
    into v_module_id, v_status, v_due, v_attempts
  from public.retests r
  where r.id = p_retest_id and r.user_id = v_user
  for update;

  if v_module_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_status = 'passed' then
    return jsonb_build_object('ok', false, 'reason', 'already_passed');
  end if;
  if v_attempts >= p_max_cycles then
    return jsonb_build_object('ok', false, 'reason', 'capped');
  end if;
  if v_due > now() then
    return jsonb_build_object('ok', false, 'reason', 'not_due');
  end if;

  -- Answers already checked one at a time are the ones that count.
  p_answers := p_answers || coalesce(
    (select jsonb_object_agg(a.question_id, a.chosen)
       from public.retest_answers a
      where a.retest_id = p_retest_id and a.attempt = v_attempts),
    '{}'::jsonb);

  select m.course_id into v_course_id from public.modules m where m.id = v_module_id;

  -- Grade against the whole course pool so interleaved questions resolve.
  -- Capped at 50 answers so one request cannot spin the loop.
  for qid in select jsonb_object_keys(p_answers) limit 50
  loop
    v_chosen := nullif(p_answers ->> qid, '')::int;
    select question ->> 'id' as id,
           (question ->> 'correct_index')::int as correct_index,
           question ->> 'explanation' as explanation,
           l.id as lesson_id,
           l.title as lesson_title
      into rec
    from public.lessons l
    join public.quizzes qz on qz.lesson_id = l.id
    join public.modules m on m.id = l.module_id
    cross join lateral jsonb_array_elements(qz.questions) as question
    where m.course_id = v_course_id
      and question ->> 'id' = qid
    limit 1;

    if rec.id is null then
      continue;
    end if;

    v_total := v_total + 1;
    if v_chosen is not null and v_chosen = rec.correct_index then
      v_correct := v_correct + 1;
      v_results := v_results || jsonb_build_object(
        'id', qid, 'correct', true, 'lesson_id', rec.lesson_id, 'lesson_title', rec.lesson_title);
    else
      v_results := v_results || jsonb_build_object(
        'id', qid, 'correct', false, 'correct_index', rec.correct_index,
        'explanation', rec.explanation, 'lesson_id', rec.lesson_id, 'lesson_title', rec.lesson_title);
    end if;
  end loop;

  if v_total = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_gradable_answers');
  end if;

  v_score := v_correct::double precision / v_total;
  v_passed := v_score >= p_pass_mark;

  if v_passed then
    update public.retests
       set status = 'passed', passed_at = now(),
           attempts = attempts + 1, last_score = v_score
     where id = p_retest_id;
  else
    v_capped := (v_attempts + 1) >= p_max_cycles;
    update public.retests
       set status = 'requeued',
           attempts = attempts + 1,
           last_score = v_score,
           due_at = now() + make_interval(days => p_requeue_delay_days),
           sent_at = null,
           reminder_sent_at = null
     where id = p_retest_id;
  end if;

  return jsonb_build_object('ok', true, 'score', v_score, 'correct_count', v_correct,
                            'total', v_total, 'pass_mark', p_pass_mark, 'passed', v_passed,
                            'capped', v_capped, 'results', v_results);
end;
$$;

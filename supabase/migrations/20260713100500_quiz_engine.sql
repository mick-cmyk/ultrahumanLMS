-- Phase 2 — quiz engine: serving stripped questions, scoring attempts, and
-- creating the re-test row when a module is fully completed.
--
-- Scoring lives here (SECURITY DEFINER) so correct_index never has to be
-- readable by learners — quizzes RLS stays admin-only, and these functions
-- are the only learner-facing door to quiz content.

-- ---------------------------------------------------------------------------
-- Completion helpers (spec: completion + retention definitions). Reused by
-- the quiz engine, the re-test flow, and reporting later.
-- ---------------------------------------------------------------------------

-- A lesson is complete when watched AND (its quiz is passed OR it has none).
create or replace function public.lesson_is_complete(p_user_id uuid, p_lesson_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1
    from public.lessons l
    left join public.quizzes q on q.lesson_id = l.id
    left join public.lesson_progress lp
           on lp.lesson_id = l.id and lp.user_id = p_user_id
    where l.id = p_lesson_id
      and lp.watched_at is not null
      and (q.id is null or lp.quiz_passed_at is not null)
  )
$$;

-- A module is complete when every one of its lessons is complete.
create or replace function public.module_is_complete(p_user_id uuid, p_module_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select not exists (
    select 1
    from public.lessons l
    where l.module_id = p_module_id
      and not public.lesson_is_complete(p_user_id, l.id)
  )
  and exists (select 1 from public.lessons l where l.module_id = p_module_id)
$$;

-- ---------------------------------------------------------------------------
-- get_lesson_quiz — the quiz as the learner is allowed to see it: no
-- correct_index, no explanations, and only once the video is watched.
-- Returns null when the lesson has no quiz or the video isn't watched yet.
-- ---------------------------------------------------------------------------

create or replace function public.get_lesson_quiz(p_lesson_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_pass_mark numeric;
  v_questions jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- Must be assigned, published, and already watched.
  if not exists (
    select 1
    from public.lessons l
    join public.modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    join public.lesson_progress lp
      on lp.lesson_id = l.id and lp.user_id = v_user
    where l.id = p_lesson_id
      and c.published
      and public.user_sees_course(c.id)
      and lp.watched_at is not null
  ) then
    return null;
  end if;

  select q.pass_mark,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', question ->> 'id',
               'text', question ->> 'text',
               'options', question -> 'options'
             )
             order by ord
           ),
           '[]'::jsonb
         )
    into v_pass_mark, v_questions
  from public.quizzes q
  left join lateral jsonb_array_elements(q.questions) with ordinality as qs(question, ord)
    on true
  where q.lesson_id = p_lesson_id
  group by q.pass_mark;

  if v_pass_mark is null then
    return null; -- watch-only lesson
  end if;

  return jsonb_build_object('pass_mark', v_pass_mark, 'questions', v_questions);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_quiz_attempt — score an attempt, update progress, and (on the pass
-- that completes the module) create the pending re-test row.
--
-- p_answers shape: { "<question_id>": <chosen_option_index>, ... }
-- Returns: {
--   score, correct_count, total, pass_mark, passed,
--   results: [ { id, chosen, correct_index, correct, explanation } ]
-- }
-- Revealing correct_index + explanation here is intentional — feedback is the
-- re-teach moment, and it only happens *after* the answer is submitted.
--
-- p_retest_delay_days defaults to 5 to match lib/constants.ts RETEST_DELAY_DAYS
-- for direct/db callers; the app passes the constant explicitly.
-- ---------------------------------------------------------------------------

create or replace function public.record_quiz_attempt(
  p_lesson_id uuid,
  p_answers jsonb,
  p_retest_delay_days integer default 5
)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_module_id uuid;
  v_pass_mark numeric;
  v_questions jsonb;
  v_total int;
  v_correct int := 0;
  v_score double precision;
  v_passed boolean;
  v_results jsonb := '[]'::jsonb;
  q jsonb;
  v_chosen int;
  v_correct_index int;
  v_is_correct boolean;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from public.users u where u.id = v_user and u.active) then
    raise exception 'user is not active';
  end if;

  -- Lesson must be assigned, published, watched, and have a quiz.
  select m.id, qz.pass_mark, qz.questions
    into v_module_id, v_pass_mark, v_questions
  from public.lessons l
  join public.modules m on m.id = l.module_id
  join public.courses c on c.id = m.course_id
  join public.quizzes qz on qz.lesson_id = l.id
  join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = v_user
  where l.id = p_lesson_id
    and c.published
    and public.user_sees_course(c.id)
    and lp.watched_at is not null;

  if v_module_id is null then
    raise exception 'quiz not available — watch the lesson first';
  end if;

  v_total := jsonb_array_length(v_questions);
  if v_total = 0 then
    raise exception 'quiz has no questions';
  end if;

  for q in select * from jsonb_array_elements(v_questions)
  loop
    v_correct_index := (q ->> 'correct_index')::int;
    v_chosen := nullif(p_answers ->> (q ->> 'id'), '')::int;
    v_is_correct := v_chosen is not null and v_chosen = v_correct_index;
    if v_is_correct then
      v_correct := v_correct + 1;
    end if;
    v_results := v_results || jsonb_build_object(
      'id', q ->> 'id',
      'chosen', v_chosen,
      'correct_index', v_correct_index,
      'correct', v_is_correct,
      'explanation', q ->> 'explanation'
    );
  end loop;

  v_score := v_correct::double precision / v_total;
  v_passed := v_score >= v_pass_mark;

  -- Update progress: best score kept, attempts counted, pass stamped once.
  insert into public.lesson_progress as lp (user_id, lesson_id, watch_pct,
                                            quiz_score, quiz_attempts, quiz_passed_at)
  values (v_user, p_lesson_id, 0, v_score, 1,
          case when v_passed then now() end)
  on conflict (user_id, lesson_id) do update
    set quiz_score    = greatest(coalesce(lp.quiz_score, 0), excluded.quiz_score),
        quiz_attempts = lp.quiz_attempts + 1,
        quiz_passed_at = coalesce(lp.quiz_passed_at,
                                  case when v_passed then now() end);

  -- If this pass completed the module, open a re-test (idempotent).
  if v_passed and public.module_is_complete(v_user, v_module_id) then
    insert into public.retests (user_id, module_id, due_at, status)
    values (v_user, v_module_id, now() + make_interval(days => p_retest_delay_days), 'pending')
    on conflict (user_id, module_id) do nothing;
  end if;

  return jsonb_build_object(
    'score', v_score,
    'correct_count', v_correct,
    'total', v_total,
    'pass_mark', v_pass_mark,
    'passed', v_passed,
    'results', v_results
  );
end;
$$;

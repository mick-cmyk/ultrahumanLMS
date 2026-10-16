-- Phase 2 — re-test engine: build a token's re-test (sampling + interleaving)
-- and grade it (requeue / cap logic). Both are keyed on the single-use email
-- token, not a session — the re-test player has no login. Only the service
-- role (route handlers, cron) may call them.

-- ---------------------------------------------------------------------------
-- build_retest — the question set for a token, as the taker may see it:
-- stripped of correct answers. Samples p_count questions from the module's
-- pool, then interleaves one question from an older passed module in the same
-- course (spec: "replace one question with a random question from an older
-- module"). Does NOT consume the token — only grading does.
-- ---------------------------------------------------------------------------

create or replace function public.build_retest(p_token text, p_count integer default 4)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  v_retest_id uuid;
  v_user uuid;
  v_module_id uuid;
  v_module_sort int;
  v_course_id uuid;
  v_module_title text;
  v_course_title text;
  v_status text;
  v_used timestamptz;
  v_expires timestamptz;
  v_questions jsonb;
  v_interleaved jsonb;
begin
  select rt.retest_id, r.user_id, r.module_id, r.status, rt.used_at, rt.expires_at
    into v_retest_id, v_user, v_module_id, v_status, v_used, v_expires
  from public.retest_tokens rt
  join public.retests r on r.id = rt.retest_id
  where rt.token = p_token;

  if v_retest_id is null then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  if v_used is not null then
    return jsonb_build_object('valid', false, 'reason', 'used');
  end if;
  if v_expires <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;
  if v_status = 'passed' then
    return jsonb_build_object('valid', false, 'reason', 'already_passed');
  end if;

  select m.sort_order, m.course_id, m.title, c.title
    into v_module_sort, v_course_id, v_module_title, v_course_title
  from public.modules m
  join public.courses c on c.id = m.course_id
  where m.id = v_module_id;

  -- Sample from this module's pool.
  select coalesce(jsonb_agg(q order by q_rand), '[]'::jsonb)
    into v_questions
  from (
    select jsonb_build_object(
             'id', question ->> 'id',
             'text', question ->> 'text',
             'options', question -> 'options',
             'lesson_id', l.id
           ) as q,
           random() as q_rand
    from public.lessons l
    join public.quizzes qz on qz.lesson_id = l.id
    cross join lateral jsonb_array_elements(qz.questions) as question
    where l.module_id = v_module_id
    order by q_rand
    limit greatest(p_count, 1)
  ) sampled;

  -- Interleave: one random question from an older passed module in this course.
  select jsonb_build_object(
           'id', question ->> 'id',
           'text', question ->> 'text',
           'options', question -> 'options',
           'lesson_id', l.id
         )
    into v_interleaved
  from public.lessons l
  join public.quizzes qz on qz.lesson_id = l.id
  cross join lateral jsonb_array_elements(qz.questions) as question
  join public.modules m on m.id = l.module_id
  join public.retests r2 on r2.module_id = m.id and r2.user_id = v_user
  where m.course_id = v_course_id
    and m.id <> v_module_id
    and m.sort_order < v_module_sort
    and r2.status = 'passed'
  order by random()
  limit 1;

  -- Replace the last sampled question with the interleaved one (keeps count).
  if v_interleaved is not null and jsonb_array_length(v_questions) > 1 then
    v_questions := jsonb_set(
      v_questions,
      array[(jsonb_array_length(v_questions) - 1)::text],
      v_interleaved
    );
  end if;

  return jsonb_build_object(
    'valid', true,
    'retest_id', v_retest_id,
    'module_title', v_module_title,
    'course_title', v_course_title,
    'questions', v_questions
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- grade_retest — consume the token, score the answers, apply pass / requeue /
-- cap logic. p_answers shape: { "<question_id>": <chosen_option_index> }.
-- Grades against the whole course's question pool so interleaved questions
-- resolve. Returns feedback including which lessons to revisit on a miss.
--
-- p_requeue_delay_days / p_max_cycles / p_pass_mark default to the values in
-- lib/constants.ts; the cron/app pass them explicitly.
-- ---------------------------------------------------------------------------

create or replace function public.grade_retest(
  p_token text,
  p_answers jsonb,
  p_pass_mark numeric default 0.80,
  p_requeue_delay_days integer default 4,
  p_max_cycles integer default 3
)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_retest_id uuid;
  v_user uuid;
  v_module_id uuid;
  v_course_id uuid;
  v_status text;
  v_used timestamptz;
  v_expires timestamptz;
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
  select rt.retest_id, r.user_id, r.module_id, r.status, rt.used_at, rt.expires_at, r.attempts
    into v_retest_id, v_user, v_module_id, v_status, v_used, v_expires, v_attempts
  from public.retest_tokens rt
  join public.retests r on r.id = rt.retest_id
  where rt.token = p_token
  for update of rt;

  if v_retest_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_used is not null then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if v_expires <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_status = 'passed' then
    return jsonb_build_object('ok', false, 'reason', 'already_passed');
  end if;

  select m.course_id into v_course_id from public.modules m where m.id = v_module_id;

  -- Grade each answered question against the course pool (covers interleaving).
  for qid in select jsonb_object_keys(p_answers)
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
      continue; -- unknown question id, ignore
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

  -- Consume the token no matter the outcome — single use.
  update public.retest_tokens set used_at = now() where token = p_token;

  if v_passed then
    update public.retests
      set status = 'passed', passed_at = now(),
          attempts = attempts + 1, last_score = v_score
      where id = v_retest_id;
  else
    v_capped := (v_attempts + 1) >= p_max_cycles;
    update public.retests
      set status = 'requeued',
          attempts = attempts + 1,
          last_score = v_score,
          -- capped rows keep due_at but are excluded from dispatch by the
          -- attempts < max_cycles guard, so they surface in reporting instead.
          due_at = now() + make_interval(days => p_requeue_delay_days),
          -- new cycle: clear the previous cycle's email timestamps.
          sent_at = null,
          reminder_sent_at = null
      where id = v_retest_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'score', v_score,
    'correct_count', v_correct,
    'total', v_total,
    'pass_mark', p_pass_mark,
    'passed', v_passed,
    'capped', v_capped,
    'results', v_results
  );
end;
$$;

-- Token-scoped functions are server-only (route handlers / cron via service
-- role). Keep them off the API roles so a logged-in user can't brute tokens.
revoke all on function public.build_retest(text, integer) from public;
revoke all on function public.grade_retest(text, jsonb, numeric, integer, integer) from public;
grant execute on function public.build_retest(text, integer) to service_role;
grant execute on function public.grade_retest(text, jsonb, numeric, integer, integer) to service_role;

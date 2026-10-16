-- Learning engine: watch tracking, quizzes, completion, spaced re-tests.
--
-- Everything that writes lesson_progress or retests is a security definer
-- function in this file. Learners have no direct write access to either table.
--
-- Defaults below mirror lib/constants.ts (pass mark 0.8, delay 5 days,
-- requeue 4 days, max 3 cycles). The app passes the values explicitly.

-- ---------------------------------------------------------------------------
-- Completion helpers. They take a user id, so they are internal: service role
-- only, called from the other security definer functions below and from the
-- reporting functions.
-- ---------------------------------------------------------------------------
create function public.lesson_is_complete(p_user_id uuid, p_lesson_id uuid)
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

create function public.module_is_complete(p_user_id uuid, p_module_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select not exists (
    select 1 from public.lessons l
    where l.module_id = p_module_id
      and not public.lesson_is_complete(p_user_id, l.id)
  )
  and exists (select 1 from public.lessons l where l.module_id = p_module_id)
$$;

-- ---------------------------------------------------------------------------
-- record_watch_progress: the only write path for watch tracking. Own row
-- only, GREATEST(existing, incoming) so it never goes down, watched_at stamped
-- once when the lesson threshold is crossed, assigned and published courses
-- only, active users only.
-- ---------------------------------------------------------------------------
create function public.record_watch_progress(p_lesson_id uuid, p_watch_pct double precision)
returns public.lesson_progress language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_threshold numeric;
  v_pct double precision;
  v_row public.lesson_progress;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user and u.active) then
    raise exception 'user is not active';
  end if;

  select l.watch_threshold into v_threshold
  from public.lessons l
  join public.modules m on m.id = l.module_id
  join public.courses c on c.id = m.course_id
  where l.id = p_lesson_id
    and c.published
    and public.user_sees_course(c.id);

  if v_threshold is null then
    raise exception 'lesson not found or not assigned to you';
  end if;

  v_pct := greatest(0, least(1, coalesce(p_watch_pct, 0)));

  insert into public.lesson_progress as lp (user_id, lesson_id, watch_pct, watched_at)
  values (v_user, p_lesson_id, v_pct, case when v_pct >= v_threshold then now() end)
  on conflict (user_id, lesson_id) do update
    set watch_pct = greatest(lp.watch_pct, excluded.watch_pct),
        watched_at = coalesce(
          lp.watched_at,
          case when greatest(lp.watch_pct, excluded.watch_pct) >= v_threshold then now() end)
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_lesson_quiz: the quiz as the learner may see it (no answers, no
-- explanations), and only once the video is watched. Null for watch-only
-- lessons.
-- ---------------------------------------------------------------------------
create function public.get_lesson_quiz(p_lesson_id uuid)
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

  if not exists (
    select 1
    from public.lessons l
    join public.modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = v_user
    where l.id = p_lesson_id
      and c.published
      and public.user_sees_course(c.id)
      and lp.watched_at is not null
  ) then
    return null;
  end if;

  select q.pass_mark,
         coalesce(jsonb_agg(
           jsonb_build_object('id', question ->> 'id',
                              'text', question ->> 'text',
                              'options', question -> 'options')
           order by ord), '[]'::jsonb)
    into v_pass_mark, v_questions
  from public.quizzes q
  left join lateral jsonb_array_elements(q.questions) with ordinality as qs(question, ord) on true
  where q.lesson_id = p_lesson_id
  group by q.pass_mark;

  if v_pass_mark is null then
    return null;
  end if;
  return jsonb_build_object('pass_mark', v_pass_mark, 'questions', v_questions);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_quiz_attempt: score an attempt, update progress, and on the pass that
-- completes the module create the pending re-test.
-- p_answers: { "<question_id>": <chosen_option_index> }
-- ---------------------------------------------------------------------------
create function public.record_quiz_attempt(
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
    raise exception 'quiz not available: watch the lesson first';
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
      'id', q ->> 'id', 'chosen', v_chosen, 'correct_index', v_correct_index,
      'correct', v_is_correct, 'explanation', q ->> 'explanation');
  end loop;

  v_score := v_correct::double precision / v_total;
  v_passed := v_score >= v_pass_mark;

  insert into public.lesson_progress as lp (user_id, lesson_id, watch_pct,
                                            quiz_score, quiz_attempts, quiz_passed_at)
  values (v_user, p_lesson_id, 0, v_score, 1, case when v_passed then now() end)
  on conflict (user_id, lesson_id) do update
    set quiz_score     = greatest(coalesce(lp.quiz_score, 0), excluded.quiz_score),
        quiz_attempts  = lp.quiz_attempts + 1,
        quiz_passed_at = coalesce(lp.quiz_passed_at, case when v_passed then now() end);

  if v_passed and public.module_is_complete(v_user, v_module_id) then
    insert into public.retests (user_id, module_id, due_at, status)
    values (v_user, v_module_id, now() + make_interval(days => p_retest_delay_days), 'pending')
    on conflict (user_id, module_id) do nothing;
  end if;

  return jsonb_build_object('score', v_score, 'correct_count', v_correct, 'total', v_total,
                            'pass_mark', v_pass_mark, 'passed', v_passed, 'results', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- Re-tests, taken by a logged-in learner.
--
-- A re-test is open when it belongs to the caller, is not passed, is due, and
-- has cycles left. Failing requeues it with a future due date, which closes it
-- again until the next cycle, so spacing is enforced by due_at and not by
-- burning a token. Rows are locked while grading so a double tap grades once.
-- ---------------------------------------------------------------------------
create function public.my_open_retests(p_max_cycles integer default 3)
returns table (retest_id uuid, module_id uuid, module_title text,
               course_title text, due_at timestamptz, status text)
language sql stable security definer set search_path = public as
$$
  select r.id, m.id, m.title, c.title, r.due_at, r.status
  from public.retests r
  join public.modules m on m.id = r.module_id
  join public.courses c on c.id = m.course_id
  where r.user_id = auth.uid()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.active)
    and r.status in ('pending', 'sent', 'requeued')
    and r.due_at <= now()
    and r.attempts < p_max_cycles
  order by r.due_at
$$;

create function public.build_my_retest(
  p_retest_id uuid,
  p_count integer default 4,
  p_max_cycles integer default 3
)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_module_id uuid;
  v_status text;
  v_due timestamptz;
  v_attempts int;
  v_module_sort int;
  v_course_id uuid;
  v_module_title text;
  v_course_title text;
  v_questions jsonb;
  v_interleaved jsonb;
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

  if v_module_id is null then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  if v_status = 'passed' then
    return jsonb_build_object('valid', false, 'reason', 'already_passed');
  end if;
  if v_attempts >= p_max_cycles then
    return jsonb_build_object('valid', false, 'reason', 'capped');
  end if;
  if v_due > now() then
    return jsonb_build_object('valid', false, 'reason', 'not_due');
  end if;

  select m.sort_order, m.course_id, m.title, c.title
    into v_module_sort, v_course_id, v_module_title, v_course_title
  from public.modules m
  join public.courses c on c.id = m.course_id
  where m.id = v_module_id;

  select coalesce(jsonb_agg(q order by q_rand), '[]'::jsonb)
    into v_questions
  from (
    select jsonb_build_object('id', question ->> 'id', 'text', question ->> 'text',
                              'options', question -> 'options', 'lesson_id', l.id) as q,
           random() as q_rand
    from public.lessons l
    join public.quizzes qz on qz.lesson_id = l.id
    cross join lateral jsonb_array_elements(qz.questions) as question
    where l.module_id = v_module_id
    order by q_rand
    limit greatest(p_count, 1)
  ) sampled;

  -- Interleave: one random question from an older module this user has passed.
  select jsonb_build_object('id', question ->> 'id', 'text', question ->> 'text',
                            'options', question -> 'options', 'lesson_id', l.id)
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

  if v_interleaved is not null and jsonb_array_length(v_questions) > 1 then
    v_questions := jsonb_set(v_questions,
                             array[(jsonb_array_length(v_questions) - 1)::text],
                             v_interleaved);
  end if;

  return jsonb_build_object('valid', true, 'retest_id', p_retest_id,
                            'module_title', v_module_title,
                            'course_title', v_course_title,
                            'questions', v_questions);
end;
$$;

create function public.grade_my_retest(
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

-- ---------------------------------------------------------------------------
-- Email deep link: a token only starts a session. Service role only; the
-- /api/retest/start route calls check, creates the session, then marks used.
-- ---------------------------------------------------------------------------
create function public.check_retest_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  v_retest_id uuid;
  v_user uuid;
  v_status text;
  v_used timestamptz;
  v_expires timestamptz;
  v_email text;
  v_role text;
  v_active boolean;
begin
  select rt.retest_id, r.user_id, r.status, rt.used_at, rt.expires_at, u.email, u.role, u.active
    into v_retest_id, v_user, v_status, v_used, v_expires, v_email, v_role, v_active
  from public.retest_tokens rt
  join public.retests r on r.id = rt.retest_id
  join public.users u on u.id = r.user_id
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
  if not v_active then
    return jsonb_build_object('valid', false, 'reason', 'inactive');
  end if;
  if v_role <> 'learner' then
    return jsonb_build_object('valid', false, 'reason', 'not_learner');
  end if;

  return jsonb_build_object('valid', true, 'retest_id', v_retest_id,
                            'user_id', v_user, 'email', v_email);
end;
$$;

create function public.use_retest_token(p_token text)
returns void language sql security definer set search_path = public as
$$ update public.retest_tokens set used_at = now() where token = p_token and used_at is null $$;

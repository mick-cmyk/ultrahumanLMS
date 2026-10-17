-- A module whose last step is a watch-only lesson never got its re-test if the
-- learner passed the quizzes first and watched that lesson afterwards: only
-- record_quiz_attempt scheduled re-tests. record_watch_progress now does too,
-- so the re-test is created whichever order the module is finished in.
-- Same signature and grants; the delay matches record_quiz_attempt (5 days,
-- RETEST_DELAY_DAYS in lib/constants.ts).
create or replace function public.record_watch_progress(p_lesson_id uuid, p_watch_pct double precision)
returns public.lesson_progress language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_threshold numeric;
  v_module_id uuid;
  v_pct double precision;
  v_row public.lesson_progress;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user and u.active) then
    raise exception 'user is not active';
  end if;

  select l.watch_threshold, l.module_id into v_threshold, v_module_id
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

  if v_row.watched_at is not null and public.module_is_complete(v_user, v_module_id) then
    insert into public.retests (user_id, module_id, due_at, status)
    values (v_user, v_module_id, now() + make_interval(days => 5), 'pending')
    on conflict (user_id, module_id) do nothing;
  end if;

  return v_row;
end;
$$;

-- record_watch_progress(lesson_id, watch_pct) — the only write path for
-- watch tracking. Called by the /api/progress route handler with the
-- learner's own session.
--
-- Guarantees (spec):
--   * watch_pct never decreases — GREATEST(existing, incoming), atomically
--   * watched_at is stamped once, when the max pct first crosses the
--     lesson's watch_threshold
--   * only the authenticated user's own row, only for lessons in published
--     courses actually assigned to them, only while active
--
-- The client sends cumulative-unique-seconds ÷ duration, so scrubbing to the
-- end produces a tiny pct, not 100%. The server can't verify that split —
-- it just guarantees monotonicity and the threshold stamp.

create or replace function public.record_watch_progress(
  p_lesson_id uuid,
  p_watch_pct double precision
)
returns public.lesson_progress
language plpgsql
security definer
set search_path = public
as $$
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
  values (v_user, p_lesson_id, v_pct,
          case when v_pct >= v_threshold then now() end)
  on conflict (user_id, lesson_id) do update
    set watch_pct = greatest(lp.watch_pct, excluded.watch_pct),
        watched_at = coalesce(
          lp.watched_at,
          case when greatest(lp.watch_pct, excluded.watch_pct) >= v_threshold then now() end)
  returning * into v_row;

  return v_row;
end;
$$;

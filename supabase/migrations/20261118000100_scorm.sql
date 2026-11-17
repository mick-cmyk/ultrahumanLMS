-- SCORM 1.2 import (docs/HANDOVER-CHAT-2026-11-18.md section 2).
--
-- A lesson is now either a video ('video', the default) or an imported SCORM
-- package ('scorm'). The package's files live in the private 'scorm' storage
-- bucket under <package_id>/<path>, and the app serves them from its own
-- origin so the package can find the SCORM API through window.parent.
--
-- A package reporting 'passed' or 'completed' stamps watched_at and
-- quiz_passed_at on lesson_progress, so lesson_is_complete, module_is_complete
-- and every report treat it like a finished video lesson with no change.
-- SCORM lessons have no questions of their own, so they add nothing to the
-- delayed re-test; a module that has no LMS quiz questions at all gets no
-- re-test (there would be nothing to ask).
--
-- Same rules as the rest of v2: new objects get no grants until listed at the
-- bottom, learners never write progress directly, and authorisation is
-- decided here from auth.uid().

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.scorm_packages (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  version     text not null default '1.2' check (version = '1.2'),
  -- Path of the launch file inside the package, e.g. 'index_lms.html'.
  launch_href text not null
              check (launch_href !~ '(^/|\.\.|\\|^[a-z]+:)'),
  -- The manifest's useful parts (organisation title, mastery score, files).
  manifest    jsonb not null default '{}'::jsonb,
  file_count  integer not null default 0,
  total_bytes bigint not null default 0,
  uploaded_by uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.scorm_packages enable row level security;

alter table public.lessons
  add column kind text not null default 'video' check (kind in ('video', 'scorm')),
  add column scorm_package_id uuid references public.scorm_packages (id) on delete restrict,
  add constraint lessons_scorm_has_package
    check ((kind = 'scorm') = (scorm_package_id is not null));

create index lessons_scorm_package_idx on public.lessons (scorm_package_id)
  where scorm_package_id is not null;

-- One row per learner per SCORM lesson: the runtime state the package asked us
-- to keep, so it can resume. Written only by record_scorm_commit.
create table public.scorm_attempts (
  user_id        uuid not null references public.users (id) on delete cascade,
  lesson_id      uuid not null references public.lessons (id) on delete cascade,
  lesson_status  text not null default 'not attempted'
                 check (lesson_status in ('passed', 'completed', 'failed',
                                          'incomplete', 'browsed', 'not attempted')),
  score_raw      numeric,
  score_min      numeric,
  score_max      numeric,
  lesson_location text not null default '',
  suspend_data   text not null default '',
  total_seconds  integer not null default 0 check (total_seconds >= 0),
  commits        integer not null default 0,
  first_at       timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz,
  primary key (user_id, lesson_id)
);
alter table public.scorm_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Packages: admins manage them; anyone who can see a lesson using the package
-- can read its row (the player needs launch_href).
create policy scorm_packages_select on public.scorm_packages
  for select using (
    public.app_role() = 'admin'
    -- Qualified on purpose: a bare `id` here would resolve to lessons.id.
    or exists (select 1 from public.lessons l
               where l.scorm_package_id = scorm_packages.id)
  );
create policy scorm_packages_write_admin on public.scorm_packages
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- Attempts: readable by whoever can read the user (same as lesson_progress).
create policy scorm_attempts_select on public.scorm_attempts
  for select using (exists (select 1 from public.users u where u.id = user_id));

-- ---------------------------------------------------------------------------
-- Storage: private bucket, 50 MB per file (the free-plan ceiling).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('scorm', 'scorm', false, 52428800)
on conflict (id) do nothing;

-- Which package does a storage object belong to? Objects are stored as
-- <package_id>/<path>; anything else returns null and matches nothing.
create function public.scorm_object_package(p_name text)
returns uuid language sql immutable set search_path = public as
$$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

-- May the current user open files from this package? Admins always; anyone
-- else when a published course they are assigned uses it.
create function public.can_view_scorm_package(p_package_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select public.app_role() = 'admin'
      or exists (
        select 1
        from public.lessons l
        join public.modules m on m.id = l.module_id
        join public.courses c on c.id = m.course_id
        where l.scorm_package_id = p_package_id
          and c.published
          and public.user_sees_course(c.id)
      )
$$;

create policy scorm_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'scorm'
         and public.can_view_scorm_package(public.scorm_object_package(name)));
create policy scorm_objects_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'scorm' and public.app_role() = 'admin'
              and public.scorm_object_package(name) is not null);
create policy scorm_objects_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'scorm' and public.app_role() = 'admin')
  with check (bucket_id = 'scorm' and public.app_role() = 'admin');
create policy scorm_objects_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'scorm' and public.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Re-test scheduling, shared by the SCORM commit below. Only schedules when the
-- module is complete AND has at least one LMS quiz question to ask.
-- Internal: service role only.
-- ---------------------------------------------------------------------------
create function public._schedule_retest_if_due(p_user uuid, p_module uuid, p_delay_days integer)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if public.module_is_complete(p_user, p_module)
     and exists (
       select 1 from public.lessons l
       join public.quizzes qz on qz.lesson_id = l.id
       where l.module_id = p_module and jsonb_array_length(qz.questions) > 0
     )
  then
    insert into public.retests (user_id, module_id, due_at, status)
    values (p_user, p_module, now() + make_interval(days => p_delay_days), 'pending')
    on conflict (user_id, module_id) do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_scorm_launch: everything the player needs to start or resume. Null when
-- the lesson is not a SCORM lesson the caller may take. Admins may open any
-- SCORM lesson to check it runs: 'preview' is true when they aren't assigned
-- it, and the player then saves nothing (record_scorm_commit would refuse).
-- ---------------------------------------------------------------------------
create function public.get_scorm_launch(p_lesson_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_pkg public.scorm_packages;
  v_att public.scorm_attempts;
  v_name text;
  v_assigned boolean;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select p.*, (c.published and public.user_sees_course(c.id))
    into v_pkg.id, v_pkg.title, v_pkg.version, v_pkg.launch_href, v_pkg.manifest,
         v_pkg.file_count, v_pkg.total_bytes, v_pkg.uploaded_by, v_pkg.created_at,
         v_assigned
  from public.lessons l
  join public.modules m on m.id = l.module_id
  join public.courses c on c.id = m.course_id
  join public.scorm_packages p on p.id = l.scorm_package_id
  where l.id = p_lesson_id
    and l.kind = 'scorm';

  if v_pkg.id is null or not (v_assigned or public.app_role() = 'admin') then
    return null;
  end if;

  select * into v_att from public.scorm_attempts a
  where a.user_id = v_user and a.lesson_id = p_lesson_id;

  select coalesce(u.full_name, u.email) into v_name from public.users u where u.id = v_user;

  return jsonb_build_object(
    'package_id', v_pkg.id,
    'launch_href', v_pkg.launch_href,
    'mastery_score', v_pkg.manifest -> 'mastery_score',
    'student_id', v_user,
    'student_name', v_name,
    'preview', not v_assigned,
    'attempt', case when v_att.user_id is null then null else jsonb_build_object(
      'lesson_status', v_att.lesson_status,
      'score_raw', v_att.score_raw,
      'score_min', v_att.score_min,
      'score_max', v_att.score_max,
      'lesson_location', v_att.lesson_location,
      'suspend_data', v_att.suspend_data,
      'total_seconds', v_att.total_seconds,
      'completed_at', v_att.completed_at) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_scorm_commit: the only write path for SCORM state. Called by the
-- player on LMSCommit / LMSFinish. Own row only, assigned published courses
-- only, active users only. Completion never goes backwards: once a package
-- has reported passed or completed, a later 'incomplete' or 'failed' (a
-- learner reopening it) keeps the lesson complete.
--
-- p_state keys (SCORM 1.2 names, all optional):
--   lesson_status, score_raw, score_min, score_max, lesson_location,
--   suspend_data
-- p_session_seconds is added to total time; the player sends it once per
-- session on LMSFinish.
-- ---------------------------------------------------------------------------
create function public.record_scorm_commit(
  p_lesson_id uuid,
  p_state jsonb,
  p_session_seconds integer default 0,
  p_retest_delay_days integer default 5
)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_module_id uuid;
  v_status text := nullif(p_state ->> 'lesson_status', '');
  v_raw numeric;
  v_min numeric;
  v_max numeric;
  v_done boolean;
  v_score double precision;
  v_att public.scorm_attempts;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user and u.active) then
    raise exception 'user is not active';
  end if;

  select l.module_id into v_module_id
  from public.lessons l
  join public.modules m on m.id = l.module_id
  join public.courses c on c.id = m.course_id
  where l.id = p_lesson_id
    and l.kind = 'scorm'
    and c.published
    and public.user_sees_course(c.id);

  if v_module_id is null then
    raise exception 'lesson not found or not assigned to you';
  end if;

  if v_status is not null and v_status not in
     ('passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted') then
    raise exception 'invalid lesson_status %', v_status;
  end if;

  -- SCORM 1.2 scores are decimals in 0..100. Bad values are dropped, not fatal:
  -- a sloppy package should not lose the learner's completion.
  begin
    v_raw := nullif(p_state ->> 'score_raw', '')::numeric;
    v_min := nullif(p_state ->> 'score_min', '')::numeric;
    v_max := nullif(p_state ->> 'score_max', '')::numeric;
  exception when others then
    v_raw := null; v_min := null; v_max := null;
  end;
  if v_raw is not null and (v_raw < 0 or v_raw > 100) then v_raw := null; end if;
  if v_min is not null and (v_min < 0 or v_min > 100) then v_min := null; end if;
  if v_max is not null and (v_max <= 0 or v_max > 100) then v_max := null; end if;

  if length(coalesce(p_state ->> 'suspend_data', '')) > 65536 then
    raise exception 'suspend_data too large';
  end if;
  if length(coalesce(p_state ->> 'lesson_location', '')) > 255 then
    raise exception 'lesson_location too large';
  end if;

  v_done := v_status in ('passed', 'completed');

  insert into public.scorm_attempts as a
    (user_id, lesson_id, lesson_status, score_raw, score_min, score_max,
     lesson_location, suspend_data, total_seconds, commits, completed_at)
  values
    (v_user, p_lesson_id, coalesce(v_status, 'incomplete'), v_raw, v_min, v_max,
     coalesce(p_state ->> 'lesson_location', ''), coalesce(p_state ->> 'suspend_data', ''),
     greatest(0, least(coalesce(p_session_seconds, 0), 86400)), 1,
     case when v_done then now() end)
  on conflict (user_id, lesson_id) do update
    set lesson_status = case
          -- never step back from a finished state
          when a.completed_at is not null and coalesce(v_status, a.lesson_status)
               not in ('passed', 'completed') then a.lesson_status
          else coalesce(v_status, a.lesson_status) end,
        score_raw     = coalesce(v_raw, a.score_raw),
        score_min     = coalesce(v_min, a.score_min),
        score_max     = coalesce(v_max, a.score_max),
        lesson_location = coalesce(p_state ->> 'lesson_location', a.lesson_location),
        suspend_data  = coalesce(p_state ->> 'suspend_data', a.suspend_data),
        total_seconds = a.total_seconds
                        + greatest(0, least(coalesce(p_session_seconds, 0), 86400)),
        commits       = a.commits + 1,
        updated_at    = now(),
        completed_at  = coalesce(a.completed_at, case when v_done then now() end)
  returning * into v_att;

  if v_att.completed_at is not null then
    -- Score as a fraction for reporting, when the package gave one.
    if v_att.score_raw is not null then
      v_score := (v_att.score_raw - coalesce(v_att.score_min, 0))
                 / nullif(coalesce(v_att.score_max, 100) - coalesce(v_att.score_min, 0), 0);
      v_score := greatest(0, least(1, v_score));
    end if;

    insert into public.lesson_progress as lp
      (user_id, lesson_id, watch_pct, watched_at, quiz_score, quiz_attempts, quiz_passed_at)
    values (v_user, p_lesson_id, 1, v_att.completed_at, v_score, 1, v_att.completed_at)
    on conflict (user_id, lesson_id) do update
      set watch_pct      = 1,
          watched_at     = coalesce(lp.watched_at, excluded.watched_at),
          -- greatest() ignores nulls, so either side being set is enough.
          quiz_score     = greatest(lp.quiz_score, excluded.quiz_score),
          quiz_attempts  = greatest(lp.quiz_attempts, 1),
          quiz_passed_at = coalesce(lp.quiz_passed_at, excluded.quiz_passed_at);

    perform public._schedule_retest_if_due(v_user, v_module_id, p_retest_delay_days);
  end if;

  return jsonb_build_object(
    'lesson_status', v_att.lesson_status,
    'completed', v_att.completed_at is not null,
    'total_seconds', v_att.total_seconds);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_watch_progress must not complete a SCORM lesson: otherwise a learner
-- could post watch_pct = 1 for it and skip the package. Same body as
-- 20261017001300_retest_on_watch.sql plus `l.kind = 'video'`.
-- ---------------------------------------------------------------------------
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
    and l.kind = 'video'
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

-- ---------------------------------------------------------------------------
-- Grants (allowlist, as in 20261017001000_lockdown.sql)
-- ---------------------------------------------------------------------------
revoke all on public.scorm_packages, public.scorm_attempts from anon, authenticated;
grant all on public.scorm_packages, public.scorm_attempts to service_role;

grant select on public.scorm_packages, public.scorm_attempts to authenticated;
-- Admin import writes the package row through their own session, gated by RLS.
grant insert (id, title, version, launch_href, manifest, file_count, total_bytes, uploaded_by)
  on public.scorm_packages to authenticated;
grant update (title) on public.scorm_packages to authenticated;
grant delete on public.scorm_packages to authenticated;
-- lessons already allows admin insert/update; the two new columns ride on that.

revoke execute on function
  public.scorm_object_package(text),
  public.can_view_scorm_package(uuid),
  public._schedule_retest_if_due(uuid, uuid, integer),
  public.get_scorm_launch(uuid),
  public.record_scorm_commit(uuid, jsonb, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.scorm_object_package(text),
  public.can_view_scorm_package(uuid),
  public._schedule_retest_if_due(uuid, uuid, integer),
  public.get_scorm_launch(uuid),
  public.record_scorm_commit(uuid, jsonb, integer, integer)
  to service_role;

-- Used inside storage policies (run as the caller) and by the player.
grant execute on function
  public.scorm_object_package(text),
  public.can_view_scorm_package(uuid),
  public.get_scorm_launch(uuid),
  public.record_scorm_commit(uuid, jsonb, integer, integer)
  to authenticated;

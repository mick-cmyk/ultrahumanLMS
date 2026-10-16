-- Phase 3 — reporting + scope.
--
-- Two headline numbers everywhere (spec): Completed and Retention-verified,
-- with denominators from rule resolution against *active* users so the numbers
-- stay honest as staff churn. Every reporting function is scoped to the
-- viewer's role (admin = everyone, coordinator = their group's orgs, manager =
-- their store/org) via users_in_reporting_scope().

-- ---------------------------------------------------------------------------
-- Course-level completion helpers, built on the Phase 2 lesson/module ones.
-- ---------------------------------------------------------------------------

-- Completed = every lesson in the course is complete (watched + quiz passed
-- where a quiz exists). A course with no lessons is never "complete".
create or replace function public.course_is_complete(p_user_id uuid, p_course_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
           select 1 from public.lessons l
           join public.modules m on m.id = l.module_id
           where m.course_id = p_course_id
         )
     and not exists (
           select 1 from public.lessons l
           join public.modules m on m.id = l.module_id
           where m.course_id = p_course_id
             and not public.lesson_is_complete(p_user_id, l.id)
         )
$$;

-- A module is retention-verified when it's complete and its re-test is passed.
create or replace function public.module_is_retention_verified(p_user_id uuid, p_module_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select public.module_is_complete(p_user_id, p_module_id)
     and exists (
           select 1 from public.retests r
           where r.user_id = p_user_id and r.module_id = p_module_id and r.status = 'passed'
         )
$$;

-- Retention-verified = every module in the course is retention-verified.
create or replace function public.course_is_retention_verified(p_user_id uuid, p_course_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.modules m where m.course_id = p_course_id)
     and not exists (
           select 1 from public.modules m
           where m.course_id = p_course_id
             and not public.module_is_retention_verified(p_user_id, m.id)
         )
$$;

-- ---------------------------------------------------------------------------
-- users_in_reporting_scope — the active users the current viewer may report
-- on. This is where role scoping lives, once, for every reporting function.
-- ---------------------------------------------------------------------------

create or replace function public.users_in_reporting_scope()
returns table (
  id uuid, email text, full_name text,
  org_id uuid, org_name text,
  store_id uuid, store_name text, state text
)
language sql stable security definer set search_path = public as
$$
  select u.id, u.email, u.full_name,
         u.org_id, o.name as org_name,
         u.store_id, st.name as store_name, st.state
  from public.users u
  left join public.orgs o on o.id = u.org_id
  left join public.stores st on st.id = u.store_id
  where u.active
    and case public.app_role()
      when 'admin' then true
      when 'coordinator' then
        u.org_id in (select o2.id from public.orgs o2 where o2.group_id = public.app_group_id())
      when 'manager' then
        u.org_id = public.app_org_id()
        and (public.app_store_id() is null or u.store_id = public.app_store_id())
      else u.id = auth.uid()
    end
$$;

-- ---------------------------------------------------------------------------
-- report_course_rollup — one row per in-scope, assigned, active user for a
-- course, with completion + retention flags. Drives the drill-down and CSV.
-- ---------------------------------------------------------------------------

create or replace function public.report_course_rollup(p_course_id uuid)
returns table (
  user_id uuid, email text, full_name text,
  org_id uuid, org_name text,
  store_id uuid, store_name text, state text,
  completed boolean, retention_verified boolean
)
language sql stable security definer set search_path = public as
$$
  select s.id, s.email, s.full_name,
         s.org_id, s.org_name, s.store_id, s.store_name, s.state,
         public.course_is_complete(s.id, p_course_id),
         public.course_is_retention_verified(s.id, p_course_id)
  from public.users_in_reporting_scope() s
  where exists (
    select 1 from public.assignments a
    where a.course_id = p_course_id
      and public.user_matches_rule(s.id, a.rule)
  )
$$;

-- ---------------------------------------------------------------------------
-- report_courses_summary — the top-level table: per published course, how many
-- in-scope active users are assigned / completed / retention-verified.
-- ---------------------------------------------------------------------------

create or replace function public.report_courses_summary()
returns table (
  course_id uuid, title text,
  assigned bigint, completed bigint, retention_verified bigint
)
language sql stable security definer set search_path = public as
$$
  with scope as (select id from public.users_in_reporting_scope())
  select c.id, c.title,
         count(*) filter (where a.assigned) as assigned,
         count(*) filter (where a.assigned and public.course_is_complete(s.id, c.id)) as completed,
         count(*) filter (where a.assigned and public.course_is_retention_verified(s.id, c.id)) as retention_verified
  from public.courses c
  cross join scope s
  cross join lateral (
    select exists (
      select 1 from public.assignments asg
      where asg.course_id = c.id and public.user_matches_rule(s.id, asg.rule)
    ) as assigned
  ) a
  where c.published
  group by c.id, c.title
  order by c.title
$$;

-- ---------------------------------------------------------------------------
-- preview_rule_reach — "this will reach N people". Admin-only; counts active
-- users a draft rule would match. Powers the Assign screen's live preview.
-- ---------------------------------------------------------------------------

create or replace function public.preview_rule_reach(p_rule jsonb)
returns bigint language sql stable security definer set search_path = public as
$$
  select case when public.app_role() = 'admin' then (
    select count(*) from public.users u
    where u.active and public.user_matches_rule(u.id, p_rule)
  ) else 0 end
$$;

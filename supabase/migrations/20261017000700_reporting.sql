-- Reporting, scoped by the unit tree.
--
-- Two headline numbers everywhere: Completed and Retention-verified.
-- Denominators come from rule resolution against ACTIVE users in the viewer's
-- scope. The scope logic lives in users_in_scope_of(viewer), which is internal
-- (service role only, used by the weekly digest). Everything the app calls
-- wraps it with auth.uid(), so no caller can ask for someone else's view.

create function public.course_is_complete(p_user_id uuid, p_course_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.lessons l
                 join public.modules m on m.id = l.module_id
                 where m.course_id = p_course_id)
     and not exists (select 1 from public.lessons l
                     join public.modules m on m.id = l.module_id
                     where m.course_id = p_course_id
                       and not public.lesson_is_complete(p_user_id, l.id))
$$;

create function public.module_is_retention_verified(p_user_id uuid, p_module_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select public.module_is_complete(p_user_id, p_module_id)
     and exists (select 1 from public.retests r
                 where r.user_id = p_user_id and r.module_id = p_module_id and r.status = 'passed')
$$;

create function public.course_is_retention_verified(p_user_id uuid, p_course_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.modules m where m.course_id = p_course_id)
     and not exists (select 1 from public.modules m
                     where m.course_id = p_course_id
                       and not public.module_is_retention_verified(p_user_id, m.id))
$$;

-- Active users the viewer may report on. `ancestors` is the chain from the
-- root down to the user's unit as [{id, name, kind, depth}], so the report
-- pages can group by any level (retail brand, region, store) without knowing
-- what the brand calls them.
create function public.users_in_scope_of(p_viewer uuid)
returns table (id uuid, email text, full_name text,
               unit_id uuid, unit_name text, unit_kind text, state text,
               ancestors jsonb)
language sql stable security definer set search_path = public as
$$
  with v as (select vu.id, vu.role from public.users vu where vu.id = p_viewer and vu.active)
  select u.id, u.email, u.full_name,
         u.unit_id, un.name, un.kind, un.state,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name,
                                               'kind', a.kind, 'depth', p.ord - 1)
                            order by p.ord)
           from unnest(un.path) with ordinality as p(aid, ord)
           join public.units a on a.id = p.aid
         ), '[]'::jsonb)
  from public.users u
  cross join v
  left join public.units un on un.id = u.unit_id
  where u.active
    and case
      when v.role = 'admin' then true
      when v.role in ('manager', 'viewer') then
        u.unit_id is not null and public._in_scope(p_viewer, u.unit_id)
      else u.id = p_viewer
    end
$$;

create function public.users_in_reporting_scope()
returns table (id uuid, email text, full_name text,
               unit_id uuid, unit_name text, unit_kind text, state text,
               ancestors jsonb)
language sql stable security definer set search_path = public as
$$ select * from public.users_in_scope_of(auth.uid()) $$;

-- One row per in-scope, assigned, active user for a course.
create function public.report_course_rollup(p_course_id uuid)
returns table (user_id uuid, email text, full_name text,
               unit_id uuid, unit_name text, state text, ancestors jsonb,
               completed boolean, retention_verified boolean)
language sql stable security definer set search_path = public as
$$
  select s.id, s.email, s.full_name, s.unit_id, s.unit_name, s.state, s.ancestors,
         public.course_is_complete(s.id, p_course_id),
         public.course_is_retention_verified(s.id, p_course_id)
  from public.users_in_scope_of(auth.uid()) s
  where exists (
    select 1 from public.assignments a
    where a.course_id = p_course_id
      and public.user_matches_rule(s.id, a.rule)
  )
$$;

-- Internal worker: the per-course summary for an explicit viewer.
create function public.report_summary_for(p_viewer uuid)
returns table (course_id uuid, title text,
               assigned bigint, completed bigint, retention_verified bigint)
language sql stable security definer set search_path = public as
$$
  with scope as (select id from public.users_in_scope_of(p_viewer))
  select c.id, c.title,
         count(*) filter (where a.assigned),
         count(*) filter (where a.assigned and public.course_is_complete(s.id, c.id)),
         count(*) filter (where a.assigned and public.course_is_retention_verified(s.id, c.id))
  from public.courses c
  cross join scope s
  cross join lateral (
    select exists (select 1 from public.assignments asg
                   where asg.course_id = c.id
                     and public.user_matches_rule(s.id, asg.rule)) as assigned
  ) a
  where c.published
  group by c.id, c.title
  having count(*) filter (where a.assigned) > 0
  order by c.title
$$;

create function public.report_courses_summary()
returns table (course_id uuid, title text,
               assigned bigint, completed bigint, retention_verified bigint)
language sql stable security definer set search_path = public as
$$ select * from public.report_summary_for(auth.uid()) $$;

-- Weekly digest recipients. Internal (service role only).
create function public.digest_recipients()
returns table (id uuid, email text, full_name text, role text)
language sql stable security definer set search_path = public as
$$
  select id, email, full_name, role
  from public.users
  where active and role in ('manager', 'admin')
$$;

-- "This will reach N people" for the Assign screen. Admin only; anyone else
-- gets 0.
create function public.preview_rule_reach(p_rule jsonb)
returns bigint language sql stable security definer set search_path = public as
$$
  select case when public.app_role() = 'admin' then (
    select count(*) from public.users u
    where u.active and public.user_matches_rule(u.id, p_rule)
  ) else 0 end
$$;

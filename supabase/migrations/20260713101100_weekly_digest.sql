-- Phase 4 — weekly digest. The reporting queries were built scope-first so
-- this is trivial (spec): parameterise the scope by an explicit viewer so the
-- digest cron can compute each manager's/admin's own numbers, then list the
-- recipients.

-- ---------------------------------------------------------------------------
-- users_in_scope_of(viewer) — the active users a given viewer may report on.
-- This is the scope logic; users_in_reporting_scope() now just passes auth.uid().
-- ---------------------------------------------------------------------------

create or replace function public.users_in_scope_of(p_viewer uuid)
returns table (
  id uuid, email text, full_name text,
  org_id uuid, org_name text,
  store_id uuid, store_name text, state text
)
language sql stable security definer set search_path = public as
$$
  with v as (
    select role, org_id, store_id, group_id
    from public.users where id = p_viewer and active
  )
  select u.id, u.email, u.full_name,
         u.org_id, o.name, u.store_id, st.name, st.state
  from public.users u
  left join public.orgs o on o.id = u.org_id
  left join public.stores st on st.id = u.store_id
  cross join v
  where u.active
    and case v.role
      when 'admin' then true
      when 'coordinator' then
        u.org_id in (select o2.id from public.orgs o2 where o2.group_id = v.group_id)
      when 'manager' then
        u.org_id = v.org_id and (v.store_id is null or u.store_id = v.store_id)
      else u.id = p_viewer
    end
$$;

-- Re-point the auth.uid() wrapper at the parameterised version.
create or replace function public.users_in_reporting_scope()
returns table (
  id uuid, email text, full_name text,
  org_id uuid, org_name text,
  store_id uuid, store_name text, state text
)
language sql stable security definer set search_path = public as
$$
  select * from public.users_in_scope_of(auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- report_summary_for(viewer) — report_courses_summary for an explicit viewer.
-- Service-role only (the digest cron); mirrors the auth.uid() version.
-- ---------------------------------------------------------------------------

create or replace function public.report_summary_for(p_viewer uuid)
returns table (
  course_id uuid, title text,
  assigned bigint, completed bigint, retention_verified bigint
)
language sql stable security definer set search_path = public as
$$
  with scope as (select id from public.users_in_scope_of(p_viewer))
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
  having count(*) filter (where a.assigned) > 0
  order by c.title
$$;

-- ---------------------------------------------------------------------------
-- digest_recipients — active managers and admins who should get the weekly
-- email. Service-role only.
-- ---------------------------------------------------------------------------

create or replace function public.digest_recipients()
returns table (id uuid, email text, full_name text, role text)
language sql stable security definer set search_path = public as
$$
  select id, email, full_name, role
  from public.users
  where active and role in ('manager', 'admin')
$$;

revoke all on function public.users_in_scope_of(uuid) from public;
revoke all on function public.report_summary_for(uuid) from public;
revoke all on function public.digest_recipients() from public;
grant execute on function public.users_in_scope_of(uuid) to service_role;
grant execute on function public.report_summary_for(uuid) to service_role;
grant execute on function public.digest_recipients() to service_role;

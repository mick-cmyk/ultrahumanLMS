-- Scope helpers and the rule-resolution function.
--
-- Every function here that looks at "the current user" reads auth.uid()
-- itself. Nothing takes a viewer id from the caller (review item M5). The
-- few that take an explicit user id are internal, service-role only, and
-- called from other security definer functions.

create function public.app_role()
returns text language sql stable security definer set search_path = public as
$$ select role from public.users where id = auth.uid() and active $$;

-- Is p_unit in the subtree of one of p_viewer's scope units (or is the viewer
-- an admin)? Internal: execute is granted to service_role only.
create function public._in_scope(p_viewer uuid, p_unit uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.users v where v.id = p_viewer and v.active and v.role = 'admin')
      or exists (
           select 1
           from public.users v
           join public.user_scopes s on s.user_id = v.id
           join public.units target on target.id = p_unit
           where v.id = p_viewer and v.active and v.role in ('viewer', 'manager')
             and s.unit_id = any (target.path)
         )
$$;

create function public.in_my_scope(p_unit uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select p_unit is not null and public._in_scope(auth.uid(), p_unit) $$;

-- A unit the caller may see: their own, its ancestors, each scope unit's
-- ancestors, and everything below their scope units. Ancestors are visible so
-- a store manager can see the name of the brand they work for.
create function public.visible_unit(p_unit uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.users me where me.id = auth.uid() and me.active)
     and (
       public.in_my_scope(p_unit)
       or exists (select 1
                  from public.users me
                  join public.units mu on mu.id = me.unit_id
                  where me.id = auth.uid() and p_unit = any (mu.path))
       or exists (select 1
                  from public.user_scopes s
                  join public.units su on su.id = s.unit_id
                  where s.user_id = auth.uid() and p_unit = any (su.path))
     )
$$;

-- ---------------------------------------------------------------------------
-- user_matches_rule: THE rule-resolution function. Never reimplement it in
-- TypeScript. Order:
--   1. user in exclude_user_ids            -> no match, stop
--   2. user in include_user_ids            -> match, stop
--   3. all = true                          -> match
--   4. user's unit is inside the subtree of any unit in unit_ids
--      AND (states empty OR the user's unit has a state in states) -> match
--   5. otherwise no match
-- Empty states = no state filter. Empty unit_ids with all = false matches
-- nobody (it is not a wildcard). Does not check users.active; callers do.
-- ---------------------------------------------------------------------------
create function public.user_matches_rule(p_user_id uuid, p_rule jsonb)
returns boolean language sql stable security definer set search_path = public as
$$
  with u as (
    select usr.unit_id, un.path, un.state
    from public.users usr
    left join public.units un on un.id = usr.unit_id
    where usr.id = p_user_id
  )
  select case
    when p_rule is null or jsonb_typeof(p_rule) <> 'object'
         or not exists (select 1 from u) then false
    when p_user_id::text = any (public.jsonb_text_array(p_rule -> 'exclude_user_ids')) then false
    when p_user_id::text = any (public.jsonb_text_array(p_rule -> 'include_user_ids')) then true
    when coalesce(p_rule -> 'all' = 'true'::jsonb, false) then true
    else exists (
      select 1 from u
      where u.unit_id is not null
        and u.path::text[] && public.jsonb_text_array(p_rule -> 'unit_ids')
        and (
          cardinality(public.jsonb_text_array(p_rule -> 'states')) = 0
          or (u.state is not null and u.state = any (public.jsonb_text_array(p_rule -> 'states')))
        )
    )
  end
$$;

-- Course visibility for the current user: any assignment rule matches.
create function public.user_sees_course(p_course_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.active)
     and exists (
       select 1 from public.assignments a
       where a.course_id = p_course_id
         and public.user_matches_rule(auth.uid(), a.rule)
     )
$$;

-- ---------------------------------------------------------------------------
-- Who may manage whom (fixes review item M2).
--
-- A manager may only add staff to a unit inside their scope, and may only act
-- on a learner or manager who sits inside their scope AND whose own scope
-- units are all strictly below one of the manager's. A store manager cannot
-- touch a peer store manager, and nobody can touch someone above them.
-- Admins can manage anyone. Roles never change here; that is admin-only.
-- ---------------------------------------------------------------------------
create function public.can_manage_unit(p_unit uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select public.app_role() in ('admin', 'manager')
     and exists (select 1 from public.units where id = p_unit and active)
     and public.in_my_scope(p_unit)
$$;

create function public.can_manage_user(p_target uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  with me as (select id, role from public.users where id = auth.uid() and active),
       t  as (select id, role, unit_id from public.users where id = p_target)
  select exists (
    select 1 from me, t
    where me.role = 'admin'
       or (
         me.role = 'manager'
         and t.id <> me.id
         and t.role in ('learner', 'manager')
         and t.unit_id is not null
         and public.in_my_scope(t.unit_id)
         and not exists (
           select 1 from public.user_scopes ts
           where ts.user_id = t.id
             and not exists (
               select 1
               from public.user_scopes ms
               join public.units tu on tu.id = ts.unit_id
               where ms.user_id = me.id
                 and ms.unit_id = any (tu.path)
                 and ms.unit_id <> ts.unit_id
             )
         )
       )
  )
$$;

-- May the caller put this email into this unit? New people: yes if the unit is
-- theirs to manage. Existing people: only if never provisioned, or a learner
-- the caller can already manage. Used by the add-staff and CSV-import routes
-- before they touch the auth admin API.
create function public.can_provision_email(p_email text, p_unit uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select public.can_manage_unit(p_unit)
     and (
       not exists (select 1 from public.users where lower(email) = lower(p_email))
       or exists (
         select 1 from public.users u
         where lower(u.email) = lower(p_email)
           and (u.unit_id is null
                or (u.role = 'learner' and public.can_manage_user(u.id)))
       )
     )
$$;

create function public.set_user_active(p_target uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.can_manage_user(p_target) then
    raise exception 'not allowed';
  end if;
  update public.users set active = p_active where id = p_target;
end;
$$;

-- The branding that applies to the caller: the nearest unit at or above
-- theirs that has a logo or colour set (for example their retail brand).
create function public.my_brand()
returns table (name text, logo_url text, brand_color text)
language sql stable security definer set search_path = public as
$$
  select a.name, a.logo_url, a.brand_color
  from public.users me
  join public.units mu on mu.id = me.unit_id
  cross join lateral unnest(mu.path) with ordinality as p(aid, ord)
  join public.units a on a.id = p.aid
  where me.id = auth.uid() and me.active
    and (a.logo_url is not null or a.brand_color is not null)
  order by p.ord desc
  limit 1
$$;

-- Same, for a named user. Internal (email sender); service role only.
create function public.unit_brand_for(p_user uuid)
returns table (name text, logo_url text, brand_color text)
language sql stable security definer set search_path = public as
$$
  select a.name, a.logo_url, a.brand_color
  from public.users me
  join public.units mu on mu.id = me.unit_id
  cross join lateral unnest(mu.path) with ordinality as p(aid, ord)
  join public.units a on a.id = p.aid
  where me.id = p_user
    and (a.logo_url is not null or a.brand_color is not null)
  order by p.ord desc
  limit 1
$$;

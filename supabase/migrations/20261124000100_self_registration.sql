-- Self-registration.
--
-- New staff ask for access themselves, either through a sign-up link for one
-- place (units.signup_code, which fixes where they work) or through a general
-- page where they pick their place from a list. With auto-approve on they get
-- a login straight away; otherwise an approver ticks them in.
--
-- Approvers are managers or admins with users.is_approver set. A manager-
-- approver decides requests for places in their own scope; an admin decides
-- any. Only approvers are emailed, each about their own area.
--
-- registration_requests is invisible through the API (no grants). The public
-- route calls submit_registration with the service client, after its own rate
-- limit, because an approved request ends in creating a login (lib/provision).
-- Deciding happens through the approver's own session.
--
-- Someone who already has a login is never moved, changed or switched back on
-- by self-registration: submit_registration reports 'existing' and does
-- nothing. The route shows the same message either way, so the form can't be
-- used to find out who has an account.

-- ---------------------------------------------------------------- schema
alter table public.users add column is_approver boolean not null default false;

alter table public.units add column signup_code text;
create unique index units_signup_code_idx on public.units (signup_code) where signup_code is not null;

insert into public.app_settings (key, value) values
  ('registration_general', 'off'),
  ('registration_auto_approve', 'off')
on conflict (key) do nothing;
alter table public.app_settings add constraint app_settings_registration_valid
  check (key not in ('registration_general', 'registration_auto_approve') or value in ('on', 'off'));

create table public.registration_requests (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(email) and length(email) <= 254),
  full_name   text not null check (length(btrim(full_name)) between 1 and 200),
  unit_id     uuid not null references public.units (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.users (id) on delete set null,
  user_id     uuid references public.users (id) on delete set null
);
create unique index registration_requests_one_pending on public.registration_requests (email) where status = 'pending';
create index registration_requests_unit_idx on public.registration_requests (unit_id) where status = 'pending';
alter table public.registration_requests enable row level security;
-- No policies: reached only through the functions below.

-- ---------------------------------------------------------------- helpers
create function public.registration_setting(p_key text)
returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select value = 'on' from public.app_settings where key = p_key), false) $$;

-- May the caller approve or decline a request for this unit?
create function public.can_decide_registration(p_unit uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select public.app_role() = 'admin'
      or (public.app_role() = 'manager'
          and exists (select 1 from public.users where id = auth.uid() and is_approver)
          and public.in_my_scope(p_unit))
$$;

-- ---------------------------------------------------------------- public
-- What the sign-up page may show. With a valid code: that place only. Without
-- one: the list of places, if the general page is on. Safe for anon.
create function public.registration_options(p_code text default null)
returns jsonb language sql stable security definer set search_path = public as
$$
  select case
    when nullif(btrim(p_code), '') is not null then
      coalesce(
        (select jsonb_build_object('open', true, 'unit', jsonb_build_object('id', u.id, 'name', u.name))
         from public.units u where u.signup_code = btrim(p_code) and u.active),
        jsonb_build_object('open', false))
    when public.registration_setting('registration_general') then
      jsonb_build_object('open', true, 'units', coalesce((
        select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'kind', u.kind,
                                            'depth', cardinality(u.path) - 1)
                         order by (select string_agg(a.name, ' / ' order by p.ord)
                                   from unnest(u.path) with ordinality p(aid, ord)
                                   join public.units a on a.id = p.aid))
        from public.units u where u.active), '[]'::jsonb))
    else jsonb_build_object('open', false)
  end
$$;

-- Record a request. Service role only (the public route rate-limits first).
-- Returns {status: existing | pending | approved, id?, unit_id?, notify?}.
create function public.submit_registration(p_email text, p_full_name text, p_unit uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := btrim(coalesce(p_full_name, ''));
  v_unit  uuid;
  v_id    uuid;
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 254 then
    raise exception 'registration: bad email' using errcode = '22023';
  end if;
  if v_email ~* '\.invalid$' then
    raise exception 'registration: bad email' using errcode = '22023';
  end if;
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'registration: bad name' using errcode = '22023';
  end if;

  if nullif(btrim(p_code), '') is not null then
    select id into v_unit from public.units where signup_code = btrim(p_code) and active;
  elsif public.registration_setting('registration_general') then
    select id into v_unit from public.units where id = p_unit and active;
  end if;
  if v_unit is null then
    raise exception 'registration: closed' using errcode = '22023';
  end if;

  if exists (select 1 from public.users where lower(email) = v_email) then
    -- 'auto' lets the route answer exactly as it would for a new person.
    return jsonb_build_object('status', 'existing',
                              'auto', public.registration_setting('registration_auto_approve'));
  end if;

  if public.registration_setting('registration_auto_approve') then
    -- Clear any older pending request for this email; this one wins.
    update public.registration_requests set status = 'declined', decided_at = now()
      where email = v_email and status = 'pending';
    insert into public.registration_requests (email, full_name, unit_id, status, decided_at)
      values (v_email, v_name, v_unit, 'approved', now())
      returning id into v_id;
    return jsonb_build_object('status', 'approved', 'id', v_id, 'unit_id', v_unit);
  end if;

  select id into v_id from public.registration_requests where email = v_email and status = 'pending';
  if v_id is not null then
    -- Asked again: keep one request, refresh it, don't email approvers twice.
    update public.registration_requests set full_name = v_name, unit_id = v_unit where id = v_id;
    return jsonb_build_object('status', 'pending', 'id', v_id, 'unit_id', v_unit, 'notify', false);
  end if;

  insert into public.registration_requests (email, full_name, unit_id)
    values (v_email, v_name, v_unit) returning id into v_id;
  return jsonb_build_object('status', 'pending', 'id', v_id, 'unit_id', v_unit, 'notify', true);
end;
$$;

-- Who to email about a request for this unit. Service role only.
create function public.registration_approvers(p_unit uuid)
returns table (email text, full_name text)
language sql stable security definer set search_path = public as
$$
  select u.email, u.full_name
  from public.users u
  where u.active and u.is_approver and u.role in ('admin', 'manager')
    and u.email !~* '\.invalid$'
    and public._in_scope(u.id, p_unit)
$$;

-- After the route has created the login for an approved request.
create function public.link_registration_user(p_request uuid, p_user uuid)
returns void language sql security definer set search_path = public as
$$ update public.registration_requests set user_id = p_user where id = p_request and status = 'approved' $$;

-- ---------------------------------------------------------------- approvers
create function public.pending_registrations()
returns table (id uuid, email text, full_name text, unit_id uuid, unit_name text, created_at timestamptz)
language sql stable security definer set search_path = public as
$$
  select r.id, r.email, r.full_name, r.unit_id, un.name, r.created_at
  from public.registration_requests r
  join public.units un on un.id = r.unit_id
  where r.status = 'pending' and public.can_decide_registration(r.unit_id)
  order by r.created_at
$$;

-- Step one of approving: the details, if the caller may approve this one.
-- The route creates the login, then calls decide_registration.
create function public.registration_for_approval(p_id uuid)
returns table (email text, full_name text, unit_id uuid)
language plpgsql stable security definer set search_path = public as
$$
declare
  r public.registration_requests;
begin
  select * into r from public.registration_requests where id = p_id and status = 'pending';
  if r.id is null then
    raise exception 'registration: not found' using errcode = '22023';
  end if;
  if not public.can_decide_registration(r.unit_id) then
    raise exception 'registration: not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.users where lower(users.email) = r.email)
     and not public.can_provision_email(r.email, r.unit_id) then
    raise exception 'registration: belongs elsewhere' using errcode = '42501';
  end if;
  return query select r.email, r.full_name, r.unit_id;
end;
$$;

create function public.decide_registration(p_id uuid, p_approve boolean, p_user uuid default null)
returns void language plpgsql security definer set search_path = public as
$$
declare
  v_unit uuid;
begin
  select unit_id into v_unit from public.registration_requests where id = p_id and status = 'pending';
  if v_unit is null then
    raise exception 'registration: not found' using errcode = '22023';
  end if;
  if not public.can_decide_registration(v_unit) then
    raise exception 'registration: not allowed' using errcode = '42501';
  end if;
  update public.registration_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_at = now(), decided_by = auth.uid(),
         user_id = case when p_approve then p_user end
   where id = p_id;
end;
$$;

-- ---------------------------------------------------------------- settings
create function public.registration_settings()
returns jsonb language plpgsql stable security definer set search_path = public as
$$
begin
  if public.app_role() <> 'admin' or public.app_role() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'general', public.registration_setting('registration_general'),
    'auto_approve', public.registration_setting('registration_auto_approve'));
end;
$$;

create function public.set_registration_settings(p_general boolean, p_auto_approve boolean)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.app_settings set value = case when p_general then 'on' else 'off' end where key = 'registration_general';
  update public.app_settings set value = case when p_auto_approve then 'on' else 'off' end where key = 'registration_auto_approve';
end;
$$;

-- Turn a place's sign-up link on (a fresh code, so an old poster stops
-- working) or off. Admins, or managers for places in their scope.
create function public.set_unit_signup(p_unit uuid, p_on boolean)
returns text language plpgsql security definer set search_path = public as
$$
declare
  v_code text;
begin
  if not public.can_manage_unit(p_unit) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_on then
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  end if;
  update public.units set signup_code = v_code where id = p_unit;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------- grants
revoke all on public.registration_requests from anon, authenticated;
grant all on public.registration_requests to service_role;

-- Admins tick approvers through the same column grant as role and active.
grant update (is_approver) on public.users to authenticated;

revoke execute on function
  public.registration_setting(text),
  public.can_decide_registration(uuid),
  public.registration_options(text),
  public.submit_registration(text, text, uuid, text),
  public.registration_approvers(uuid),
  public.link_registration_user(uuid, uuid),
  public.pending_registrations(),
  public.registration_for_approval(uuid),
  public.decide_registration(uuid, boolean, uuid),
  public.registration_settings(),
  public.set_registration_settings(boolean, boolean),
  public.set_unit_signup(uuid, boolean)
  from public, anon, authenticated;

grant execute on function
  public.registration_setting(text),
  public.can_decide_registration(uuid),
  public.registration_options(text),
  public.submit_registration(text, text, uuid, text),
  public.registration_approvers(uuid),
  public.link_registration_user(uuid, uuid),
  public.pending_registrations(),
  public.registration_for_approval(uuid),
  public.decide_registration(uuid, boolean, uuid),
  public.registration_settings(),
  public.set_registration_settings(boolean, boolean),
  public.set_unit_signup(uuid, boolean)
  to service_role;

grant execute on function public.registration_options(text) to anon, authenticated;
grant execute on function
  public.pending_registrations(),
  public.registration_for_approval(uuid),
  public.decide_registration(uuid, boolean, uuid),
  public.registration_settings(),
  public.set_registration_settings(boolean, boolean),
  public.set_unit_signup(uuid, boolean)
  to authenticated;

-- Self sign-up, round two: a note for the approvers, and a role chosen when
-- approving.
--
-- Note: optional, up to 500 characters, shown on /approvals and in the
-- approver email.
--
-- Role: the approver picks it as they approve. Admins can pick any role.
-- A manager-approver can pick learner, or viewer / manager for a place strictly
-- below one of their own scope units (so a store manager can't create a peer
-- store manager, which matches can_manage_user). A viewer or manager gets the
-- request's place as their scope.
--
-- The role is only ever applied to a login created for this request (created
-- after the request was made). Someone who already had a login keeps their role
-- (the "never change an existing user's role" rule).

alter table public.registration_requests
  add column note text check (note is null or length(note) <= 500);

-- ---------------------------------------------------------------- submit, with a note
drop function public.submit_registration(text, text, uuid, text);

create function public.submit_registration(p_email text, p_full_name text, p_unit uuid, p_code text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := btrim(coalesce(p_full_name, ''));
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
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
  if length(v_note) > 500 then
    raise exception 'registration: note too long' using errcode = '22023';
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
    update public.registration_requests set status = 'declined', decided_at = now()
      where email = v_email and status = 'pending';
    insert into public.registration_requests (email, full_name, unit_id, note, status, decided_at)
      values (v_email, v_name, v_unit, v_note, 'approved', now())
      returning id into v_id;
    return jsonb_build_object('status', 'approved', 'id', v_id, 'unit_id', v_unit);
  end if;

  select id into v_id from public.registration_requests where email = v_email and status = 'pending';
  if v_id is not null then
    update public.registration_requests set full_name = v_name, unit_id = v_unit, note = v_note where id = v_id;
    return jsonb_build_object('status', 'pending', 'id', v_id, 'unit_id', v_unit, 'notify', false);
  end if;

  insert into public.registration_requests (email, full_name, unit_id, note)
    values (v_email, v_name, v_unit, v_note) returning id into v_id;
  return jsonb_build_object('status', 'pending', 'id', v_id, 'unit_id', v_unit, 'notify', true);
end;
$$;

-- ---------------------------------------------------------------- roles an approver may give
-- For one pending request: which roles may the caller give? Admins: all four.
-- Manager-approvers: learner, plus viewer and manager when the place is
-- strictly below one of their scope units.
create function public.registration_role_choices(p_unit uuid)
returns text[] language sql stable security definer set search_path = public as
$$
  select case
    when not public.can_decide_registration(p_unit) then array[]::text[]
    when public.app_role() = 'admin' then array['learner', 'viewer', 'manager', 'admin']
    when exists (
      select 1 from public.user_scopes s join public.units t on t.id = p_unit
      where s.user_id = auth.uid() and s.unit_id = any (t.path) and s.unit_id <> t.id
    ) then array['learner', 'viewer', 'manager']
    else array['learner']
  end
$$;

-- ---------------------------------------------------------------- the approvals list, with note and role choices
drop function public.pending_registrations();

create function public.pending_registrations()
returns table (id uuid, email text, full_name text, unit_id uuid, unit_name text, note text,
               created_at timestamptz, role_choices text[])
language sql stable security definer set search_path = public as
$$
  select r.id, r.email, r.full_name, r.unit_id, un.name, r.note, r.created_at,
         public.registration_role_choices(r.unit_id)
  from public.registration_requests r
  join public.units un on un.id = r.unit_id
  where r.status = 'pending' and public.can_decide_registration(r.unit_id)
  order by r.created_at
$$;

-- ---------------------------------------------------------------- deciding, with a role
drop function public.decide_registration(uuid, boolean, uuid);

create function public.decide_registration(p_id uuid, p_approve boolean, p_user uuid default null,
                                           p_role text default 'learner')
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  r public.registration_requests;
  v_role text := coalesce(p_role, 'learner');
  v_applied boolean := false;
begin
  select * into r from public.registration_requests where id = p_id and status = 'pending';
  if r.id is null then
    raise exception 'registration: not found' using errcode = '22023';
  end if;
  if not public.can_decide_registration(r.unit_id) then
    raise exception 'registration: not allowed' using errcode = '42501';
  end if;

  if p_approve and v_role <> 'learner' then
    if not (v_role = any (public.registration_role_choices(r.unit_id))) then
      raise exception 'registration: role not allowed' using errcode = '42501';
    end if;
  end if;

  update public.registration_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_at = now(), decided_by = auth.uid(),
         user_id = case when p_approve then p_user end
   where id = p_id;

  -- Only a login made for this request gets the chosen role (and scope).
  if p_approve and v_role <> 'learner' and p_user is not null and exists (
       select 1 from public.users u
       where u.id = p_user and lower(u.email) = r.email and u.role = 'learner'
         and u.created_at >= r.created_at
     ) then
    update public.users set role = v_role where id = p_user;
    if v_role in ('viewer', 'manager') then
      insert into public.user_scopes (user_id, unit_id) values (p_user, r.unit_id) on conflict do nothing;
    end if;
    v_applied := true;
  end if;

  return jsonb_build_object('role_applied', v_applied);
end;
$$;

-- ---------------------------------------------------------------- grants
revoke execute on function
  public.submit_registration(text, text, uuid, text, text),
  public.registration_role_choices(uuid),
  public.pending_registrations(),
  public.decide_registration(uuid, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.submit_registration(text, text, uuid, text, text),
  public.registration_role_choices(uuid),
  public.pending_registrations(),
  public.decide_registration(uuid, boolean, uuid, text)
  to service_role;
grant execute on function
  public.registration_role_choices(uuid),
  public.pending_registrations(),
  public.decide_registration(uuid, boolean, uuid, text)
  to authenticated;

-- The developer: the person who runs the platform keeps the highest access
-- on every deployment, and only they can agree to give it up.
--
-- users.is_developer marks them. A developer is always an active admin:
--   - nobody can change a developer's role, deactivate them, remove the mark or
--     delete their account (the guard trigger below refuses it, whatever the
--     route, including the service role and the auth admin API);
--   - an admin can only ask: request_developer_removal records the request and
--     the app emails the developer;
--   - the developer approves or declines with decide_developer_removal. Approving
--     clears the mark, after which they're an ordinary admin.
-- Marking someone as developer is never possible from the app: only from a script
-- or SQL (npm run developer:set). It is visible to admins (People shows "Developer"),
-- never hidden.

alter table public.users add column is_developer boolean not null default false;

create table public.developer_removal_requests (
  id           uuid primary key default gen_random_uuid(),
  developer_id     uuid not null references public.users (id) on delete cascade,
  requested_by uuid references public.users (id) on delete set null,
  reason       text check (reason is null or length(reason) <= 500),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  approved     boolean
);
create unique index developer_removal_one_waiting on public.developer_removal_requests (developer_id) where decided_at is null;
alter table public.developer_removal_requests enable row level security;

-- ---------------------------------------------------------------- the guard
create function public.users_protect_developer()
returns trigger language plpgsql security definer set search_path = public as
$$
declare
  v_approved boolean := coalesce(current_setting('app.developer_change', true), '') = 'approved';
begin
  if tg_op = 'DELETE' then
    if old.is_developer and not v_approved then
      raise exception 'the developer account can only be removed with the developer''s approval' using errcode = '42501';
    end if;
    return old;
  end if;

  -- Making someone a developer: scripts and SQL only, never through the app.
  if new.is_developer and not old.is_developer and auth.uid() is not null then
    raise exception 'developers can only be added by the platform team' using errcode = '42501';
  end if;

  if old.is_developer and not v_approved
     and (new.is_developer is distinct from old.is_developer
          or new.role is distinct from old.role
          or new.active is distinct from old.active) then
    raise exception 'the developer account can only be changed with the developer''s approval' using errcode = '42501';
  end if;

  -- A new developer must be an active admin.
  if new.is_developer and (new.role <> 'admin' or not new.active) then
    raise exception 'a developer must be an active admin' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger users_protect_developer
  before update or delete on public.users
  for each row execute function public.users_protect_developer();

-- ---------------------------------------------------------------- requests
create function public.request_developer_removal(p_developer uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as
$$
declare
  v_id uuid;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_developer = auth.uid() then
    raise exception 'you can''t ask about your own account' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = p_developer and is_developer) then
    raise exception 'that person isn''t a developer' using errcode = '22023';
  end if;
  if exists (select 1 from public.developer_removal_requests where developer_id = p_developer and decided_at is null) then
    raise exception 'there is already a request waiting for the developer' using errcode = '22023';
  end if;
  insert into public.developer_removal_requests (developer_id, requested_by, reason)
  values (p_developer, auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Requests waiting for the caller (a developer) to decide.
create function public.my_developer_requests()
returns table (id uuid, requested_by_name text, reason text, created_at timestamptz)
language sql stable security definer set search_path = public as
$$
  select r.id, public._user_name(r.requested_by), r.reason, r.created_at
  from public.developer_removal_requests r
  where r.developer_id = auth.uid() and r.decided_at is null
  order by r.created_at
$$;

-- Developers with a request waiting (admins see this on People).
create function public.developer_requests_waiting()
returns table (developer_id uuid, requested_by_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select r.developer_id, public._user_name(r.requested_by), r.created_at
  from public.developer_removal_requests r
  where r.decided_at is null;
end;
$$;

create function public.decide_developer_removal(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as
$$
declare
  r public.developer_removal_requests;
begin
  select * into r from public.developer_removal_requests where id = p_id and decided_at is null;
  if r.id is null or r.developer_id is distinct from auth.uid() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.developer_removal_requests set decided_at = now(), approved = coalesce(p_approve, false) where id = p_id;
  if p_approve then
    perform set_config('app.developer_change', 'approved', true);
    update public.users set is_developer = false where id = r.developer_id;
    perform set_config('app.developer_change', '', true);
  end if;
end;
$$;

-- ---------------------------------------------------------------- grants
-- users.is_developer is readable like the rest of users (table select grant);
-- there is no update grant on it, so the app can never set it.
revoke all on public.developer_removal_requests from anon, authenticated;
grant all on public.developer_removal_requests to service_role;

revoke execute on function
  public.users_protect_developer(),
  public.request_developer_removal(uuid, text),
  public.my_developer_requests(),
  public.developer_requests_waiting(),
  public.decide_developer_removal(uuid, boolean)
  from public, anon, authenticated;
grant execute on function
  public.users_protect_developer(),
  public.request_developer_removal(uuid, text),
  public.my_developer_requests(),
  public.developer_requests_waiting(),
  public.decide_developer_removal(uuid, boolean)
  to service_role;
grant execute on function
  public.request_developer_removal(uuid, text),
  public.my_developer_requests(),
  public.developer_requests_waiting(),
  public.decide_developer_removal(uuid, boolean)
  to authenticated;

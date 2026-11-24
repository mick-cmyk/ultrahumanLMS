-- Welcome page wording, edited by admins on the Settings page.
--
-- One row (id = true) holding the welcome text as JSON. No row, or a null
-- welcome, means "use the wording in the brand file". Anyone may read it,
-- because the welcome page is public; only admins may change it, through
-- set_welcome_text. The shape is checked here so nothing malformed or with
-- an em dash can be saved, whatever the app sends.
--
-- {
--   "heading": "1..200 chars",
--   "intro": ["0..5 paragraphs, each 1..600 chars"],
--   "steps": [{"title": "1..60", "body": "1..300"}, ... 0..5],
--   "newHere": "0..300",
--   "websitePrompt": "0..100",
--   "websiteLinkText": "0..100"
-- }

create function public._welcome_text_valid(p jsonb)
returns boolean language sql immutable set search_path = public as
$$
  -- coalesce: a missing key makes the test unknown (null), which a check
  -- constraint would let through, so unknown counts as invalid.
  select p is null or coalesce(
    jsonb_typeof(p) = 'object'
    -- only the known keys
    and not exists (select 1 from jsonb_object_keys(p) k
                    where k not in ('heading', 'intro', 'steps', 'newHere', 'websitePrompt', 'websiteLinkText'))
    and jsonb_typeof(p->'heading') = 'string'
    and length(btrim(p->>'heading')) between 1 and 200
    and jsonb_typeof(p->'intro') = 'array'
    and jsonb_array_length(p->'intro') <= 5
    and not exists (select 1 from jsonb_array_elements(p->'intro') e
                    where jsonb_typeof(e) <> 'string' or length(btrim(e #>> '{}')) not between 1 and 600)
    and jsonb_typeof(p->'steps') = 'array'
    and jsonb_array_length(p->'steps') <= 5
    and not exists (select 1 from jsonb_array_elements(p->'steps') s
                    where jsonb_typeof(s) <> 'object'
                       or jsonb_typeof(s->'title') is distinct from 'string'
                       or jsonb_typeof(s->'body') is distinct from 'string'
                       or length(btrim(s->>'title')) not between 1 and 60
                       or length(btrim(s->>'body')) not between 1 and 300
                       or exists (select 1 from jsonb_object_keys(s) k where k not in ('title', 'body')))
    and jsonb_typeof(p->'newHere') = 'string' and length(p->>'newHere') <= 300
    and jsonb_typeof(p->'websitePrompt') = 'string' and length(p->>'websitePrompt') <= 100
    and jsonb_typeof(p->'websiteLinkText') = 'string' and length(p->>'websiteLinkText') <= 100
    -- house style: no em dashes anywhere
    and position(chr(8212) in p::text) = 0,
    false)
$$;

create table public.site_text (
  id          boolean primary key default true check (id),
  welcome     jsonb check (public._welcome_text_valid(welcome)),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users (id) on delete set null
);
alter table public.site_text enable row level security;
-- No policies: read through welcome_text(), written through set_welcome_text().

create function public.welcome_text()
returns jsonb language sql stable security definer set search_path = public as
$$ select welcome from public.site_text where id $$;

-- Save the welcome wording (admins only). Null puts the brand file's wording back.
create function public.set_welcome_text(p_welcome jsonb)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.site_text (id, welcome, updated_at, updated_by)
  values (true, p_welcome, now(), auth.uid())
  on conflict (id) do update
    set welcome = excluded.welcome, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$$;

revoke all on public.site_text from anon, authenticated;
grant all on public.site_text to service_role;

revoke execute on function
  public._welcome_text_valid(jsonb),
  public.welcome_text(),
  public.set_welcome_text(jsonb)
  from public, anon, authenticated;
grant execute on function public.welcome_text() to anon, authenticated, service_role;
grant execute on function public.set_welcome_text(jsonb) to authenticated, service_role;
grant execute on function public._welcome_text_valid(jsonb) to service_role;

-- v2 foundation. Runs first so everything created after it is locked down at
-- birth instead of being patched later (review items M1, M5, anon privileges).
--
-- Supabase's default privileges hand every new table to anon and
-- authenticated, and Postgres hands every new function to PUBLIC. Both are
-- switched off here for objects created by the migration role. Access is then
-- granted explicitly, once, in the final lockdown migration.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- app_settings: one row per setting, never readable through the API.
-- 'environment' is 'demo' or 'production' and defaults to production, so a
-- forgotten setting fails safe: demo data is refused.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key   text primary key,
  value text not null,
  constraint app_settings_environment_valid
    check (key <> 'environment' or value in ('demo', 'production'))
);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values ('environment', 'production');

create function public.app_environment()
returns text language sql stable security definer set search_path = public as
$$ select coalesce((select value from public.app_settings where key = 'environment'), 'production') $$;

-- ---------------------------------------------------------------------------
-- job_runs: lets a scheduled job run at most once per key (for example one
-- weekly digest per ISO week), even if cron fires it several times.
-- ---------------------------------------------------------------------------
create table public.job_runs (
  job     text not null,
  run_key text not null,
  ran_at  timestamptz not null default now(),
  primary key (job, run_key)
);
alter table public.job_runs enable row level security;

create function public.claim_job_run(p_job text, p_run_key text)
returns boolean language plpgsql security definer set search_path = public as
$$
declare v_rows int;
begin
  insert into public.job_runs (job, run_key) values (p_job, p_run_key)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Small helper used by the rule function: a jsonb array of strings as text[],
-- or an empty array for anything else (missing key, wrong type).
create function public.jsonb_text_array(j jsonb)
returns text[] language sql immutable set search_path = public as
$$ select case when jsonb_typeof(j) = 'array'
               then array(select jsonb_array_elements_text(j))
               else '{}'::text[] end $$;

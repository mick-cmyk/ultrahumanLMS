// Runs every migration and every database test in an in-memory Postgres
// (PGlite, Postgres compiled to WebAssembly). No Docker, no network, no
// Supabase project needed:
//
//   npm run test:db:local
//
// Supabase's own schemas are stood in for with the minimum the migrations
// touch: auth.users and auth.uid(), storage.buckets and storage.objects (with
// RLS on, as on Supabase), and no-op cron/net schemas. pgTAP isn't available
// in PGlite, so the handful of pgTAP functions the tests use (plan, no_plan,
// finish, ok, is, lives_ok, throws_ok) are shimmed below.
//
// This proves the SQL parses, runs in order, and passes the test files. It is
// not a substitute for running them on a real Supabase project before go-live
// (`supabase test db`): the stand-ins are not Supabase's real auth and storage.

import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const TESTS = join(ROOT, 'supabase', 'tests');

const SUPABASE_STANDINS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema storage;
create schema extensions;
create schema cron;
create schema net;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
language sql as $$ insert into cron.job (jobname, schedule, command)
                   values (p_name, p_schedule, p_command) returning jobid $$;
create function cron.unschedule(p_name text) returns boolean
language sql as $$ delete from cron.job where jobname = p_name returning true $$;
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}',
                              timeout_milliseconds int default 1000) returns bigint
language sql as $$ select 1::bigint $$;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
grant all on auth.users to service_role;
`;

// Minimal pgTAP, in its own schema. Results are returned as rows ("ok 3 - ..." / "not ok 3 - ...")
// and counted by this script, so a test file's closing ROLLBACK can't erase them.
const PGTAP_SHIM = `
create schema tap;
create sequence tap.n;
create function tap.emit(pass boolean, descr text) returns text language sql as
$$ select case when pass then 'ok ' else 'not ok ' end || nextval('tap.n') || ' - ' || coalesce(descr, '') $$;

create function tap.plan(n int) returns text language sql as $$ select '1..' || n $$;
create function tap.no_plan() returns setof text language sql as $$ select null::text where false $$;
create function tap.finish() returns setof text language sql as $$ select null::text where false $$;
create function tap.ok(pass boolean, descr text default '') returns text language sql as
$$ select tap.emit(coalesce(pass, false), descr) $$;
create function tap.is(have anyelement, want anyelement, descr text default '') returns text
language plpgsql as $$
begin
  if have is not distinct from want then return tap.emit(true, descr); end if;
  return tap.emit(false, descr || '  [have: ' || coalesce(have::text, 'NULL')
                         || ', want: ' || coalesce(want::text, 'NULL') || ']');
end $$;
create function tap.lives_ok(q text, descr text default '') returns text language plpgsql as $$
begin
  execute q;
  return tap.emit(true, descr);
exception when others then
  return tap.emit(false, descr || '  [died: ' || sqlstate || ' ' || sqlerrm || ']');
end $$;
create function tap.throws_ok(q text, code text default null, msg text default null,
                                 descr text default '') returns text language plpgsql as $$
begin
  execute q;
  return tap.emit(false, descr || '  [no exception]');
exception when others then
  if (code is null or sqlstate = code) and (msg is null or sqlerrm = msg) then
    return tap.emit(true, descr);
  end if;
  return tap.emit(false, descr || '  [got: ' || sqlstate || ' ' || sqlerrm || ']');
end $$;
grant usage on schema tap to public;
grant usage, update on sequence tap.n to public;
grant execute on all functions in schema tap to public;
-- The tests call these unqualified; keep them out of public so the
-- "anon can execute nothing in public" test stays meaningful.
set search_path to public, tap, extensions;
`;

// Extensions PGlite doesn't ship; the stand-in schemas above replace them.
function adaptMigration(sql: string): string {
  return sql
    .replace(/create extension if not exists pg_cron[^;]*;/gi, '-- (pg_cron: stood in)')
    .replace(/create extension if not exists pg_net[^;]*;/gi, '-- (pg_net: stood in)');
}

type Result = { rows: Record<string, unknown>[] };

function tapLines(results: Result[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    for (const row of r.rows ?? []) {
      for (const v of Object.values(row)) {
        if (typeof v === 'string' && /^(not )?ok \d+/.test(v)) out.push(v);
      }
    }
  }
  return out;
}

async function main() {
  const only = process.argv[2];
  const db = new PGlite();
  await db.exec(SUPABASE_STANDINS);

  const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const f of migrations) {
    try {
      await db.exec(adaptMigration(readFileSync(join(MIGRATIONS, f), 'utf8')));
    } catch (e) {
      console.error(`MIGRATION FAILED: ${f}\n  ${(e as Error).message}`);
      process.exit(1);
    }
  }
  console.log(`applied ${migrations.length} migrations`);

  await db.exec(PGTAP_SHIM);

  const tests = readdirSync(TESTS)
    .filter((f) => f.endsWith('.test.sql'))
    .filter((f) => !only || f.includes(only))
    .sort();
  let failed = 0;
  let passed = 0;
  for (const f of tests) {
    let lines: string[];
    try {
      lines = tapLines((await db.exec(readFileSync(join(TESTS, f), 'utf8'))) as Result[]);
    } catch (e) {
      console.error(`\n${f}: ERROR (test file stopped)\n  ${(e as Error).message}`);
      await db.exec('rollback').catch(() => {});
      failed++;
      continue;
    }
    const bad = lines.filter((l) => l.startsWith('not ok'));
    passed += lines.length - bad.length;
    failed += bad.length;
    console.log(`${f}: ${lines.length - bad.length}/${lines.length} passed`);
    for (const l of bad) console.log(`  ${l}`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();

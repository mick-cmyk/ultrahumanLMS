-- One row per schema object in public, with a hash of its definition. Run on a
-- live project and on PGlite (scripts/db-test.ts --fingerprint) and diff the
-- two to check the database matches the migration files.
with objs as (
  select 'function' as kind, p.oid::regprocedure::text as name,
         md5(regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')) as h
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
  union all
  select 'function_acl', p.oid::regprocedure::text,
         md5(coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x), ''))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
  union all
  select 'column', c.relname || '.' || a.attname,
         md5(format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''))
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  union all
  select 'table_acl', c.relname,
         md5(coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x), ''))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'policy', pol.tablename || '.' || pol.policyname,
         md5(coalesce(pol.cmd, '') || coalesce(array_to_string(pol.roles, ','), '') || coalesce(pol.qual, '') || coalesce(pol.with_check, ''))
  from pg_policies pol where pol.schemaname = 'public'
  union all
  select 'constraint', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'trigger', tgrelid::regclass::text || '.' || tgname, md5(pg_get_triggerdef(oid))
  from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'auth.%'
    and (select relnamespace from pg_class where oid = tgrelid) = 'public'::regnamespace
)
select kind, name, h from objs order by kind, name;

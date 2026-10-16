-- pgTAP tests for public.user_matches_rule.
-- Runs against the seeded local db: `supabase db reset` + `npm run seed`
-- first, then `npm run test:db`. Everything rolls back.

begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---------------------------------------------------------------------------
-- Lookup helpers over seed data (LMS Build Out/seed.ts)
-- ---------------------------------------------------------------------------

create function pg_temp.uid(p_email text) returns uuid language sql as
  $$ select id from public.users where email = p_email $$;

create function pg_temp.org(p_name text) returns uuid language sql as
  $$ select id from public.orgs where name = p_name $$;

create function pg_temp.store(p_name text) returns uuid language sql as
  $$ select id from public.stores where name = p_name $$;

-- Does any seeded assignment rule for a course match a user?
create function pg_temp.sees(p_email text, p_course text) returns boolean language sql as
$$
  select exists (
    select 1
    from public.assignments a
    join public.courses c on c.id = a.course_id
    where c.title = p_course
      and public.user_matches_rule(pg_temp.uid(p_email), a.rule)
  )
$$;

-- Sanity: seed data must be present, or every assertion below is meaningless.
do $$
begin
  if pg_temp.uid('liam.hn.frank@example.com') is null then
    raise exception 'Seed data missing — run supabase db reset then npm run seed first';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. exclude_user_ids always wins
-- ---------------------------------------------------------------------------

select is(
  public.user_matches_rule(
    pg_temp.uid('liam.hn.frank@example.com'),
    jsonb_build_object(
      'include_user_ids', jsonb_build_array(pg_temp.uid('liam.hn.frank@example.com')::text),
      'exclude_user_ids', jsonb_build_array(pg_temp.uid('liam.hn.frank@example.com')::text))),
  false, 'exclude beats include when user is in both');

select is(
  public.user_matches_rule(
    pg_temp.uid('liam.hn.frank@example.com'),
    jsonb_build_object(
      'all', true,
      'exclude_user_ids', jsonb_build_array(pg_temp.uid('liam.hn.frank@example.com')::text))),
  false, 'exclude beats all:true');

select is(
  public.user_matches_rule(
    pg_temp.uid('emma.hn.frank@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('Harvey Norman')::text),
      'store_ids', jsonb_build_array(pg_temp.store('Harvey Norman Frankston')::text),
      'exclude_user_ids', jsonb_build_array(pg_temp.uid('emma.hn.frank@example.com')::text))),
  false, 'exclude beats an org+store match');

-- ---------------------------------------------------------------------------
-- 2. include_user_ids bypasses all filters
-- ---------------------------------------------------------------------------

select is(
  public.user_matches_rule(
    pg_temp.uid('mia.hn.maroo@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('JB Hi-Fi')::text),
      'include_user_ids', jsonb_build_array(pg_temp.uid('mia.hn.maroo@example.com')::text))),
  true, 'include bypasses an org filter the user does not match');

select is(
  public.user_matches_rule(
    pg_temp.uid('tash@example.com'),
    jsonb_build_object(
      'include_user_ids', jsonb_build_array(pg_temp.uid('tash@example.com')::text))),
  true, 'include matches with every other filter empty');

-- ---------------------------------------------------------------------------
-- 3. all: true
-- ---------------------------------------------------------------------------

select is(
  public.user_matches_rule(pg_temp.uid('ben.council@example.com'), '{"all": true}'::jsonb),
  true, 'all:true matches a storeless direct-client learner');

select is(
  public.user_matches_rule(pg_temp.uid('grace.jb.bris@example.com'), '{"all": true}'::jsonb),
  true, 'all:true matches a retailer learner regardless of state');

-- ---------------------------------------------------------------------------
-- 4. org / state / store filters and empty-array semantics
-- ---------------------------------------------------------------------------

select is(
  public.user_matches_rule(
    pg_temp.uid('liam.hn.frank@example.com'),
    '{"all": false, "org_ids": [], "states": [], "store_ids": [], "include_user_ids": [], "exclude_user_ids": []}'::jsonb),
  false, 'all:false with everything empty matches nobody (empty org_ids is not a wildcard)');

select is(
  public.user_matches_rule(
    pg_temp.uid('noah.hn.moor@example.com'),
    jsonb_build_object('org_ids', jsonb_build_array(pg_temp.org('Harvey Norman')::text))),
  true, 'org-only rule matches an org member (empty states/store_ids = no filter)');

select is(
  public.user_matches_rule(
    pg_temp.uid('liam.hn.frank@example.com'),
    jsonb_build_object('org_ids', jsonb_build_array(pg_temp.org('JB Hi-Fi')::text))),
  false, 'org-only rule does not match a non-member');

select is(
  public.user_matches_rule(
    pg_temp.uid('ava.jb.south@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('JB Hi-Fi')::text),
      'states', '["VIC","NSW"]'::jsonb)),
  true, 'org + states matches a VIC store user');

select is(
  public.user_matches_rule(
    pg_temp.uid('grace.jb.bris@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('JB Hi-Fi')::text),
      'states', '["VIC","NSW"]'::jsonb)),
  false, 'org + states filters out a QLD store user');

select is(
  public.user_matches_rule(
    pg_temp.uid('tash@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('Mornington Peninsula Council')::text),
      'states', '["VIC"]'::jsonb)),
  false, 'a states filter can never match a storeless user');

select is(
  public.user_matches_rule(
    pg_temp.uid('grace.jb.bris@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('JB Hi-Fi')::text),
      'states', '[]'::jsonb)),
  true, 'empty states array means no state filter');

select is(
  public.user_matches_rule(
    pg_temp.uid('liam.hn.frank@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('Harvey Norman')::text),
      'store_ids', jsonb_build_array(pg_temp.store('Harvey Norman Frankston')::text))),
  true, 'store_ids filter matches a user at that store');

select is(
  public.user_matches_rule(
    pg_temp.uid('noah.hn.moor@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('Harvey Norman')::text),
      'store_ids', jsonb_build_array(pg_temp.store('Harvey Norman Frankston')::text))),
  false, 'store_ids filter excludes same-org users at other stores');

select is(
  public.user_matches_rule(
    pg_temp.uid('liam.hn.frank@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('Harvey Norman')::text),
      'states', '["NSW"]'::jsonb,
      'store_ids', jsonb_build_array(pg_temp.store('Harvey Norman Frankston')::text))),
  false, 'states and store_ids must BOTH pass — store matches but state does not');

select is(
  public.user_matches_rule(
    pg_temp.uid('liam.hn.frank@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('Harvey Norman')::text),
      'states', '["VIC"]'::jsonb,
      'store_ids', jsonb_build_array(pg_temp.store('Harvey Norman Frankston')::text))),
  true, 'states and store_ids both passing matches');

select is(
  public.user_matches_rule(
    pg_temp.uid('liam.hn.frank@example.com'),
    jsonb_build_object(
      'org_ids', jsonb_build_array(pg_temp.org('JB Hi-Fi')::text),
      'store_ids', jsonb_build_array(pg_temp.store('Harvey Norman Frankston')::text))),
  false, 'store_ids cannot rescue a failed org gate');

-- ---------------------------------------------------------------------------
-- 5. Degenerate inputs
-- ---------------------------------------------------------------------------

select is(
  public.user_matches_rule(gen_random_uuid(), '{"all": true}'::jsonb),
  false, 'unknown user never matches, even all:true');

select is(
  public.user_matches_rule(pg_temp.uid('liam.hn.frank@example.com'), null),
  false, 'null rule never matches');

select is(
  public.user_matches_rule(pg_temp.uid('liam.hn.frank@example.com'), '{}'::jsonb),
  false, 'empty object rule never matches');

select is(
  public.user_matches_rule(pg_temp.uid('liam.hn.frank@example.com'), '{"all": true}'::jsonb),
  true, 'rule with only all:true and no array keys still matches');

select is(
  public.user_matches_rule(
    pg_temp.uid('departed@example.com'),
    jsonb_build_object('org_ids', jsonb_build_array(pg_temp.org('JB Hi-Fi')::text))),
  true, 'inactive user still matches the pure rule — active filtering is the caller''s job');

-- ---------------------------------------------------------------------------
-- 6. Seeded assignment rules end to end (the seed''s expected-visibility table)
-- ---------------------------------------------------------------------------

select is(pg_temp.sees('ava.jb.south@example.com', 'LG OLED 2026 Range'), true,
  'seed: JB VIC learner sees OLED');
select is(pg_temp.sees('oscar.jb.parra@example.com', 'LG OLED 2026 Range'), true,
  'seed: JB NSW learner sees OLED');
select is(pg_temp.sees('grace.jb.bris@example.com', 'LG OLED 2026 Range'), false,
  'seed: JB QLD learner filtered out of OLED');
select is(pg_temp.sees('liam.hn.frank@example.com', 'LG OLED 2026 Range'), true,
  'seed: HN Frankston learner sees OLED via store rule');
select is(pg_temp.sees('emma.hn.frank@example.com', 'LG OLED 2026 Range'), false,
  'seed: Emma excluded despite store match');
select is(pg_temp.sees('mia.hn.maroo@example.com', 'LG OLED 2026 Range'), true,
  'seed: Mia included individually from QLD');
select is(pg_temp.sees('tash@example.com', 'Council Venue Induction'), true,
  'seed: council learner sees induction');
select is(pg_temp.sees('ava.jb.south@example.com', 'Council Venue Induction'), false,
  'seed: retailer learner does not see induction');

select * from finish();
rollback;

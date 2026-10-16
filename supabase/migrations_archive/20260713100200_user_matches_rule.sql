-- user_matches_rule(user_id, rule) — THE rule-resolution function.
-- Called by course visibility, RLS policies, reporting, and (later) the
-- re-test cron. This is the only implementation of the logic; never
-- reimplement it in TypeScript.
--
-- Resolution order (spec):
--   1. user in exclude_user_ids  -> no match, stop
--   2. user in include_user_ids  -> match, stop
--   3. all = true                -> match
--   4. org_id in org_ids
--      AND (states empty OR store's state in states)
--      AND (store_ids empty OR store_id in store_ids)  -> match
--   5. otherwise no match
--
-- Empty states/store_ids arrays mean "no filter at that level".
-- org_ids has no such escape: with all=false, an empty org_ids matches
-- nobody except include_user_ids cherry-picks.
--
-- Does NOT check users.active — callers filter to active users themselves
-- (visibility queries, reporting denominators), keeping this function a pure
-- implementation of the five-step spec.
--
-- SECURITY DEFINER so RLS policies can call it without granting learners
-- read access to users/stores.

create or replace function public.user_matches_rule(p_user_id uuid, p_rule jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select usr.org_id, usr.store_id, st.state
    from public.users usr
    left join public.stores st on st.id = usr.store_id
    where usr.id = p_user_id
  )
  select case
    -- unknown user or no rule: never match
    when p_rule is null or not exists (select 1 from u) then false
    -- 1. exclude always wins
    when coalesce(p_rule -> 'exclude_user_ids', '[]'::jsonb) ? p_user_id::text then false
    -- 2. include bypasses all filters
    when coalesce(p_rule -> 'include_user_ids', '[]'::jsonb) ? p_user_id::text then true
    -- 3. everyone
    when coalesce((p_rule ->> 'all')::boolean, false) then true
    -- 4. org + optional state + optional store filters
    else exists (
      select 1
      from u
      where u.org_id is not null
        and coalesce(p_rule -> 'org_ids', '[]'::jsonb) ? u.org_id::text
        and (
          jsonb_array_length(coalesce(p_rule -> 'states', '[]'::jsonb)) = 0
          or (u.state is not null and p_rule -> 'states' ? u.state)
        )
        and (
          jsonb_array_length(coalesce(p_rule -> 'store_ids', '[]'::jsonb)) = 0
          or (u.store_id is not null and p_rule -> 'store_ids' ? u.store_id::text)
        )
    )
  end
$$;

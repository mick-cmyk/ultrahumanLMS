-- Shared rate limit for public endpoints (first user: POST /api/retest/start).
--
-- The old limit lived in each serverless instance's memory, so it only slowed
-- one warm instance. This counts in the database instead: fixed one-minute
-- windows (configurable), one row per key per window. Keys are hashed by the
-- caller (no raw IP addresses stored). Old windows are pruned as it goes.
--
-- Service role only: the route calls it with the service client it already
-- uses to check the token.

create table public.rate_limit_hits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 1,
  primary key (key, window_start)
);
alter table public.rate_limit_hits enable row level security;
-- No policies, no grants to anon/authenticated: invisible through the API.

-- Records one hit and returns true if the caller is still within the limit.
create function public.hit_rate_limit(p_key text, p_limit integer, p_window_seconds integer default 60)
returns boolean language plpgsql security definer set search_path = public as
$$
declare
  v_window timestamptz;
  v_hits int;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit settings';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_hits as h (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = h.hits + 1
  returning hits into v_hits;

  -- Cheap housekeeping: roughly one call in fifty clears day-old windows.
  if random() < 0.02 then
    delete from public.rate_limit_hits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on public.rate_limit_hits from anon, authenticated;
grant all on public.rate_limit_hits to service_role;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

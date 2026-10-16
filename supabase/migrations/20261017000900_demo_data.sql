-- Demo data tooling. Demo rows carry a demo_tag. These functions remove them
-- and count them, and the deploy gate refuses to go live while any exist.
-- Service role only.

create function public.demo_row_counts()
returns jsonb language sql stable security definer set search_path = public as
$$
  select jsonb_build_object(
    'users',       (select count(*) from public.users where demo_tag is not null),
    'units',       (select count(*) from public.units where demo_tag is not null),
    'courses',     (select count(*) from public.courses where demo_tag is not null),
    'assignments', (select count(*) from public.assignments where demo_tag is not null)
  )
$$;

-- Remove every row carrying p_tag, children first. Auth users go too (their
-- profile, progress and re-tests cascade). If a real, untagged row still hangs
-- off a tagged unit the delete fails loudly rather than orphaning it.
create function public.purge_demo_data(p_tag text)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  n_users int; n_assignments int; n_courses int; n_units int := 0;
  r record;
begin
  if p_tag is null or btrim(p_tag) = '' then
    raise exception 'a demo tag is required';
  end if;

  with d as (
    delete from auth.users
    where id in (select id from public.users where demo_tag = p_tag)
    returning 1
  ) select count(*) into n_users from d;

  with d as (delete from public.assignments where demo_tag = p_tag returning 1)
  select count(*) into n_assignments from d;

  with d as (delete from public.courses where demo_tag = p_tag returning 1)
  select count(*) into n_courses from d;

  for r in select id from public.units where demo_tag = p_tag
           order by cardinality(path) desc
  loop
    delete from public.units where id = r.id;
    n_units := n_units + 1;
  end loop;

  return jsonb_build_object('tag', p_tag, 'users', n_users, 'assignments', n_assignments,
                            'courses', n_courses, 'units', n_units);
end;
$$;

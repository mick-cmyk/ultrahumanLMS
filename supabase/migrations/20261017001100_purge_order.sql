-- purge_demo_data: delete assignments and courses before the demo users.
-- assignments.created_by references users, so deleting the users first failed
-- whenever a demo admin had created a demo assignment. Found by dry-running the
-- seed against the live schema. Same signature and grants as before.

create or replace function public.purge_demo_data(p_tag text)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  n_users int; n_assignments int; n_courses int; n_units int := 0;
  r record;
begin
  if p_tag is null or btrim(p_tag) = '' then
    raise exception 'a demo tag is required';
  end if;

  with d as (delete from public.assignments where demo_tag = p_tag returning 1)
  select count(*) into n_assignments from d;

  with d as (delete from public.courses where demo_tag = p_tag returning 1)
  select count(*) into n_courses from d;

  with d as (
    delete from auth.users
    where id in (select id from public.users where demo_tag = p_tag)
    returning 1
  ) select count(*) into n_users from d;

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

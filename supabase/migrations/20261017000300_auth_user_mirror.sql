-- Mirror auth.users into public.users. Every auth user (admin createUser, CSV
-- import, bootstrap script) gets a profile row; unit, role and scopes are
-- filled in afterwards by whoever provisioned them.
--
-- A demo seed passes user_metadata.demo_tag so the row is born tagged; the
-- users_demo_email_consistent check then requires a .invalid address.

create function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  insert into public.users (id, email, full_name, demo_tag)
  values (new.id, new.email,
          new.raw_user_meta_data ->> 'full_name',
          nullif(new.raw_user_meta_data ->> 'demo_tag', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create function public.handle_auth_user_email_updated()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_auth_user_email_updated();

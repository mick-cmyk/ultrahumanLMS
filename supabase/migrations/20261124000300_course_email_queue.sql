-- "You have a new course" emails, sent through a queue.
--
-- When an admin saves an assignment they choose: email now, email at a set
-- day and time, or no email. queue_course_emails puts one row per matching
-- person in course_email_queue (rule matching stays in user_matches_rule).
-- The course-notify edge function runs every 10 minutes, sends what is due,
-- and stops at an hourly limit (app_settings.email_hourly_limit, default 100)
-- so a big assignment never uses up the Resend allowance in one go: the rest
-- wait for the next run.
--
-- One "new course" email per person per course, ever: assigning the same
-- course again doesn't email people twice. Demo .invalid addresses are never
-- queued. At send time the function re-checks that the person is still
-- active, still matches an assignment and the course is published; otherwise
-- the row is skipped.

create table public.course_email_queue (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.assignments (id) on delete set null,
  course_id     uuid not null references public.courses (id) on delete cascade,
  user_id       uuid not null references public.users (id) on delete cascade,
  send_after    timestamptz not null,
  status        text not null default 'queued'
                check (status in ('queued', 'sending', 'sent', 'skipped', 'failed', 'cancelled')),
  attempts      integer not null default 0,
  claimed_at    timestamptz,
  sent_at       timestamptz,
  last_error    text,
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (course_id, user_id)
);
create index course_email_queue_due_idx on public.course_email_queue (send_after) where status in ('queued', 'sending');
create index course_email_queue_sent_idx on public.course_email_queue (sent_at) where status = 'sent';
alter table public.course_email_queue enable row level security;
-- No policies: admins reach it through the functions below; the sender uses the service role.

insert into public.app_settings (key, value) values ('email_hourly_limit', '100')
on conflict (key) do nothing;
alter table public.app_settings add constraint app_settings_email_limit_valid
  check (key <> 'email_hourly_limit' or (value ~ '^[0-9]{1,5}$' and value::int between 1 and 10000));

create function public.email_hourly_limit()
returns integer language sql stable security definer set search_path = public as
$$ select coalesce((select value::int from public.app_settings where key = 'email_hourly_limit'), 100) $$;

-- ---------------------------------------------------------------- admins
-- Queue the email for everyone the assignment reaches now. Returns how many
-- were queued (people already emailed about this course, inactive people and
-- demo addresses are left out).
create function public.queue_course_emails(p_assignment uuid, p_send_after timestamptz default now())
returns integer language plpgsql security definer set search_path = public as
$$
declare
  a public.assignments;
  v_count int;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into a from public.assignments where id = p_assignment;
  if a.id is null then
    raise exception 'assignment not found' using errcode = '22023';
  end if;
  if p_send_after is null or p_send_after > now() + interval '1 year' then
    raise exception 'pick a send time within the next year' using errcode = '22023';
  end if;

  insert into public.course_email_queue (assignment_id, course_id, user_id, send_after, created_by)
  select a.id, a.course_id, u.id, greatest(p_send_after, now()), auth.uid()
  from public.users u
  where u.active
    and u.email !~* '\.invalid$'
    and public.user_matches_rule(u.id, a.rule)
  on conflict (course_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Emails still waiting, grouped by assignment and send time, for the Assign page.
create function public.course_email_schedule()
returns table (assignment_id uuid, course_title text, label text, send_after timestamptz,
               queued integer, sent integer, skipped integer, failed integer)
language plpgsql stable security definer set search_path = public as
$$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select q.assignment_id, c.title, a.label, min(q.send_after),
         (count(*) filter (where q.status in ('queued', 'sending')))::int,
         (count(*) filter (where q.status = 'sent'))::int,
         (count(*) filter (where q.status = 'skipped'))::int,
         (count(*) filter (where q.status = 'failed'))::int
  from public.course_email_queue q
  join public.courses c on c.id = q.course_id
  left join public.assignments a on a.id = q.assignment_id
  where q.created_at > now() - interval '30 days'
  group by q.assignment_id, c.title, a.label
  order by min(q.send_after) desc;
end;
$$;

-- Stop emails that haven't gone yet for one assignment.
create function public.cancel_course_emails(p_assignment uuid)
returns integer language plpgsql security definer set search_path = public as
$$
declare
  v_count int;
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.course_email_queue set status = 'cancelled'
   where assignment_id = p_assignment and status = 'queued';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.set_email_hourly_limit(p_limit integer)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'the hourly limit must be between 1 and 10000' using errcode = '22023';
  end if;
  update public.app_settings set value = p_limit::text where key = 'email_hourly_limit';
end;
$$;

-- ---------------------------------------------------------------- the sender (service role)
-- Claim up to the hourly allowance of due emails. Rows stuck in 'sending' for
-- 15 minutes (a run that died) are picked up again. Skips anything that no
-- longer applies.
create function public.claim_course_emails()
returns table (id uuid, user_id uuid, course_id uuid, email text, full_name text, course_title text, attempts integer)
language plpgsql security definer set search_path = public as
$$
declare
  v_room int;
begin
  -- No longer applies: inactive, no longer assigned, or the course unpublished.
  update public.course_email_queue q set status = 'skipped', last_error = 'no longer applies'
  from public.users u, public.courses c
  where q.status = 'queued' and q.send_after <= now()
    and u.id = q.user_id and c.id = q.course_id
    and (not u.active or not c.published
         or not exists (select 1 from public.assignments a
                        where a.course_id = q.course_id and public.user_matches_rule(q.user_id, a.rule)));

  v_room := public.email_hourly_limit()
            - (select count(*) from public.course_email_queue
               where status = 'sent' and sent_at > now() - interval '1 hour');
  if v_room <= 0 then
    return;
  end if;

  return query
  with picked as (
    select q.id from public.course_email_queue q
    where q.send_after <= now()
      and (q.status = 'queued' or (q.status = 'sending' and q.claimed_at < now() - interval '15 minutes'))
    order by q.send_after, q.created_at
    limit v_room
    for update skip locked
  ), claimed as (
    update public.course_email_queue q
       set status = 'sending', claimed_at = now(), attempts = q.attempts + 1
      from picked where q.id = picked.id
    returning q.id, q.user_id, q.course_id, q.attempts
  )
  select cl.id, cl.user_id, cl.course_id, u.email, u.full_name, c.title, cl.attempts
  from claimed cl
  join public.users u on u.id = cl.user_id
  join public.courses c on c.id = cl.course_id;
end;
$$;

-- Record the result of one send. Three failed tries and it stops.
create function public.finish_course_email(p_id uuid, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as
$$
  update public.course_email_queue
     set status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         last_error = case when p_ok then null else left(p_error, 500) end,
         -- a failed try waits ten minutes before the next one
         send_after = case when p_ok then send_after else now() + interval '10 minutes' end
   where id = p_id and status = 'sending'
$$;

-- ---------------------------------------------------------------- scheduling
-- The sender runs every 10 minutes. New deployments get it from
-- schedule_edge_jobs; an existing one runs schedule_course_notify_like_retest()
-- once, which copies the URL and secret from the re-test job.
create function public._schedule_edge_job_every(p_job text, p_cron text, p_url_setting text, p_secret_setting text)
returns text language plpgsql security definer set search_path = public as
$$
declare
  v_url text := current_setting(p_url_setting, true);
  v_secret text := current_setting(p_secret_setting, true);
begin
  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    raise exception 'set % and % first', p_url_setting, p_secret_setting;
  end if;
  perform cron.unschedule(p_job) where exists (select 1 from cron.job where jobname = p_job);
  perform cron.schedule(
    p_job,
    p_cron,
    format(
      $cmd$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
        body := '{}'::jsonb)$cmd$,
      v_url, v_secret)
  );
  return 'scheduled: ' || p_job;
end;
$$;

create or replace function public.schedule_edge_jobs(p_functions_base_url text, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_base text := regexp_replace(coalesce(p_functions_base_url, ''), '/+$', '');
begin
  if v_base = '' or p_secret is null or length(p_secret) < 16 then
    raise exception 'a functions base URL and a secret of at least 16 characters are required';
  end if;

  perform set_config('app.settings.retest_dispatch_url', v_base || '/retest-dispatch', true);
  perform set_config('app.settings.retest_dispatch_secret', p_secret, true);
  perform set_config('app.settings.weekly_digest_url', v_base || '/weekly-digest', true);
  perform set_config('app.settings.weekly_digest_secret', p_secret, true);
  perform set_config('app.settings.course_notify_url', v_base || '/course-notify', true);
  perform set_config('app.settings.course_notify_secret', p_secret, true);

  return jsonb_build_object(
    'retest_dispatch', public.schedule_retest_dispatch(),
    'weekly_digest', public.schedule_weekly_digest(),
    'course_notify', public._schedule_edge_job_every('course-notify-10min', '*/10 * * * *',
                       'app.settings.course_notify_url', 'app.settings.course_notify_secret')
  );
end;
$$;

-- For a project whose re-test job is already scheduled: add the course sender
-- with the same base URL and secret, without anyone handling the secret.
create function public.schedule_course_notify_like_retest()
returns text language plpgsql security definer set search_path = public as
$$
declare
  v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'retest-dispatch-hourly';
  if v_cmd is null then
    raise exception 'retest-dispatch-hourly is not scheduled; run schedule_edge_jobs instead';
  end if;
  perform cron.unschedule('course-notify-10min') where exists (select 1 from cron.job where jobname = 'course-notify-10min');
  perform cron.schedule('course-notify-10min', '*/10 * * * *', replace(v_cmd, '/retest-dispatch', '/course-notify'));
  return 'scheduled: course-notify-10min';
end;
$$;

-- ---------------------------------------------------------------- grants
revoke all on public.course_email_queue from anon, authenticated;
grant all on public.course_email_queue to service_role;

revoke execute on function
  public.email_hourly_limit(),
  public.queue_course_emails(uuid, timestamptz),
  public.course_email_schedule(),
  public.cancel_course_emails(uuid),
  public.set_email_hourly_limit(integer),
  public.claim_course_emails(),
  public.finish_course_email(uuid, boolean, text),
  public._schedule_edge_job_every(text, text, text, text),
  public.schedule_edge_jobs(text, text),
  public.schedule_course_notify_like_retest()
  from public, anon, authenticated;
grant execute on function
  public.email_hourly_limit(),
  public.queue_course_emails(uuid, timestamptz),
  public.course_email_schedule(),
  public.cancel_course_emails(uuid),
  public.set_email_hourly_limit(integer),
  public.claim_course_emails(),
  public.finish_course_email(uuid, boolean, text),
  public._schedule_edge_job_every(text, text, text, text),
  public.schedule_edge_jobs(text, text),
  public.schedule_course_notify_like_retest()
  to service_role;
grant execute on function
  public.email_hourly_limit(),
  public.queue_course_emails(uuid, timestamptz),
  public.course_email_schedule(),
  public.cancel_course_emails(uuid),
  public.set_email_hourly_limit(integer)
  to authenticated;

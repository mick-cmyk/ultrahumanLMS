-- Messages: announcements, questions up the chain, and lesson discussions.
--
-- Three separate things, on purpose (docs/HANDOVER.md, "Messages"):
--
-- 1. Announcements: admins and managers post to an audience picked with the
--    same rule shape as course assignment, matched only by user_matches_rule.
--    A manager's audience is also cut to their own scope. Recipients are fixed
--    when it's posted, and each one taps "Got it" (acknowledged). "Important"
--    ones are emailed too.
-- 2. Questions: a conversation about one person (the "subject"). Staff ask
--    their managers; managers message someone in their area. It is never
--    private between two people: the subject, every manager whose scope
--    covers the subject's unit, and admins can all see it. There are no
--    private messages between staff.
-- 3. Discussions: posts under a lesson, seen only by people in the same unit
--    (store or branch) plus the managers above it. Off until an admin turns it
--    on (app_settings.discussions = 'unit'). Anyone can report a post;
--    managers and admins hide or pin.
--
-- Everything here is reached through the functions below; the tables have no
-- grants. Emails go through message_email_queue, sent by the course-notify
-- edge function under the same hourly limit as course emails, and only
-- between 8am and 8pm Sydney time (right to disconnect): anything written
-- outside those hours waits until 8am.

-- ---------------------------------------------------------------- settings
insert into public.app_settings (key, value) values ('discussions', 'off')
on conflict (key) do nothing;
alter table public.app_settings add constraint app_settings_discussions_valid
  check (key <> 'discussions' or value in ('off', 'unit'));

-- ---------------------------------------------------------------- tables
create table public.announcements (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid references public.users (id) on delete set null,
  title          text not null check (length(btrim(title)) between 1 and 120),
  body           text not null check (length(btrim(body)) between 1 and 4000),
  link_url       text check (link_url is null or (link_url ~ '^https://[^\s]+$' and length(link_url) <= 500)),
  audience       jsonb not null check (jsonb_typeof(audience) = 'object'),
  audience_label text check (audience_label is null or length(audience_label) <= 200),
  important      boolean not null default false,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index announcements_author_idx on public.announcements (author_id, created_at desc);

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id         uuid not null references public.users (id) on delete cascade,
  read_at         timestamptz,
  acknowledged_at timestamptz,
  primary key (announcement_id, user_id)
);
create index announcement_recipients_user_idx on public.announcement_recipients (user_id);

create table public.threads (
  id               uuid primary key default gen_random_uuid(),
  subject_user_id  uuid not null references public.users (id) on delete cascade,
  -- The subject's unit when the thread started: decides which managers see it.
  unit_id          uuid references public.units (id) on delete set null,
  lesson_id        uuid references public.lessons (id) on delete set null,
  title            text not null check (length(btrim(title)) between 1 and 120),
  created_by       uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  last_message_by  uuid references public.users (id) on delete set null,
  closed_at        timestamptz
);
create index threads_subject_idx on public.threads (subject_user_id);
create index threads_unit_idx on public.threads (unit_id);

create table public.thread_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.threads (id) on delete cascade,
  author_id  uuid references public.users (id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index thread_messages_thread_idx on public.thread_messages (thread_id, created_at);

create table public.thread_reads (
  thread_id uuid not null references public.threads (id) on delete cascade,
  user_id   uuid not null references public.users (id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table public.discussion_posts (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.lessons (id) on delete cascade,
  -- The group: the unit (store or branch) whose people see the post.
  unit_id     uuid not null references public.units (id) on delete cascade,
  parent_id   uuid references public.discussion_posts (id) on delete cascade,
  author_id   uuid references public.users (id) on delete set null,
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  pinned      boolean not null default false,
  reported_at timestamptz,
  reported_by uuid references public.users (id) on delete set null,
  hidden_at   timestamptz,
  hidden_by   uuid references public.users (id) on delete set null
);
create index discussion_posts_lesson_idx on public.discussion_posts (lesson_id, unit_id, created_at);
create index discussion_posts_reported_idx on public.discussion_posts (reported_at) where reported_at is not null and hidden_at is null;

create table public.message_email_queue (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('announcement', 'thread')),
  ref_id      uuid not null,
  user_id     uuid not null references public.users (id) on delete cascade,
  send_after  timestamptz not null,
  status      text not null default 'queued'
              check (status in ('queued', 'sending', 'sent', 'skipped', 'failed', 'cancelled')),
  attempts    integer not null default 0,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  last_error  text,
  created_at  timestamptz not null default now()
);
-- One waiting email per person per announcement or thread: a busy thread
-- doesn't send one email per reply.
create unique index message_email_queue_one_waiting on public.message_email_queue (kind, ref_id, user_id) where status = 'queued';
create index message_email_queue_due_idx on public.message_email_queue (send_after) where status in ('queued', 'sending');
create index message_email_queue_sent_idx on public.message_email_queue (sent_at) where status = 'sent';

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.threads enable row level security;
alter table public.thread_messages enable row level security;
alter table public.thread_reads enable row level security;
alter table public.discussion_posts enable row level security;
alter table public.message_email_queue enable row level security;
-- No policies: everything goes through the functions below.

-- ---------------------------------------------------------------- helpers
-- When an email may go: now if it's 8am to 8pm in Sydney, else the next 8am.
create function public._next_send_time(p_at timestamptz default now())
returns timestamptz language sql stable set search_path = public as
$$
  select case
    when extract(hour from p_at at time zone 'Australia/Sydney') between 8 and 19 then p_at
    when extract(hour from p_at at time zone 'Australia/Sydney') < 8
      then (date_trunc('day', p_at at time zone 'Australia/Sydney') + interval '8 hours') at time zone 'Australia/Sydney'
    else (date_trunc('day', p_at at time zone 'Australia/Sydney') + interval '1 day 8 hours') at time zone 'Australia/Sydney'
  end
$$;

create function public._user_name(p_user uuid)
returns text language sql stable security definer set search_path = public as
$$ select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) from public.users where id = p_user $$;

create function public._queue_message_email(p_kind text, p_ref uuid, p_user uuid)
returns void language sql security definer set search_path = public as
$$
  insert into public.message_email_queue (kind, ref_id, user_id, send_after)
  select p_kind, p_ref, u.id, public._next_send_time()
  from public.users u
  where u.id = p_user and u.active and u.email !~* '\.invalid$' and u.id is distinct from auth.uid()
  on conflict (kind, ref_id, user_id) where status = 'queued' do nothing
$$;

-- ---------------------------------------------------------------- announcements
-- Who an announcement reaches: active people matching the rule (never
-- reimplemented elsewhere), cut to the author's scope unless they're an admin.
create function public._announcement_audience(p_author uuid, p_rule jsonb)
returns setof uuid language sql stable security definer set search_path = public as
$$
  select u.id
  from public.users u
  join public.users a on a.id = p_author and a.active and a.role in ('admin', 'manager')
  where u.active
    and u.id <> p_author
    and public.user_matches_rule(u.id, p_rule)
    and (a.role = 'admin' or (u.unit_id is not null and public._in_scope(p_author, u.unit_id)))
$$;

create function public.announcement_reach(p_rule jsonb)
returns integer language plpgsql stable security definer set search_path = public as
$$
begin
  if public.app_role() not in ('admin', 'manager') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select count(*)::int from public._announcement_audience(auth.uid(), p_rule));
end;
$$;

create function public.post_announcement(p_title text, p_body text, p_link text, p_rule jsonb,
                                         p_label text default null, p_important boolean default false)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_id uuid;
  v_recipients int;
  v_emails int := 0;
begin
  if public.app_role() not in ('admin', 'manager') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' then
    raise exception 'pick who it goes to' using errcode = '22023';
  end if;
  if not public.hit_rate_limit('announce:' || auth.uid(), 20, 3600) then
    raise exception 'too many announcements in the last hour' using errcode = '22023';
  end if;

  insert into public.announcements (author_id, title, body, link_url, audience, audience_label, important)
  values (auth.uid(), btrim(p_title), btrim(p_body), nullif(btrim(coalesce(p_link, '')), ''), p_rule,
          nullif(btrim(coalesce(p_label, '')), ''), coalesce(p_important, false))
  returning id into v_id;

  insert into public.announcement_recipients (announcement_id, user_id)
  select v_id, x from public._announcement_audience(auth.uid(), p_rule) x;
  get diagnostics v_recipients = row_count;

  if v_recipients = 0 then
    raise exception 'nobody is in that audience' using errcode = '22023';
  end if;

  if p_important then
    insert into public.message_email_queue (kind, ref_id, user_id, send_after)
    select 'announcement', v_id, r.user_id, public._next_send_time()
    from public.announcement_recipients r
    join public.users u on u.id = r.user_id
    where r.announcement_id = v_id and u.email !~* '\.invalid$'
    on conflict (kind, ref_id, user_id) where status = 'queued' do nothing;
    get diagnostics v_emails = row_count;
  end if;

  return jsonb_build_object('id', v_id, 'recipients', v_recipients, 'emails', v_emails,
                            'send_after', case when v_emails > 0 then public._next_send_time() end);
end;
$$;

create function public.my_announcements(p_limit integer default 50)
returns table (id uuid, title text, body text, link_url text, important boolean, created_at timestamptz,
               author_name text, read_at timestamptz, acknowledged_at timestamptz)
language sql stable security definer set search_path = public as
$$
  select a.id, a.title, a.body, a.link_url, a.important, a.created_at,
         public._user_name(a.author_id), r.read_at, r.acknowledged_at
  from public.announcement_recipients r
  join public.announcements a on a.id = r.announcement_id and a.deleted_at is null
  where r.user_id = auth.uid()
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create function public.acknowledge_announcement(p_id uuid)
returns void language sql security definer set search_path = public as
$$
  update public.announcement_recipients
     set read_at = coalesce(read_at, now()), acknowledged_at = coalesce(acknowledged_at, now())
   where announcement_id = p_id and user_id = auth.uid()
$$;

create function public.mark_announcements_read()
returns void language sql security definer set search_path = public as
$$
  update public.announcement_recipients set read_at = now()
   where user_id = auth.uid() and read_at is null
$$;

-- Announcements the caller sent (admins see everyone's), with read and
-- acknowledged counts.
create function public.sent_announcements(p_limit integer default 50)
returns table (id uuid, title text, created_at timestamptz, author_name text, audience_label text,
               important boolean, recipients integer, read integer, acknowledged integer, mine boolean)
language plpgsql stable security definer set search_path = public as
$$
begin
  if public.app_role() not in ('admin', 'manager') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select a.id, a.title, a.created_at, public._user_name(a.author_id), a.audience_label, a.important,
         count(r.user_id)::int,
         (count(*) filter (where r.read_at is not null))::int,
         (count(*) filter (where r.acknowledged_at is not null))::int,
         a.author_id = auth.uid()
  from public.announcements a
  left join public.announcement_recipients r on r.announcement_id = a.id
  where a.deleted_at is null and (a.author_id = auth.uid() or public.app_role() = 'admin')
  group by a.id
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- Who hasn't tapped "Got it" yet.
create function public.announcement_outstanding(p_id uuid)
returns table (user_id uuid, full_name text, email text, unit_name text, read_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$
begin
  if not exists (select 1 from public.announcements a
                 where a.id = p_id and a.deleted_at is null
                   and (a.author_id = auth.uid() or public.app_role() = 'admin')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select u.id, u.full_name, u.email, un.name, r.read_at
  from public.announcement_recipients r
  join public.users u on u.id = r.user_id
  left join public.units un on un.id = u.unit_id
  where r.announcement_id = p_id and r.acknowledged_at is null
  order by un.name nulls last, u.full_name;
end;
$$;

create function public.delete_announcement(p_id uuid)
returns void language plpgsql security definer set search_path = public as
$$
begin
  update public.announcements set deleted_at = now()
   where id = p_id and deleted_at is null
     and (author_id = auth.uid() or public.app_role() = 'admin');
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.message_email_queue set status = 'cancelled'
   where kind = 'announcement' and ref_id = p_id and status = 'queued';
end;
$$;

-- ---------------------------------------------------------------- questions
create function public._can_see_thread(p_thread uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1 from public.threads t
    join public.users me on me.id = p_user and me.active
    where t.id = p_thread
      and (t.subject_user_id = p_user
           or me.role = 'admin'
           or (me.role = 'manager' and t.unit_id is not null and public._in_scope(p_user, t.unit_id)))
  )
$$;

-- The managers to tell about a new question: those with a scope unit closest
-- above the subject's unit. If nobody manages that branch, the admins.
create function public._nearest_managers(p_unit uuid, p_except uuid)
returns setof uuid language sql stable security definer set search_path = public as
$$
  with target as (select path from public.units where id = p_unit),
  mgrs as (
    select m.id, max(array_position(t.path, s.unit_id)) as depth
    from target t
    join public.user_scopes s on s.unit_id = any (t.path)
    join public.users m on m.id = s.user_id and m.active and m.role = 'manager'
    where m.id <> p_except
    group by m.id
  )
  select id from mgrs where depth = (select max(depth) from mgrs)
  union all
  select u.id from public.users u
  where u.active and u.role = 'admin' and u.id <> p_except and not exists (select 1 from mgrs)
$$;

create function public.start_thread(p_title text, p_body text, p_about uuid default null, p_lesson uuid default null)
returns uuid language plpgsql security definer set search_path = public as
$$
declare
  me public.users;
  subj public.users;
  v_id uuid;
begin
  select * into me from public.users where id = auth.uid() and active;
  if me.id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.hit_rate_limit('thread:' || me.id, 20, 3600) then
    raise exception 'too many new conversations in the last hour' using errcode = '22023';
  end if;

  if p_about is null or p_about = me.id then
    subj := me;
  else
    select * into subj from public.users where id = p_about and active;
    if subj.id is null or not (me.role = 'admin'
                               or (me.role = 'manager' and subj.unit_id is not null and public.in_my_scope(subj.unit_id))) then
      raise exception 'you can only message people in your area' using errcode = '42501';
    end if;
  end if;
  if p_lesson is not null and not exists (select 1 from public.lessons where id = p_lesson) then
    raise exception 'lesson not found' using errcode = '22023';
  end if;

  insert into public.threads (subject_user_id, unit_id, lesson_id, title, created_by, last_message_by)
  values (subj.id, subj.unit_id, p_lesson, btrim(p_title), me.id, me.id)
  returning id into v_id;
  insert into public.thread_messages (thread_id, author_id, body) values (v_id, me.id, btrim(p_body));
  insert into public.thread_reads (thread_id, user_id) values (v_id, me.id);

  if subj.id = me.id then
    if subj.unit_id is not null then
      perform public._queue_message_email('thread', v_id, x) from public._nearest_managers(subj.unit_id, me.id) x;
    else
      perform public._queue_message_email('thread', v_id, u.id) from public.users u where u.active and u.role = 'admin';
    end if;
  else
    perform public._queue_message_email('thread', v_id, subj.id);
  end if;
  return v_id;
end;
$$;

create function public.reply_thread(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as
$$
declare
  t public.threads;
begin
  if not public._can_see_thread(p_id, auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.hit_rate_limit('reply:' || auth.uid(), 60, 3600) then
    raise exception 'too many messages in the last hour' using errcode = '22023';
  end if;
  select * into t from public.threads where id = p_id;
  insert into public.thread_messages (thread_id, author_id, body) values (p_id, auth.uid(), btrim(p_body));
  update public.threads set last_message_at = now(), last_message_by = auth.uid(), closed_at = null where id = p_id;
  insert into public.thread_reads (thread_id, user_id) values (p_id, auth.uid())
  on conflict (thread_id, user_id) do update set read_at = now();

  if auth.uid() = t.subject_user_id then
    -- Tell the managers who have replied; if none have, the nearest ones.
    if exists (select 1 from public.thread_messages m where m.thread_id = p_id and m.author_id <> t.subject_user_id) then
      perform public._queue_message_email('thread', p_id, m.author_id)
      from (select distinct author_id from public.thread_messages
            where thread_id = p_id and author_id is not null and author_id <> t.subject_user_id) m
      where public._can_see_thread(p_id, m.author_id);
    elsif t.unit_id is not null then
      perform public._queue_message_email('thread', p_id, x) from public._nearest_managers(t.unit_id, auth.uid()) x;
    end if;
  else
    perform public._queue_message_email('thread', p_id, t.subject_user_id);
  end if;
end;
$$;

create function public.close_thread(p_id uuid, p_closed boolean default true)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public._can_see_thread(p_id, auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.threads set closed_at = case when p_closed then now() end where id = p_id;
end;
$$;

-- The caller's conversations: their own, plus (managers) everyone's in their
-- area, plus (admins) all. waiting = the last word was the subject's.
create function public.my_threads(p_limit integer default 100)
returns table (id uuid, title text, subject_id uuid, subject_name text, unit_name text,
               lesson_id uuid, lesson_title text, created_at timestamptz, last_message_at timestamptz,
               last_message_by_name text, messages integer, unread boolean, waiting boolean,
               closed boolean, mine boolean)
language sql stable security definer set search_path = public as
$$
  select t.id, t.title, t.subject_user_id, public._user_name(t.subject_user_id), un.name,
         t.lesson_id, l.title, t.created_at, t.last_message_at, public._user_name(t.last_message_by),
         (select count(*)::int from public.thread_messages m where m.thread_id = t.id),
         t.last_message_by is distinct from auth.uid()
           and coalesce(rd.read_at < t.last_message_at, true),
         t.last_message_by = t.subject_user_id and t.closed_at is null,
         t.closed_at is not null,
         t.subject_user_id = auth.uid()
  from public.threads t
  left join public.units un on un.id = t.unit_id
  left join public.lessons l on l.id = t.lesson_id
  left join public.thread_reads rd on rd.thread_id = t.id and rd.user_id = auth.uid()
  where public._can_see_thread(t.id, auth.uid())
  order by t.last_message_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

-- One conversation with its messages. Marks it read for the caller.
create function public.get_thread(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v jsonb;
begin
  if not public._can_see_thread(p_id, auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.thread_reads (thread_id, user_id) values (p_id, auth.uid())
  on conflict (thread_id, user_id) do update set read_at = now();

  select jsonb_build_object(
    'id', t.id, 'title', t.title, 'subject_id', t.subject_user_id,
    'subject_name', public._user_name(t.subject_user_id), 'unit_name', un.name,
    'lesson_id', t.lesson_id, 'lesson_title', l.title, 'created_at', t.created_at,
    'closed', t.closed_at is not null, 'mine', t.subject_user_id = auth.uid(),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'body', m.body, 'created_at', m.created_at,
               'author_name', coalesce(public._user_name(m.author_id), 'Someone who has left'),
               'author_role', au.role, 'mine', m.author_id = auth.uid())
             order by m.created_at)
      from public.thread_messages m
      left join public.users au on au.id = m.author_id
      where m.thread_id = t.id), '[]'::jsonb))
  into v
  from public.threads t
  left join public.units un on un.id = t.unit_id
  left join public.lessons l on l.id = t.lesson_id
  where t.id = p_id;
  return v;
end;
$$;

-- ---------------------------------------------------------------- discussions
create function public.discussion_mode()
returns text language sql stable security definer set search_path = public as
$$ select coalesce((select value from public.app_settings where key = 'discussions'), 'off') $$;

create function public.set_discussion_mode(p_mode text)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_mode not in ('off', 'unit') then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  update public.app_settings set value = p_mode where key = 'discussions';
end;
$$;

-- Can p_user see posts in group p_unit? Their own unit, or (managers) a unit
-- in their scope, or (admins) any.
create function public._sees_discussion_group(p_unit uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.users u
                 where u.id = p_user and u.active
                   and (u.unit_id = p_unit or u.role = 'admin'
                        or (u.role = 'manager' and public._in_scope(p_user, p_unit))))
$$;

create function public._moderates_discussion_group(p_unit uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.users u
                 where u.id = p_user and u.active
                   and (u.role = 'admin' or (u.role = 'manager' and public._in_scope(p_user, p_unit))))
$$;

create function public.lesson_discussion(p_lesson uuid)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
begin
  if public.discussion_mode() = 'off' or auth.uid() is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'parent_id', p.parent_id,
             'body', case when p.hidden_at is null then p.body end,
             'hidden', p.hidden_at is not null,
             'author_name', coalesce(public._user_name(p.author_id), 'Someone who has left'),
             'author_role', au.role,
             'unit_id', p.unit_id, 'unit_name', un.name,
             'created_at', p.created_at, 'pinned', p.pinned,
             'reported', p.reported_at is not null and public._moderates_discussion_group(p.unit_id, auth.uid()),
             'mine', p.author_id = auth.uid(),
             'can_moderate', public._moderates_discussion_group(p.unit_id, auth.uid()))
           order by p.pinned desc, p.created_at)
    from public.discussion_posts p
    join public.units un on un.id = p.unit_id
    left join public.users au on au.id = p.author_id
    where p.lesson_id = p_lesson
      and public._sees_discussion_group(p.unit_id, auth.uid())
      -- hidden posts stay as a placeholder only when they have replies
      and (p.hidden_at is null or exists (select 1 from public.discussion_posts c where c.parent_id = p.id and c.hidden_at is null))
  ), '[]'::jsonb);
end;
$$;

create function public.post_discussion(p_lesson uuid, p_body text, p_parent uuid default null)
returns uuid language plpgsql security definer set search_path = public as
$$
declare
  me public.users;
  v_unit uuid;
  v_course uuid;
  v_parent public.discussion_posts;
  v_id uuid;
begin
  if public.discussion_mode() = 'off' then
    raise exception 'discussions are turned off' using errcode = '22023';
  end if;
  select * into me from public.users where id = auth.uid() and active;
  if me.id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select m.course_id into v_course from public.lessons l join public.modules m on m.id = l.module_id where l.id = p_lesson;
  if v_course is null then
    raise exception 'lesson not found' using errcode = '22023';
  end if;
  if not (me.role in ('admin', 'manager') or public.user_sees_course(v_course)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not public.hit_rate_limit('discuss:' || me.id, 30, 3600) then
    raise exception 'too many posts in the last hour' using errcode = '22023';
  end if;

  if p_parent is not null then
    select * into v_parent from public.discussion_posts where id = p_parent and lesson_id = p_lesson;
    if v_parent.id is null or v_parent.hidden_at is not null
       or not public._sees_discussion_group(v_parent.unit_id, me.id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    -- replies stay with the post they answer, one level deep
    v_unit := v_parent.unit_id;
    p_parent := coalesce(v_parent.parent_id, v_parent.id);
  else
    v_unit := me.unit_id;
    if v_unit is null then
      raise exception 'you need to be placed in a store or branch to post' using errcode = '22023';
    end if;
  end if;

  insert into public.discussion_posts (lesson_id, unit_id, parent_id, author_id, body)
  values (p_lesson, v_unit, p_parent, me.id, btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.report_discussion_post(p_id uuid)
returns void language plpgsql security definer set search_path = public as
$$
begin
  update public.discussion_posts p set reported_at = coalesce(p.reported_at, now()), reported_by = coalesce(p.reported_by, auth.uid())
   where p.id = p_id and p.hidden_at is null and public._sees_discussion_group(p.unit_id, auth.uid());
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;

-- hide / unhide / pin / unpin / clear (dismiss a report): moderators.
-- remove: the author takes down their own post.
create function public.moderate_discussion_post(p_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as
$$
declare
  p public.discussion_posts;
begin
  select * into p from public.discussion_posts where id = p_id;
  if p.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action = 'remove' then
    if p.author_id is distinct from auth.uid() then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    update public.discussion_posts set hidden_at = now(), hidden_by = auth.uid() where id = p_id;
    return;
  end if;
  if not public._moderates_discussion_group(p.unit_id, auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  case p_action
    when 'hide'   then update public.discussion_posts set hidden_at = now(), hidden_by = auth.uid() where id = p_id;
    when 'unhide' then update public.discussion_posts set hidden_at = null, hidden_by = null, reported_at = null, reported_by = null where id = p_id;
    when 'pin'    then update public.discussion_posts set pinned = true where id = p_id;
    when 'unpin'  then update public.discussion_posts set pinned = false where id = p_id;
    when 'clear'  then update public.discussion_posts set reported_at = null, reported_by = null where id = p_id;
    else raise exception 'unknown action' using errcode = '22023';
  end case;
end;
$$;

create function public.reported_discussion_posts()
returns table (id uuid, lesson_id uuid, lesson_title text, unit_name text, body text,
               author_name text, reported_at timestamptz, reported_by_name text)
language sql stable security definer set search_path = public as
$$
  select p.id, p.lesson_id, l.title, un.name, p.body, public._user_name(p.author_id), p.reported_at,
         public._user_name(p.reported_by)
  from public.discussion_posts p
  join public.lessons l on l.id = p.lesson_id
  join public.units un on un.id = p.unit_id
  where p.reported_at is not null and p.hidden_at is null
    and public._moderates_discussion_group(p.unit_id, auth.uid())
  order by p.reported_at
$$;

-- ---------------------------------------------------------------- badge
create function public.message_counts()
returns jsonb language sql stable security definer set search_path = public as
$$
  select jsonb_build_object(
    'announcements', (select count(*) from public.announcement_recipients r
                      join public.announcements a on a.id = r.announcement_id and a.deleted_at is null
                      where r.user_id = auth.uid() and r.read_at is null),
    'unacknowledged', (select count(*) from public.announcement_recipients r
                       join public.announcements a on a.id = r.announcement_id and a.deleted_at is null
                       where r.user_id = auth.uid() and r.acknowledged_at is null),
    'threads', (select count(*) from public.threads t
                left join public.thread_reads rd on rd.thread_id = t.id and rd.user_id = auth.uid()
                where t.last_message_by is distinct from auth.uid()
                  and coalesce(rd.read_at < t.last_message_at, true)
                  and public._can_see_thread(t.id, auth.uid())),
    'reported', (select count(*) from public.discussion_posts p
                 where p.reported_at is not null and p.hidden_at is null
                   and public._moderates_discussion_group(p.unit_id, auth.uid())))
$$;

-- ---------------------------------------------------------------- the sender (service role)
-- Room left this hour, shared by course emails and message emails.
create function public._email_room()
returns integer language sql stable security definer set search_path = public as
$$
  select public.email_hourly_limit()
       - (select count(*) from public.course_email_queue
          where (status = 'sent' and sent_at > now() - interval '1 hour')
             or (status = 'sending' and claimed_at > now() - interval '15 minutes'))::int
       - (select count(*) from public.message_email_queue
          where (status = 'sent' and sent_at > now() - interval '1 hour')
             or (status = 'sending' and claimed_at > now() - interval '15 minutes'))::int
$$;

create function public.claim_message_emails()
returns table (id uuid, kind text, ref_id uuid, user_id uuid, email text, full_name text,
               title text, preview text, from_name text, attempts integer)
language plpgsql security definer set search_path = public as
$$
declare
  v_room int;
begin
  -- No longer applies: inactive, announcement deleted or already read, or the
  -- thread read since the email was queued.
  update public.message_email_queue q set status = 'skipped', last_error = 'no longer applies'
  from public.users u
  where q.status = 'queued' and q.send_after <= now() and u.id = q.user_id
    and (not u.active
         or (q.kind = 'announcement' and not exists (
               select 1 from public.announcement_recipients r
               join public.announcements a on a.id = r.announcement_id and a.deleted_at is null
               where r.announcement_id = q.ref_id and r.user_id = q.user_id and r.read_at is null))
         or (q.kind = 'thread' and (
               not public._can_see_thread(q.ref_id, q.user_id)
               or exists (select 1 from public.thread_reads rd
                          where rd.thread_id = q.ref_id and rd.user_id = q.user_id and rd.read_at >= q.created_at))));

  v_room := public._email_room();
  if v_room <= 0 then
    return;
  end if;

  return query
  with picked as (
    select q.id from public.message_email_queue q
    where q.send_after <= now()
      and (q.status = 'queued' or (q.status = 'sending' and q.claimed_at < now() - interval '15 minutes'))
    order by q.send_after, q.created_at
    limit v_room
    for update skip locked
  ), claimed as (
    update public.message_email_queue q
       set status = 'sending', claimed_at = now(), attempts = q.attempts + 1
      from picked where q.id = picked.id
    returning q.id, q.kind, q.ref_id, q.user_id, q.attempts
  )
  select cl.id, cl.kind, cl.ref_id, cl.user_id, u.email, u.full_name,
         coalesce(a.title, t.title),
         left(coalesce(a.body, (select m.body from public.thread_messages m where m.thread_id = t.id order by m.created_at desc limit 1)), 300),
         public._user_name(coalesce(a.author_id, t.last_message_by)),
         cl.attempts
  from claimed cl
  join public.users u on u.id = cl.user_id
  left join public.announcements a on cl.kind = 'announcement' and a.id = cl.ref_id
  left join public.threads t on cl.kind = 'thread' and t.id = cl.ref_id;
end;
$$;

create function public.finish_message_email(p_id uuid, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as
$$
  update public.message_email_queue
     set status = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end,
         last_error = case when p_ok then null else left(p_error, 500) end,
         send_after = case when p_ok then send_after else now() + interval '10 minutes' end
   where id = p_id and status = 'sending'
$$;

-- Course emails now share the hourly room with message emails.
create or replace function public.claim_course_emails()
returns table (id uuid, user_id uuid, course_id uuid, email text, full_name text, course_title text, attempts integer)
language plpgsql security definer set search_path = public as
$$
declare
  v_room int;
begin
  update public.course_email_queue q set status = 'skipped', last_error = 'no longer applies'
  from public.users u, public.courses c
  where q.status = 'queued' and q.send_after <= now()
    and u.id = q.user_id and c.id = q.course_id
    and (not u.active or not c.published
         or not exists (select 1 from public.assignments a
                        where a.course_id = q.course_id and public.user_matches_rule(q.user_id, a.rule)));

  v_room := public._email_room();
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

-- ---------------------------------------------------------------- grants
revoke all on public.announcements, public.announcement_recipients, public.threads,
              public.thread_messages, public.thread_reads, public.discussion_posts,
              public.message_email_queue
  from anon, authenticated;
grant all on public.announcements, public.announcement_recipients, public.threads,
             public.thread_messages, public.thread_reads, public.discussion_posts,
             public.message_email_queue
  to service_role;

revoke execute on function
  public._next_send_time(timestamptz),
  public._user_name(uuid),
  public._queue_message_email(text, uuid, uuid),
  public._announcement_audience(uuid, jsonb),
  public.announcement_reach(jsonb),
  public.post_announcement(text, text, text, jsonb, text, boolean),
  public.my_announcements(integer),
  public.acknowledge_announcement(uuid),
  public.mark_announcements_read(),
  public.sent_announcements(integer),
  public.announcement_outstanding(uuid),
  public.delete_announcement(uuid),
  public._can_see_thread(uuid, uuid),
  public._nearest_managers(uuid, uuid),
  public.start_thread(text, text, uuid, uuid),
  public.reply_thread(uuid, text),
  public.close_thread(uuid, boolean),
  public.my_threads(integer),
  public.get_thread(uuid),
  public.discussion_mode(),
  public.set_discussion_mode(text),
  public._sees_discussion_group(uuid, uuid),
  public._moderates_discussion_group(uuid, uuid),
  public.lesson_discussion(uuid),
  public.post_discussion(uuid, text, uuid),
  public.report_discussion_post(uuid),
  public.moderate_discussion_post(uuid, text),
  public.reported_discussion_posts(),
  public.message_counts(),
  public._email_room(),
  public.claim_message_emails(),
  public.finish_message_email(uuid, boolean, text),
  public.claim_course_emails()
  from public, anon, authenticated;

grant execute on function
  public._next_send_time(timestamptz),
  public._user_name(uuid),
  public._queue_message_email(text, uuid, uuid),
  public._announcement_audience(uuid, jsonb),
  public.announcement_reach(jsonb),
  public.post_announcement(text, text, text, jsonb, text, boolean),
  public.my_announcements(integer),
  public.acknowledge_announcement(uuid),
  public.mark_announcements_read(),
  public.sent_announcements(integer),
  public.announcement_outstanding(uuid),
  public.delete_announcement(uuid),
  public._can_see_thread(uuid, uuid),
  public._nearest_managers(uuid, uuid),
  public.start_thread(text, text, uuid, uuid),
  public.reply_thread(uuid, text),
  public.close_thread(uuid, boolean),
  public.my_threads(integer),
  public.get_thread(uuid),
  public.discussion_mode(),
  public.set_discussion_mode(text),
  public._sees_discussion_group(uuid, uuid),
  public._moderates_discussion_group(uuid, uuid),
  public.lesson_discussion(uuid),
  public.post_discussion(uuid, text, uuid),
  public.report_discussion_post(uuid),
  public.moderate_discussion_post(uuid, text),
  public.reported_discussion_posts(),
  public.message_counts(),
  public._email_room(),
  public.claim_message_emails(),
  public.finish_message_email(uuid, boolean, text),
  public.claim_course_emails()
  to service_role;

-- What a signed-in person may call. Each checks auth.uid() and the caller's
-- role itself; the internal helpers above stay service-role only.
grant execute on function
  public.announcement_reach(jsonb),
  public.post_announcement(text, text, text, jsonb, text, boolean),
  public.my_announcements(integer),
  public.acknowledge_announcement(uuid),
  public.mark_announcements_read(),
  public.sent_announcements(integer),
  public.announcement_outstanding(uuid),
  public.delete_announcement(uuid),
  public.start_thread(text, text, uuid, uuid),
  public.reply_thread(uuid, text),
  public.close_thread(uuid, boolean),
  public.my_threads(integer),
  public.get_thread(uuid),
  public.discussion_mode(),
  public.set_discussion_mode(text),
  public.lesson_discussion(uuid),
  public.post_discussion(uuid, text, uuid),
  public.report_discussion_post(uuid),
  public.moderate_discussion_post(uuid, text),
  public.reported_discussion_posts(),
  public.message_counts()
  to authenticated;

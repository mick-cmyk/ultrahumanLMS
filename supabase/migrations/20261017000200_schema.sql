-- v2 schema. One tree of units replaces groups / orgs / stores.
--
--   supplier (root)
--     retail brand
--       region (training manager / state rep territory)
--         store
--   Direct staff sit on the root, so skipping layers needs no special case.
--
-- Level labels live in the brand config, not here: `kind` is a free key that
-- the brand file gives a display name to.

-- ---------------------------------------------------------------------------
-- units
-- ---------------------------------------------------------------------------
create table public.units (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.units (id) on delete restrict,
  kind        text not null check (kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  name        text not null check (length(btrim(name)) > 0),
  state       text check (state in ('VIC','NSW','QLD','SA','WA','TAS','NT','ACT')),
  suburb      text,
  logo_url    text,
  brand_color text check (brand_color is null or brand_color ~* '^#[0-9a-f]{3,8}$'),
  -- Ancestor chain from the root down to and including this unit. Maintained
  -- by trigger. "B is inside A" is `A = any(B.path)`.
  path        uuid[] not null default '{}',
  active      boolean not null default true,
  demo_tag    text,
  created_at  timestamptz not null default now()
);

-- Exactly one root per deployment.
create unique index units_single_root on public.units ((parent_id is null))
  where parent_id is null;
create index units_parent_id_idx on public.units (parent_id);
create index units_path_idx on public.units using gin (path);

create function public.units_set_path()
returns trigger language plpgsql set search_path = public as
$$
declare v_parent_path uuid[];
begin
  if new.parent_id is null then
    new.path := array[new.id];
  else
    select path into v_parent_path from public.units where id = new.parent_id;
    if v_parent_path is null then
      raise exception 'parent unit not found';
    end if;
    if new.id = any (v_parent_path) then
      raise exception 'a unit cannot be moved underneath itself';
    end if;
    new.path := v_parent_path || new.id;
  end if;
  return new;
end;
$$;

create trigger units_set_path
  before insert or update of parent_id on public.units
  for each row execute function public.units_set_path();

-- When a unit moves, everything beneath it moves with it.
create function public.units_rewrite_descendants()
returns trigger language plpgsql set search_path = public as
$$
begin
  if new.parent_id is distinct from old.parent_id then
    update public.units u
       set path = new.path || u.path[(array_position(u.path, new.id) + 1):]
     where u.id <> new.id and new.id = any (u.path);
  end if;
  return null;
end;
$$;

create trigger units_rewrite_descendants
  after update of parent_id on public.units
  for each row execute function public.units_rewrite_descendants();

-- ---------------------------------------------------------------------------
-- users (mirrors auth.users) and scopes
-- ---------------------------------------------------------------------------
-- role:
--   learner  own training only
--   viewer   read reports for the subtree under each scope unit
--   manager  viewer + add / deactivate staff beneath them
--   admin    everything, including content and assignments
--
-- Demo rows are marked by demo_tag, and every demo email ends in .invalid
-- (which can never receive mail). The check keeps the two in step both ways.
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  unit_id    uuid references public.units (id) on delete restrict,
  role       text not null default 'learner'
             check (role in ('learner', 'viewer', 'manager', 'admin')),
  active     boolean not null default true,
  demo_tag   text,
  created_at timestamptz not null default now(),
  constraint users_demo_email_consistent
    check ((demo_tag is not null) = (email ~* '\.invalid$'))
);
create index users_unit_id_idx on public.users (unit_id);

-- What a viewer or manager can see and manage: the union of the subtrees
-- under each listed unit. Learners and admins have no rows here (admins see
-- the whole tree by role).
create table public.user_scopes (
  user_id uuid not null references public.users (id) on delete cascade,
  unit_id uuid not null references public.units (id) on delete cascade,
  primary key (user_id, unit_id)
);
create index user_scopes_unit_id_idx on public.user_scopes (unit_id);

create function public.user_scopes_check_role()
returns trigger language plpgsql set search_path = public as
$$
begin
  if not exists (select 1 from public.users u
                 where u.id = new.user_id and u.role in ('viewer', 'manager')) then
    raise exception 'scopes can only be given to viewers and managers';
  end if;
  return new;
end;
$$;

create trigger user_scopes_check_role
  before insert on public.user_scopes
  for each row execute function public.user_scopes_check_role();

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------
create table public.courses (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  thumbnail_url text,
  published     boolean not null default false,
  demo_tag      text,
  created_at    timestamptz not null default now()
);

create table public.modules (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  title      text not null,
  sort_order integer not null default 0
);

create table public.lessons (
  id               uuid primary key default gen_random_uuid(),
  module_id        uuid not null references public.modules (id) on delete cascade,
  title            text not null,
  sort_order       integer not null default 0,
  bunny_video_id   text,
  duration_seconds integer,
  watch_threshold  numeric not null default 0.90
                   check (watch_threshold > 0 and watch_threshold <= 1),
  script           text,
  sample_video_url text,
  image_url        text
);

-- One quiz per lesson. questions: [{ id, text, options: [..], correct_index, explanation }]
create table public.quizzes (
  id        uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons (id) on delete cascade,
  pass_mark numeric not null default 0.80 check (pass_mark > 0 and pass_mark <= 1),
  questions jsonb not null default '[]'::jsonb
);

-- Living rules, not snapshots. rule shape:
--   { "all": false, "unit_ids": [], "states": [],
--     "include_user_ids": [], "exclude_user_ids": [] }
create table public.assignments (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  label      text,
  rule       jsonb not null default '{}'::jsonb check (jsonb_typeof(rule) = 'object'),
  due_days   integer,
  created_by uuid references public.users (id),
  demo_tag   text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Progress and retention
-- ---------------------------------------------------------------------------
create table public.lesson_progress (
  user_id        uuid not null references public.users (id) on delete cascade,
  lesson_id      uuid not null references public.lessons (id) on delete cascade,
  watch_pct      double precision not null default 0 check (watch_pct >= 0 and watch_pct <= 1),
  watched_at     timestamptz,
  quiz_score     double precision,
  quiz_attempts  integer not null default 0,
  quiz_passed_at timestamptz,
  primary key (user_id, lesson_id)
);

create table public.retests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  module_id        uuid not null references public.modules (id) on delete cascade,
  due_at           timestamptz not null,
  attempts         integer not null default 0,
  last_score       double precision,
  status           text not null default 'pending'
                   check (status in ('pending', 'sent', 'passed', 'requeued')),
  passed_at        timestamptz,
  sent_at          timestamptz,
  reminder_sent_at timestamptz,
  unique (user_id, module_id)
);

-- Email deep links. A token only starts a session; it is not how a re-test is
-- graded any more (the learner is logged in by then).
create table public.retest_tokens (
  token      text primary key,
  retest_id  uuid not null references public.retests (id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index modules_course_id_idx on public.modules (course_id);
create index lessons_module_id_idx on public.lessons (module_id);
create index assignments_course_id_idx on public.assignments (course_id);
create index lesson_progress_lesson_id_idx on public.lesson_progress (lesson_id);
create index retests_user_id_idx on public.retests (user_id);
create index retests_status_due_at_idx on public.retests (status, due_at);
create index retest_tokens_retest_id_idx on public.retest_tokens (retest_id);

-- ---------------------------------------------------------------------------
-- Demo data can never exist in a production deployment.
-- ---------------------------------------------------------------------------
create function public.forbid_demo_in_production()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if new.demo_tag is not null and public.app_environment() = 'production' then
    raise exception 'demo data is not allowed when environment = production';
  end if;
  return new;
end;
$$;

create trigger forbid_demo_units before insert or update of demo_tag on public.units
  for each row execute function public.forbid_demo_in_production();
create trigger forbid_demo_users before insert or update of demo_tag on public.users
  for each row execute function public.forbid_demo_in_production();
create trigger forbid_demo_courses before insert or update of demo_tag on public.courses
  for each row execute function public.forbid_demo_in_production();
create trigger forbid_demo_assignments before insert or update of demo_tag on public.assignments
  for each row execute function public.forbid_demo_in_production();

alter table public.units enable row level security;
alter table public.users enable row level security;
alter table public.user_scopes enable row level security;
alter table public.courses enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.quizzes enable row level security;
alter table public.assignments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.retests enable row level security;
alter table public.retest_tokens enable row level security;

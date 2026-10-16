-- P1xel Forge LMS — full schema (Phase 1 + Phase 2 tables).
-- Spec: lms-build-spec.md. Schema is built once, up front; Phase 2 tables
-- (quizzes, retests, retest_tokens) are created now but not used until Phase 2.

-- ---------------------------------------------------------------------------
-- Core hierarchy
-- ---------------------------------------------------------------------------

create table public.groups (
  id   uuid primary key default gen_random_uuid(),
  name text not null
);

create table public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null check (type in ('retailer', 'client')),
  group_id   uuid references public.groups (id),
  created_at timestamptz not null default now()
);

create table public.stores (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name   text not null,
  state  text not null check (state in ('VIC','NSW','QLD','SA','WA','TAS','NT','ACT')),
  suburb text
);

-- Mirrors auth.users via trigger (see auth_user_mirror migration).
-- Soft delete via active flag; never hard-delete, history matters.
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  org_id     uuid references public.orgs (id),
  store_id   uuid references public.stores (id),
  group_id   uuid references public.groups (id),
  role       text not null default 'learner'
             check (role in ('learner', 'manager', 'coordinator', 'admin')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------

create table public.courses (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  thumbnail_url text,
  published     boolean not null default false,
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
                   check (watch_threshold > 0 and watch_threshold <= 1)
);

-- One quiz per lesson; nullable relationship — some lessons are watch-only.
-- questions jsonb shape: [{ id, text, options: [..], correct_index, explanation }]
create table public.quizzes (
  id        uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons (id) on delete cascade,
  pass_mark numeric not null default 0.80 check (pass_mark > 0 and pass_mark <= 1),
  questions jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Assignment rules — living rules, not user snapshots
-- ---------------------------------------------------------------------------

-- rule jsonb shape:
-- {
--   "all": false,
--   "org_ids": [],           -- step 4: user's org must be in here
--   "states": [],            -- empty = no filter at that level
--   "store_ids": [],         -- empty = no filter at that level
--   "include_user_ids": [],  -- cherry-picks, bypass all filters
--   "exclude_user_ids": []   -- always wins over everything
-- }
create table public.assignments (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  label      text,
  rule       jsonb not null default '{}'::jsonb,
  due_days   integer,
  created_by uuid references public.users (id),
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

-- One row per user per module, created when all module quizzes are passed.
create table public.retests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  module_id  uuid not null references public.modules (id) on delete cascade,
  due_at     timestamptz not null,
  attempts   integer not null default 0,
  last_score double precision,
  status     text not null default 'pending'
             check (status in ('pending', 'sent', 'passed', 'requeued')),
  passed_at  timestamptz,
  unique (user_id, module_id)
);

-- Single-use magic tokens for re-test email deep links.
create table public.retest_tokens (
  token      text primary key,
  retest_id  uuid not null references public.retests (id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index orgs_group_id_idx on public.orgs (group_id);
create index stores_org_id_idx on public.stores (org_id);
create index users_org_id_idx on public.users (org_id);
create index users_store_id_idx on public.users (store_id);
create index users_group_id_idx on public.users (group_id);
create index modules_course_id_idx on public.modules (course_id);
create index lessons_module_id_idx on public.lessons (module_id);
create index assignments_course_id_idx on public.assignments (course_id);
create index lesson_progress_lesson_id_idx on public.lesson_progress (lesson_id);
create index retests_user_id_idx on public.retests (user_id);
create index retests_status_due_at_idx on public.retests (status, due_at);
create index retest_tokens_retest_id_idx on public.retest_tokens (retest_id);

-- ---------------------------------------------------------------------------
-- RLS on from the first migration. Policies land in a later Phase 1 step;
-- until then only the service role can touch these tables.
-- ---------------------------------------------------------------------------

alter table public.groups enable row level security;
alter table public.orgs enable row level security;
alter table public.stores enable row level security;
alter table public.users enable row level security;
alter table public.courses enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.quizzes enable row level security;
alter table public.assignments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.retests enable row level security;
alter table public.retest_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- Grants. Current Supabase images are secure-by-default: API roles get no DML
-- on new tables unless granted explicitly. service_role gets full access
-- (bypasses RLS); authenticated gets DML gated by the RLS policies to come.
-- anon gets nothing — magic-link auth happens via auth endpoints, and no
-- table here should ever be readable logged-out.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;

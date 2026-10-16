-- RLS policies for every table.
--
-- Scopes (spec):
--   learner      — own profile, matched published courses, own progress
--   manager      — everything a learner has, plus read within their store
--                  (or whole org when store_id is null)
--   coordinator  — read-only across every org in their group
--   admin        — everything
--
-- Pattern: helper functions are SECURITY DEFINER so policies can consult
-- public.users without recursing into its own RLS. Child-table policies lean
-- on parent-table RLS via EXISTS — if you can see the course you can see its
-- modules, if you can see a user you can see their progress.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- All return NULL for anonymous, unknown, or deactivated users, so every
-- policy below fails closed for them.
create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as
  $$ select role from public.users where id = auth.uid() and active $$;

create or replace function public.app_org_id()
returns uuid language sql stable security definer set search_path = public as
  $$ select org_id from public.users where id = auth.uid() and active $$;

create or replace function public.app_store_id()
returns uuid language sql stable security definer set search_path = public as
  $$ select store_id from public.users where id = auth.uid() and active $$;

create or replace function public.app_group_id()
returns uuid language sql stable security definer set search_path = public as
  $$ select group_id from public.users where id = auth.uid() and active $$;

-- Course visibility for the current user: any assignment rule matches.
-- SECURITY DEFINER because learners have no direct read on assignments.
create or replace function public.user_sees_course(p_course_id uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.active)
     and exists (
       select 1 from public.assignments a
       where a.course_id = p_course_id
         and public.user_matches_rule(auth.uid(), a.rule)
     )
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create policy users_select_own on public.users
  for select using (id = auth.uid());

create policy users_select_admin on public.users
  for select using (public.app_role() = 'admin');

create policy users_select_manager_scope on public.users
  for select using (
    public.app_role() = 'manager'
    and org_id = public.app_org_id()
    and (public.app_store_id() is null or store_id = public.app_store_id())
  );

create policy users_select_coordinator_scope on public.users
  for select using (
    public.app_role() = 'coordinator'
    and org_id in (select o.id from public.orgs o where o.group_id = public.app_group_id())
  );

-- Writes are admin-only in Phase 1. Manager self-serve staff management is
-- Phase 3 and goes through service-role route handlers anyway (auth user
-- creation needs the admin API). No delete policy — soft deletes only.
create policy users_insert_admin on public.users
  for insert with check (public.app_role() = 'admin');

create policy users_update_admin on public.users
  for update using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- groups / orgs / stores
-- ---------------------------------------------------------------------------

create policy groups_select on public.groups
  for select using (
    public.app_role() = 'admin' or id = public.app_group_id()
  );

create policy groups_write_admin on public.groups
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

create policy orgs_select on public.orgs
  for select using (
    public.app_role() = 'admin'
    or id = public.app_org_id()
    or (public.app_role() = 'coordinator'
        and group_id is not null
        and group_id = public.app_group_id())
  );

create policy orgs_write_admin on public.orgs
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

create policy stores_select on public.stores
  for select using (
    public.app_role() = 'admin'
    or org_id = public.app_org_id()
    or (public.app_role() = 'coordinator'
        and org_id in (select o.id from public.orgs o where o.group_id = public.app_group_id()))
  );

create policy stores_write_admin on public.stores
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- courses / modules / lessons
-- ---------------------------------------------------------------------------

create policy courses_select on public.courses
  for select using (
    public.app_role() = 'admin'
    or (published and public.user_sees_course(id))
  );

create policy courses_write_admin on public.courses
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- Visible parent course => visible module; courses RLS does the work.
create policy modules_select on public.modules
  for select using (
    exists (select 1 from public.courses c where c.id = course_id)
  );

create policy modules_write_admin on public.modules
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

create policy lessons_select on public.lessons
  for select using (
    exists (select 1 from public.modules m where m.id = module_id)
  );

create policy lessons_write_admin on public.lessons
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- quizzes — admin only for now. questions jsonb contains correct_index, so
-- handing rows to the client would leak answers; Phase 2 serves quizzes
-- through a route handler that strips them.
-- ---------------------------------------------------------------------------

create policy quizzes_admin on public.quizzes
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- assignments — admin only. Learner visibility flows through
-- user_sees_course (SECURITY DEFINER), never direct reads.
-- ---------------------------------------------------------------------------

create policy assignments_admin on public.assignments
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- lesson_progress
-- ---------------------------------------------------------------------------

-- If you can see the user (own row / manager scope / coordinator scope /
-- admin), you can see their progress.
create policy lesson_progress_select on public.lesson_progress
  for select using (
    exists (select 1 from public.users u where u.id = user_id)
  );

-- Writes: own rows only. The app writes via record_watch_progress, but the
-- direct path stays correctly scoped for authenticated users.
create policy lesson_progress_insert_own on public.lesson_progress
  for insert with check (user_id = auth.uid());

create policy lesson_progress_update_own on public.lesson_progress
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- retests — read via user visibility (own + manager/coordinator/admin).
-- All writes happen in the Phase 2 cron/route handlers as service role.
-- ---------------------------------------------------------------------------

create policy retests_select on public.retests
  for select using (
    exists (select 1 from public.users u where u.id = user_id)
  );

-- ---------------------------------------------------------------------------
-- retest_tokens — no policies at all. Single-use email tokens are service
-- role territory; no client role should ever read or write them.
-- ---------------------------------------------------------------------------

revoke all on public.retest_tokens from authenticated;

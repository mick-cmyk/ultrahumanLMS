-- Row level security. Policies lean on the scope helpers, which read
-- auth.uid() themselves. There are deliberately NO write policies on
-- lesson_progress, retests or retest_tokens: those tables are written only by
-- the security definer functions in the learning-engine migration (review
-- item M1). The grants migration backs this up by not granting write access.

-- units
create policy units_select on public.units
  for select using (public.app_role() = 'admin' or public.visible_unit(id));
create policy units_write_admin on public.units
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- users: own row; admins everyone; managers and viewers their scope.
create policy users_select_own on public.users
  for select using (id = auth.uid());
create policy users_select_admin on public.users
  for select using (public.app_role() = 'admin');
create policy users_select_scope on public.users
  for select using (
    public.app_role() in ('manager', 'viewer')
    and unit_id is not null
    and public.in_my_scope(unit_id)
  );
create policy users_update_admin on public.users
  for update using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- user_scopes
create policy user_scopes_select on public.user_scopes
  for select using (user_id = auth.uid() or public.app_role() = 'admin');
create policy user_scopes_write_admin on public.user_scopes
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- courses / modules / lessons: visible when the parent course is.
create policy courses_select on public.courses
  for select using (
    public.app_role() = 'admin'
    or (published and public.user_sees_course(id))
  );
create policy courses_write_admin on public.courses
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

create policy modules_select on public.modules
  for select using (exists (select 1 from public.courses c where c.id = course_id));
create policy modules_write_admin on public.modules
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

create policy lessons_select on public.lessons
  for select using (exists (select 1 from public.modules m where m.id = module_id));
create policy lessons_write_admin on public.lessons
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- quizzes hold correct_index, so rows are admin only. Learners get quiz
-- content through get_lesson_quiz, which strips the answers.
create policy quizzes_admin on public.quizzes
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

create policy assignments_admin on public.assignments
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- Progress and re-tests are readable by whoever can read the user. Read only.
create policy lesson_progress_select on public.lesson_progress
  for select using (exists (select 1 from public.users u where u.id = user_id));
create policy retests_select on public.retests
  for select using (exists (select 1 from public.users u where u.id = user_id));

-- retest_tokens, app_settings, job_runs: RLS on, no policies, no grants.

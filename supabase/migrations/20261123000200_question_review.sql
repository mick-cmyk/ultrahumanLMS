-- Question review before staff see anything.
--
-- 1. lessons.reviewed_at / reviewed_by. Anything that changes what staff
--    answer or read before the video (quiz questions, written prompts, the
--    before-video sentence) clears it. An admin ticks it again on the check
--    page once they've read the lesson's questions. Publishing a course is
--    refused while any lesson with questions is unreviewed (the app's check;
--    see lib/course-check.ts).
-- 2. lesson_drafts: on a published course, a change to a lesson's questions
--    waits here instead of going live. Staff keep the current version until
--    an admin reviews the change and swaps it in (apply_lesson_draft), or
--    throws it away.
--
-- Lessons already in a published course when this runs count as reviewed:
-- they're live and staff have been answering them.

alter table public.lessons
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.users (id) on delete set null;

update public.lessons l
   set reviewed_at = now()
 where exists (
   select 1 from public.modules m
   join public.courses c on c.id = m.course_id
   where m.id = l.module_id and c.published
 );

-- ---------------------------------------------------------------------------
-- Shape check for written prompts, used by lesson_drafts (the written_prompts
-- table checks each row itself). Mirrors writtenPromptsProblem in the app.
-- ---------------------------------------------------------------------------
create function public.written_prompts_problem(p_prompts jsonb)
returns text language plpgsql immutable set search_path = public as
$$
declare
  p jsonb;
  n int := 0;
  v_ids text[] := '{}';
begin
  if p_prompts is null or jsonb_typeof(p_prompts) <> 'array' then
    return 'written prompts must be a list';
  end if;
  if jsonb_array_length(p_prompts) > 5 then
    return 'keep it to 5 written prompts or fewer';
  end if;
  for p in select * from jsonb_array_elements(p_prompts) loop
    n := n + 1;
    if jsonb_typeof(p) is distinct from 'object' then
      return format('written prompt %s is not an object', n);
    end if;
    if jsonb_typeof(p -> 'id') is distinct from 'string' or length(trim(p ->> 'id')) = 0 or length(p ->> 'id') > 100 then
      return format('written prompt %s has no id', n);
    end if;
    if (p ->> 'id') = any (v_ids) then
      return format('written prompt %s repeats the id %s', n, p ->> 'id');
    end if;
    v_ids := v_ids || (p ->> 'id');
    if jsonb_typeof(p -> 'prompt') is distinct from 'string' or length(trim(p ->> 'prompt')) = 0 or length(p ->> 'prompt') > 1000 then
      return format('written prompt %s needs a prompt under 1000 characters', n);
    end if;
    if p ? 'model_answer' and jsonb_typeof(p -> 'model_answer') not in ('string', 'null') then
      return format('written prompt %s has a model answer that is not text', n);
    end if;
    if length(coalesce(p ->> 'model_answer', '')) > 2000 then
      return format('written prompt %s has a model answer over 2000 characters', n);
    end if;
    if p ? 'max_words' and jsonb_typeof(p -> 'max_words') not in ('number', 'null') then
      return format('written prompt %s has a word limit that is not a number', n);
    end if;
    if jsonb_typeof(p -> 'max_words') = 'number'
       and ((p ->> 'max_words')::numeric <> trunc((p ->> 'max_words')::numeric)
            or (p ->> 'max_words')::numeric not between 5 and 300) then
      return format('written prompt %s has a word limit outside 5 to 300', n);
    end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pending changes on published courses
-- ---------------------------------------------------------------------------
create table public.lesson_drafts (
  lesson_id       uuid primary key references public.lessons (id) on delete cascade,
  pass_mark       numeric not null default 0.80 check (pass_mark > 0 and pass_mark <= 1),
  questions       jsonb not null default '[]'::jsonb,
  written_prompts jsonb not null default '[]'::jsonb,
  expectancy      text check (expectancy is null or length(expectancy) <= 1000),
  note            text check (note is null or length(note) <= 500),
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create function public.lesson_drafts_check()
returns trigger language plpgsql security definer set search_path = public as
$$
declare
  v_problem text := coalesce(public.quiz_questions_problem(new.questions),
                             public.written_prompts_problem(new.written_prompts));
begin
  if v_problem is not null then
    raise exception 'invalid quiz: %', v_problem using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger lesson_drafts_check
  before insert or update on public.lesson_drafts
  for each row execute function public.lesson_drafts_check();

alter table public.lesson_drafts enable row level security;
create policy lesson_drafts_admin on public.lesson_drafts
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Any change to what staff answer clears the review. Inserts and updates
-- only: removing questions leaves less to review, not more, and skipping
-- deletes keeps lesson deletes (which cascade here) out of it.
-- ---------------------------------------------------------------------------
create function public.lessons_clear_review()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  update public.lessons
     set reviewed_at = null, reviewed_by = null
   where id = new.lesson_id and reviewed_at is not null;
  return null;
end;
$$;

create trigger quizzes_clear_review
  after insert or update of questions, pass_mark on public.quizzes
  for each row execute function public.lessons_clear_review();
create trigger written_prompts_clear_review
  after insert or update on public.written_prompts
  for each row execute function public.lessons_clear_review();

create function public.lessons_expectancy_clears_review()
returns trigger language plpgsql set search_path = public as
$$
begin
  if new.expectancy is distinct from old.expectancy then
    new.reviewed_at := null;
    new.reviewed_by := null;
  end if;
  return new;
end;
$$;

create trigger lessons_expectancy_clears_review
  before update of expectancy on public.lessons
  for each row execute function public.lessons_expectancy_clears_review();

-- ---------------------------------------------------------------------------
-- mark_lesson_reviewed: an admin says they've read this lesson's questions.
-- ---------------------------------------------------------------------------
create function public.mark_lesson_reviewed(p_lesson_id uuid, p_reviewed boolean default true)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_at timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if public.app_role() is distinct from 'admin' then
    raise exception 'admins only';
  end if;
  update public.lessons
     set reviewed_at = case when p_reviewed then now() end,
         reviewed_by = case when p_reviewed then v_user end
   where id = p_lesson_id
  returning reviewed_at into v_at;
  if not found then
    raise exception 'no such lesson';
  end if;
  return jsonb_build_object('lesson_id', p_lesson_id, 'reviewed_at', v_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_lesson_draft: swap a reviewed pending change in, in one transaction.
-- The applying admin is the reviewer.
-- ---------------------------------------------------------------------------
create function public.apply_lesson_draft(p_lesson_id uuid)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  d public.lesson_drafts;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if public.app_role() is distinct from 'admin' then
    raise exception 'admins only';
  end if;
  select * into d from public.lesson_drafts where lesson_id = p_lesson_id for update;
  if not found then
    raise exception 'no change waiting on this lesson';
  end if;

  if jsonb_array_length(d.questions) = 0 then
    delete from public.quizzes where lesson_id = p_lesson_id;
  else
    insert into public.quizzes (lesson_id, pass_mark, questions)
    values (p_lesson_id, d.pass_mark, d.questions)
    on conflict (lesson_id) do update
      set pass_mark = excluded.pass_mark, questions = excluded.questions;
  end if;

  delete from public.written_prompts wp
   where wp.lesson_id = p_lesson_id
     and not exists (select 1 from jsonb_array_elements(d.written_prompts) x where x ->> 'id' = wp.id);
  insert into public.written_prompts (lesson_id, id, sort_order, prompt, model_answer, max_words)
  select p_lesson_id, x ->> 'id', ord::int, trim(x ->> 'prompt'),
         nullif(trim(coalesce(x ->> 'model_answer', '')), ''),
         (x ->> 'max_words')::int
    from jsonb_array_elements(d.written_prompts) with ordinality as t(x, ord)
  on conflict (lesson_id, id) do update
    set sort_order = excluded.sort_order, prompt = excluded.prompt,
        model_answer = excluded.model_answer, max_words = excluded.max_words;

  update public.lessons set expectancy = d.expectancy where id = p_lesson_id;
  delete from public.lesson_drafts where lesson_id = p_lesson_id;

  update public.lessons set reviewed_at = now(), reviewed_by = v_user where id = p_lesson_id;
  return jsonb_build_object('lesson_id', p_lesson_id, 'applied', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (allowlist, as in 20261017001000_lockdown.sql)
-- ---------------------------------------------------------------------------
revoke all on public.lesson_drafts from anon, authenticated;
grant all on public.lesson_drafts to service_role;
grant select, insert, update, delete on public.lesson_drafts to authenticated;
-- lessons: the app sets reviewed_at only through mark_lesson_reviewed and
-- apply_lesson_draft. Only admins can update lessons at all (RLS), and admins
-- are the reviewers, so there's nothing to gain by writing it directly.

revoke execute on function
  public.written_prompts_problem(jsonb),
  public.lesson_drafts_check(),
  public.lessons_clear_review(),
  public.lessons_expectancy_clears_review(),
  public.mark_lesson_reviewed(uuid, boolean),
  public.apply_lesson_draft(uuid)
  from public, anon, authenticated;
grant execute on function
  public.written_prompts_problem(jsonb),
  public.mark_lesson_reviewed(uuid, boolean),
  public.apply_lesson_draft(uuid)
  to service_role;
grant execute on function
  public.mark_lesson_reviewed(uuid, boolean),
  public.apply_lesson_draft(uuid)
  to authenticated;

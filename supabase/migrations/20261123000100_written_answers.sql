-- Written answers and the question maker import.
--
-- 1. lessons.expectancy: one sentence shown ABOVE the video, telling staff
--    what they'll have to explain afterwards. Told first, it changes how they
--    watch (g = 0.48). Told after, it's worth nothing measurable. Learners
--    read it directly, like the rest of the lesson row.
-- 2. written_prompts: "explain it in your own words" prompts on a lesson. Not
--    marked. The model answer is admin-only in the table and only reaches a
--    learner through submit_written_answer, after they've committed their own.
-- 3. written_answers: what each learner wrote. One answer per prompt, and it
--    can't be changed once the model answer has been shown.
--
-- Prompt ids come from the question maker and stay the same across re-imports,
-- so re-importing a lesson updates prompts in place and keeps learners'
-- answers. Answers don't cascade from prompts for the same reason: removing a
-- prompt from a lesson shouldn't erase what people already wrote.

alter table public.lessons
  add column expectancy text
  check (expectancy is null or length(expectancy) <= 1000);

create table public.written_prompts (
  lesson_id    uuid not null references public.lessons (id) on delete cascade,
  id           text not null check (length(trim(id)) > 0 and length(id) <= 100),
  sort_order   integer not null default 0,
  prompt       text not null check (length(trim(prompt)) > 0 and length(prompt) <= 1000),
  model_answer text check (model_answer is null or length(model_answer) <= 2000),
  max_words    integer check (max_words is null or max_words between 5 and 300),
  primary key (lesson_id, id)
);

create table public.written_answers (
  user_id     uuid not null references public.users (id) on delete cascade,
  lesson_id   uuid not null references public.lessons (id) on delete cascade,
  prompt_id   text not null,
  answer      text not null check (length(trim(answer)) > 0 and length(answer) <= 4000),
  answered_at timestamptz not null default now(),
  primary key (user_id, lesson_id, prompt_id)
);

create index written_answers_lesson_id_idx on public.written_answers (lesson_id);

alter table public.written_prompts enable row level security;
alter table public.written_answers enable row level security;

-- Prompts hold the model answer, so rows are admin only (like quizzes).
create policy written_prompts_admin on public.written_prompts
  for all using (public.app_role() = 'admin')
  with check (public.app_role() = 'admin');

-- Answers are readable by whoever can read the user (same as lesson_progress).
-- Written only through submit_written_answer.
create policy written_answers_select on public.written_answers
  for select using (exists (select 1 from public.users u where u.id = user_id));

-- ---------------------------------------------------------------------------
-- Can this learner use this lesson's prompts? Same gate as get_lesson_quiz:
-- the course is published and assigned to them, and they've watched the video.
-- ---------------------------------------------------------------------------
create function public._written_prompts_open(p_lesson_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as
$$
  select exists (
    select 1
    from public.lessons l
    join public.modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = p_user
    where l.id = p_lesson_id
      and c.published
      and public.user_sees_course(c.id)
      and lp.watched_at is not null
  );
$$;

-- get_written_prompts: the prompts as the learner may see them. A prompt's
-- model answer is included only once that learner has answered it.
create function public.get_written_prompts(p_lesson_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not public._written_prompts_open(p_lesson_id, v_user) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'prompt', p.prompt,
             'max_words', p.max_words,
             'answer', a.answer,
             'model_answer', case when a.answer is not null then p.model_answer end)
           order by p.sort_order, p.id)
    from public.written_prompts p
    left join public.written_answers a
      on a.user_id = v_user and a.lesson_id = p.lesson_id and a.prompt_id = p.id
    where p.lesson_id = p_lesson_id
  ), '[]'::jsonb);
end;
$$;

-- submit_written_answer: save the learner's answer once, then hand back the
-- model answer. A second submit returns the first answer unchanged.
create function public.submit_written_answer(p_lesson_id uuid, p_prompt_id text, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_prompt public.written_prompts;
  v_answer text := trim(coalesce(p_answer, ''));
  v_saved text;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not public._written_prompts_open(p_lesson_id, v_user) then
    raise exception 'not available: watch the lesson first';
  end if;
  select * into v_prompt from public.written_prompts
   where lesson_id = p_lesson_id and id = p_prompt_id;
  if not found then
    raise exception 'no such prompt';
  end if;
  if length(v_answer) = 0 then
    raise exception 'write something first';
  end if;
  if length(v_answer) > 4000 then
    raise exception 'keep it shorter';
  end if;

  insert into public.written_answers (user_id, lesson_id, prompt_id, answer)
  values (v_user, p_lesson_id, p_prompt_id, v_answer)
  on conflict (user_id, lesson_id, prompt_id) do nothing;

  select answer into v_saved from public.written_answers
   where user_id = v_user and lesson_id = p_lesson_id and prompt_id = p_prompt_id;

  return jsonb_build_object('id', p_prompt_id, 'answer', v_saved, 'model_answer', v_prompt.model_answer);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (allowlist, as in 20261017001000_lockdown.sql)
-- ---------------------------------------------------------------------------
revoke all on public.written_prompts, public.written_answers from anon, authenticated;
grant all on public.written_prompts, public.written_answers to service_role;

-- Admin import writes prompts through their own session, gated by RLS.
grant select, insert, update, delete on public.written_prompts to authenticated;
-- Learners and managers read answers through RLS; nobody writes them directly.
grant select on public.written_answers to authenticated;
-- lessons already allows admin insert/update; the new column rides on that.

revoke execute on function
  public._written_prompts_open(uuid, uuid),
  public.get_written_prompts(uuid),
  public.submit_written_answer(uuid, text, text)
  from public, anon, authenticated;
grant execute on function
  public._written_prompts_open(uuid, uuid),
  public.get_written_prompts(uuid),
  public.submit_written_answer(uuid, text, text)
  to service_role;
grant execute on function
  public.get_written_prompts(uuid),
  public.submit_written_answer(uuid, text, text)
  to authenticated;

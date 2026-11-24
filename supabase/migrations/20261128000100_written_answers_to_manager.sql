-- "Explain it in your own words" answers can go to the person's manager.
--
-- An admin ticks "Send answers to their manager" on a written prompt (Check
-- page). When someone answers that prompt, their answer is sent as a
-- conversation in Messages (question, then answer, linked to the lesson) to the
-- nearest manager above them, exactly like "Ask your manager about this lesson":
-- _nearest_managers, or the admins when nobody manages that branch. The usual
-- "new message" email follows (8am to 8pm Sydney). The manager can reply in the
-- conversation, and it stays visible to every manager above the person.
--
-- Ticking or unticking changes who sees answers, not the questions, so it does
-- not send the lesson back for review.

alter table public.written_prompts
  add column send_to_manager boolean not null default false;

-- Review is cleared by changes to the wording only, not the send setting.
drop trigger written_prompts_clear_review on public.written_prompts;
create trigger written_prompts_clear_review
  after insert or update of prompt, model_answer, max_words, sort_order on public.written_prompts
  for each row execute function public.lessons_clear_review();

-- Admins switch the setting through this, one prompt at a time.
create function public.set_written_prompt_send(p_lesson_id uuid, p_prompt_id text, p_on boolean)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if public.app_role() is distinct from 'admin' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.written_prompts set send_to_manager = coalesce(p_on, false)
   where lesson_id = p_lesson_id and id = p_prompt_id;
  if not found then
    raise exception 'no such prompt' using errcode = '22023';
  end if;
end;
$$;

-- Send one answer to the person's nearest manager as a new conversation.
create function public._send_written_answer(p_user uuid, p_lesson_id uuid, p_prompt text, p_answer text)
returns uuid language plpgsql security definer set search_path = public as
$$
declare
  subj public.users;
  v_lesson text;
  v_id uuid;
  v_body text;
begin
  select * into subj from public.users where id = p_user and active;
  if subj.id is null then
    return null;
  end if;
  select title into v_lesson from public.lessons where id = p_lesson_id;
  v_body := left(format(E'Question: %s\n\nMy answer:\n%s', btrim(p_prompt), btrim(p_answer)), 4000);

  insert into public.threads (subject_user_id, unit_id, lesson_id, title, created_by, last_message_by)
  values (subj.id, subj.unit_id, p_lesson_id, left('My answer: ' || coalesce(v_lesson, 'lesson'), 120), subj.id, subj.id)
  returning id into v_id;
  insert into public.thread_messages (thread_id, author_id, body) values (v_id, subj.id, v_body);
  insert into public.thread_reads (thread_id, user_id) values (v_id, subj.id);

  if subj.unit_id is not null then
    perform public._queue_message_email('thread', v_id, x) from public._nearest_managers(subj.unit_id, subj.id) x;
  else
    perform public._queue_message_email('thread', v_id, u.id)
       from public.users u where u.active and u.role = 'admin' and u.id <> subj.id;
  end if;
  return v_id;
end;
$$;

-- Staff see whether their answer goes to their manager.
create or replace function public.get_written_prompts(p_lesson_id uuid)
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
             'send_to_manager', p.send_to_manager,
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

-- Save the answer once; the first time, send it on if the prompt says so.
create or replace function public.submit_written_answer(p_lesson_id uuid, p_prompt_id text, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  v_prompt public.written_prompts;
  v_answer text := trim(coalesce(p_answer, ''));
  v_saved text;
  v_new int;
  v_sent boolean := false;
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
  get diagnostics v_new = row_count;

  if v_new = 1 and v_prompt.send_to_manager then
    v_sent := public._send_written_answer(v_user, p_lesson_id, v_prompt.prompt, v_answer) is not null;
  end if;

  select answer into v_saved from public.written_answers
   where user_id = v_user and lesson_id = p_lesson_id and prompt_id = p_prompt_id;

  return jsonb_build_object('id', p_prompt_id, 'answer', v_saved, 'model_answer', v_prompt.model_answer,
                            'sent_to_manager', v_sent);
end;
$$;

revoke execute on function
  public.set_written_prompt_send(uuid, text, boolean),
  public._send_written_answer(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function
  public.set_written_prompt_send(uuid, text, boolean),
  public._send_written_answer(uuid, uuid, text, text)
  to service_role;
grant execute on function public.set_written_prompt_send(uuid, text, boolean) to authenticated;
-- get_written_prompts and submit_written_answer keep their grants (create or replace).

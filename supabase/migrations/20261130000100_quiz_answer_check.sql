-- One question at a time: the quiz after a video now tells staff straight
-- away whether each answer is right, with the question maker's explanation,
-- before they move to the next question.
--
-- check_quiz_answer marks one answer. It records nothing: the attempt is still
-- scored and saved by record_quiz_attempt once every question is answered.
-- Same gate as get_lesson_quiz (published, assigned, video watched), so it
-- reveals no more than the old whole-quiz marking did (that showed every
-- answer and explanation after a submit, with unlimited retries).
-- The quick check a few days later is unchanged and never shows answers.

create function public.check_quiz_answer(p_lesson_id uuid, p_question_id text, p_chosen integer)
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  v_user uuid := auth.uid();
  q jsonb;
  v_correct_index int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user and u.active) then
    raise exception 'user is not active';
  end if;

  select question into q
  from public.lessons l
  join public.modules m on m.id = l.module_id
  join public.courses c on c.id = m.course_id
  join public.quizzes qz on qz.lesson_id = l.id
  join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = v_user
  cross join lateral jsonb_array_elements(qz.questions) as qs(question)
  where l.id = p_lesson_id
    and c.published
    and public.user_sees_course(c.id)
    and lp.watched_at is not null
    and question ->> 'id' = p_question_id;

  if q is null then
    raise exception 'quiz not available: watch the lesson first';
  end if;
  if p_chosen is null or p_chosen < 0 or p_chosen >= jsonb_array_length(q -> 'options') then
    raise exception 'pick one of the answers';
  end if;

  v_correct_index := (q ->> 'correct_index')::int;
  return jsonb_build_object(
    'id', q ->> 'id',
    'chosen', p_chosen,
    'correct', p_chosen = v_correct_index,
    'correct_index', v_correct_index,
    'explanation', q ->> 'explanation');
end;
$$;

revoke all on function public.check_quiz_answer(uuid, text, integer) from public, anon;
grant execute on function public.check_quiz_answer(uuid, text, integer) to authenticated;

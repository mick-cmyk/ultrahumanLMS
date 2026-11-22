-- Course builder: admins create video courses in the app instead of seed
-- scripts. Writes go through the admin's own session; the existing RLS
-- policies (courses/modules/lessons/quizzes_write_admin) and the table grants
-- in the lockdown migration already limit them to admins.
--
-- This migration adds:
--   1. modules.intro: a short plain-text intro shown above a module's lessons.
--   2. A shape check on quizzes.questions, so a bad upload can never reach the
--      grading functions (record_quiz_attempt, build_my_retest, grade_my_retest
--      all read id, text, options and correct_index).

alter table public.modules
  add column intro text;

-- questions: [{ id, text, options: [2..6 strings], correct_index, explanation? }]
create function public.quiz_questions_problem(p_questions jsonb)
returns text language plpgsql immutable set search_path = public as
$$
declare
  q jsonb;
  n int := 0;
  v_opts int;
  v_idx int;
  v_ids text[] := '{}';
begin
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    return 'questions must be a list';
  end if;
  for q in select * from jsonb_array_elements(p_questions) loop
    n := n + 1;
    if jsonb_typeof(q) is distinct from 'object' then
      return format('question %s is not an object', n);
    end if;
    if jsonb_typeof(q -> 'id') is distinct from 'string' or length(trim(q ->> 'id')) = 0 then
      return format('question %s has no id', n);
    end if;
    if (q ->> 'id') = any (v_ids) then
      return format('question %s repeats the id %s', n, q ->> 'id');
    end if;
    v_ids := v_ids || (q ->> 'id');
    if jsonb_typeof(q -> 'text') is distinct from 'string' or length(trim(q ->> 'text')) = 0 then
      return format('question %s has no text', n);
    end if;
    if jsonb_typeof(q -> 'options') is distinct from 'array' then
      return format('question %s has no answers', n);
    end if;
    v_opts := jsonb_array_length(q -> 'options');
    if v_opts < 2 or v_opts > 6 then
      return format('question %s needs 2 to 6 answers', n);
    end if;
    if exists (select 1 from jsonb_array_elements(q -> 'options') o
               where jsonb_typeof(o) is distinct from 'string' or length(trim(o #>> '{}')) = 0) then
      return format('question %s has a blank answer', n);
    end if;
    if jsonb_typeof(q -> 'correct_index') is distinct from 'number' then
      return format('question %s has no correct answer', n);
    end if;
    v_idx := (q ->> 'correct_index')::numeric::int;
    if (q ->> 'correct_index')::numeric <> v_idx or v_idx < 0 or v_idx >= v_opts then
      return format('question %s points at an answer that does not exist', n);
    end if;
    if q ? 'explanation' and jsonb_typeof(q -> 'explanation') not in ('string', 'null') then
      return format('question %s has an explanation that is not text', n);
    end if;
  end loop;
  return null;
end;
$$;

-- Security definer so the nested call works for an admin, who (like every
-- caller) has no execute grant on the checker itself.
create function public.quizzes_check_questions()
returns trigger language plpgsql security definer set search_path = public as
$$
declare
  v_problem text := public.quiz_questions_problem(new.questions);
begin
  if v_problem is not null then
    raise exception 'invalid quiz: %', v_problem using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger quizzes_check_questions
  before insert or update of questions on public.quizzes
  for each row execute function public.quizzes_check_questions();

-- Both functions are internal: the trigger runs them whoever writes. Nobody
-- calls them directly (the lockdown default already denies; this keeps it so
-- if grants are ever re-run).
revoke execute on function public.quiz_questions_problem(jsonb) from public, anon, authenticated;
revoke execute on function public.quizzes_check_questions() from public, anon, authenticated;
grant execute on function public.quiz_questions_problem(jsonb) to service_role;

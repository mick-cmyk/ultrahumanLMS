-- Two lesson-player changes.
--
-- 1. courses.require_watch (default true). When an admin unticks "Staff must
--    watch each video" on a course, its video lessons' watch_threshold goes to
--    0; ticking it puts them back to 0.90. With a threshold of 0 the lesson
--    page records a 0% watch on opening, record_watch_progress stamps
--    watched_at (0 >= 0), and the quiz, written prompts, completion and
--    re-test rules all carry on unchanged. Kept in step by triggers, so a
--    lesson added later follows its course.
--
-- 2. lessons.video_aspect: the video's width / height, filled from Bunny when
--    the video is set, so the player can be the video's own shape (a portrait
--    clip fills a phone screen instead of sitting in a letterbox).

alter table public.courses add column require_watch boolean not null default true;

-- 0 now means "opening the lesson is enough".
alter table public.lessons drop constraint lessons_watch_threshold_check;
alter table public.lessons add constraint lessons_watch_threshold_check
  check (watch_threshold >= 0 and watch_threshold <= 1);

alter table public.lessons add column video_aspect numeric
  check (video_aspect is null or (video_aspect > 0.2 and video_aspect < 5));

create function public.courses_sync_watch_threshold()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  update public.lessons l
     set watch_threshold = case when new.require_watch then 0.90 else 0 end
    from public.modules m
   where m.id = l.module_id and m.course_id = new.id and l.kind = 'video';
  return new;
end;
$$;

create trigger courses_sync_watch_threshold
  after update of require_watch on public.courses
  for each row when (old.require_watch is distinct from new.require_watch)
  execute function public.courses_sync_watch_threshold();

create function public.lessons_follow_course_watch()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if new.kind = 'video' and exists (
       select 1 from public.modules m join public.courses c on c.id = m.course_id
       where m.id = new.module_id and not c.require_watch) then
    new.watch_threshold := 0;
  end if;
  return new;
end;
$$;

create trigger lessons_follow_course_watch
  before insert on public.lessons
  for each row execute function public.lessons_follow_course_watch();

revoke execute on function public.courses_sync_watch_threshold(), public.lessons_follow_course_watch()
  from public, anon, authenticated;

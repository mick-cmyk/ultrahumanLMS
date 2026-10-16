-- Lesson media + script. Lets a lesson carry its transcript and, until a Bunny
-- video id is set, play a sample clip so the module is demonstrable end to end.
--   script           - the on-screen transcript, shown under the player
--   sample_video_url - a plain video URL played when bunny_video_id is absent
--   image_url        - a poster shown on the player
alter table public.lessons
  add column script text,
  add column sample_video_url text,
  add column image_url text;

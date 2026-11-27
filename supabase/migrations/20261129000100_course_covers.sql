-- Course cover pictures.
--
-- Lesson thumbnails live in Bunny with the video (the app reads them from
-- Bunny's API and uploads custom ones there), so they need nothing here.
-- A course cover is not a video, so it is stored in Supabase Storage:
-- a public bucket (covers are not sensitive, and public URLs are fast and
-- cacheable), written only by admins. Objects are named
-- <course_id>/<random uuid>.jpg|webp; a new name on every upload means no
-- stale caches. The app resizes and compresses before uploading.

alter table public.courses add column cover_path text
  check (cover_path is null
         or cover_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-covers', 'course-covers', true, 1048576, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- The course an object belongs to, or null if the name is not
-- <course_id>/<uuid>.jpg|webp for an existing course.
create function public.cover_object_course(p_name text)
returns uuid language sql stable security definer set search_path = public as
$$
  select c.id from public.courses c
  where p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|webp)$'
    and c.id = split_part(p_name, '/', 1)::uuid
$$;
revoke all on function public.cover_object_course(text) from public, anon;
grant execute on function public.cover_object_course(text) to authenticated;

-- Reading goes through the public URL (no policy needed). Admins also get a
-- select policy, which storage needs to replace and delete objects.
create policy course_covers_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'course-covers' and public.app_role() = 'admin');
create policy course_covers_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'course-covers' and public.app_role() = 'admin'
              and public.cover_object_course(name) is not null);
create policy course_covers_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'course-covers' and public.app_role() = 'admin');

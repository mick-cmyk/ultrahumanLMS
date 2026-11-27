import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { MAX_THUMBNAIL_BYTES, setVideoFrame, setVideoThumbnail } from '@/lib/thumbnails';

// Pictures in the course builder (admins only):
//  - a lesson's video thumbnail, uploaded to Bunny (a picture, or one of the
//    five frames Bunny made from the video);
//  - a course cover, stored in Supabase Storage under the admin's own session
//    (storage policies allow admins only).
// The browser resizes and compresses pictures before sending them.
//
// Multipart: kind=lesson|course, id, file.
// JSON: { action: 'lesson.frame', id, frame } or { action: 'course.cover.remove', id }.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COVER_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_COVER_BYTES = 1024 * 1024;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return bad('Not authenticated', 401);
  if (profile.role !== 'admin') return bad('Admins only', 403);
  const supabase = await createClient();

  if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    const kind = form?.get('kind');
    const id = String(form?.get('id') ?? '');
    const file = form?.get('file');
    if (!UUID.test(id) || !(file instanceof File)) return bad('Choose a picture first.');

    if (kind === 'lesson') {
      const videoId = await lessonVideo(supabase, id);
      if (!videoId) return bad('Add the lesson video first, then its thumbnail.');
      if (file.size > MAX_THUMBNAIL_BYTES) return bad('That picture is too big. Try a smaller one.');
      const r = await setVideoThumbnail(videoId, await file.arrayBuffer(), file.type);
      return r.ok ? NextResponse.json({ ok: true }) : bad(r.error);
    }

    if (kind === 'course') {
      const ext = COVER_TYPES[file.type];
      if (!ext) return bad('Use a JPG or WebP picture.');
      if (file.size > MAX_COVER_BYTES) return bad('That picture is too big. Try a smaller one.');
      const { data: course } = await supabase.from('courses').select('id, cover_path').eq('id', id).maybeSingle();
      if (!course) return bad('Course not found.', 404);
      const path = `${id}/${randomUUID()}.${ext}`;
      const up = await supabase.storage
        .from('course-covers')
        .upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
      if (up.error) return bad('Could not save the picture. Try again.');
      const { error } = await supabase.from('courses').update({ cover_path: path }).eq('id', id);
      if (error) {
        await supabase.storage.from('course-covers').remove([path]);
        return bad('Could not save the picture. Try again.');
      }
      if (course.cover_path) await supabase.storage.from('course-covers').remove([course.cover_path]);
      return NextResponse.json({ ok: true });
    }
    return bad('Unknown picture type.');
  }

  const body = (await request.json().catch(() => null)) as { action?: string; id?: string; frame?: number } | null;
  const id = String(body?.id ?? '');
  if (!UUID.test(id)) return bad('Invalid request.');

  if (body?.action === 'lesson.frame') {
    const videoId = await lessonVideo(supabase, id);
    if (!videoId) return bad('Add the lesson video first, then its thumbnail.');
    const r = await setVideoFrame(videoId, Number(body.frame));
    return r.ok ? NextResponse.json({ ok: true }) : bad(r.error);
  }

  if (body?.action === 'course.cover.remove') {
    const { data: course } = await supabase.from('courses').select('cover_path').eq('id', id).maybeSingle();
    if (!course) return bad('Course not found.', 404);
    const { error } = await supabase.from('courses').update({ cover_path: null }).eq('id', id);
    if (error) return bad('Could not remove the picture. Try again.');
    if (course.cover_path) await supabase.storage.from('course-covers').remove([course.cover_path]);
    return NextResponse.json({ ok: true });
  }

  return bad('Unknown action.');
}

// The lesson's Bunny video, read under the admin's session.
async function lessonVideo(supabase: Awaited<ReturnType<typeof createClient>>, lessonId: string): Promise<string | null> {
  const { data } = await supabase.from('lessons').select('bunny_video_id').eq('id', lessonId).maybeSingle();
  const v = data?.bunny_video_id;
  return v && UUID.test(v) ? v.toLowerCase() : null;
}

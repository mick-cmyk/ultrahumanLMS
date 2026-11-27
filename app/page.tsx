import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile, homeFor } from '@/lib/auth';
import { BrandBand } from '@/components/brand-band';
import { RETEST_MAX_CYCLES } from '@/lib/constants';
import { getBrand } from '@/brands';
import { Landing } from '@/components/landing';
import { Thumb } from '@/components/thumb';
import { coverUrl, videoThumbnails } from '@/lib/thumbnails';

const check = getBrand().voice.checkName;

// Logged out: the public landing page with a login box. Logged in: my training.
// Courses arrive already filtered by row level security: a course
// row is visible only if it is published and an assignment rule matches this
// user.
export default async function MyTrainingPage() {
  const profile = await getProfile();
  if (!profile) {
    const supabase = await createClient();
    const [{ data }, { data: savedWelcome }] = await Promise.all([
      supabase.rpc('registration_options', { p_code: null }),
      supabase.rpc('welcome_text'),
    ]);
    return <Landing signupOpen={(data as { open?: boolean } | null)?.open === true} savedWelcome={savedWelcome} />;
  }
  // Viewers have no personal training; send them to reporting.
  if (homeFor(profile.role) !== '/') redirect(homeFor(profile.role));

  const supabase = await createClient();

  const [
    { data: courses, error: coursesError },
    { data: progress, error: progressError },
    { data: retests, error: retestsError },
    { data: dueRetests, error: dueError },
    { data: brand },
  ] = await Promise.all([
    supabase
      .from('courses')
      .select('id, title, description, cover_path, modules(id, sort_order, lessons(id, sort_order, bunny_video_id))')
      .eq('published', true)
      .order('title'),
    supabase
      .from('lesson_progress')
      .select('lesson_id, watched_at')
      .eq('user_id', profile.id),
    supabase.from('retests').select('module_id, status').eq('user_id', profile.id),
    supabase.rpc('my_open_retests', { p_max_cycles: RETEST_MAX_CYCLES }),
    supabase.rpc('my_brand'),
  ]);

  // Never render a false "nothing assigned": if the data layer failed, fail
  // visibly and let the error boundary offer a retry.
  const failure = coursesError ?? progressError ?? retestsError ?? dueError;
  if (failure) throw new Error(`Failed to load training: ${failure.message}`);

  // Admins can read every course (for building), so keep only the published
  // ones assigned to them. For everyone else the database already did this.
  let myCourses = courses ?? [];
  if (profile.role === 'admin' && myCourses.length > 0) {
    const sees = await Promise.all(
      myCourses.map((c) => supabase.rpc('user_sees_course', { p_course_id: c.id }).then((r) => r.data === true)),
    );
    myCourses = myCourses.filter((_, i) => sees[i]);
  }

  // Each card's picture: the course cover, or the first video's thumbnail.
  const thumbs = myCourses.length > 0 ? await videoThumbnails() : new Map<string, string>();
  const pictureFor = (course: (typeof myCourses)[number]): string | null => {
    const own = coverUrl(course.cover_path);
    if (own) return own;
    const first = [...course.modules]
      .sort((a, b) => a.sort_order - b.sort_order)
      .flatMap((m) => [...m.lessons].sort((a, b) => a.sort_order - b.sort_order))
      .find((l) => l.bunny_video_id);
    return first?.bunny_video_id ? (thumbs.get(first.bunny_video_id.toLowerCase()) ?? null) : null;
  };

  const watched = new Set((progress ?? []).filter((p) => p.watched_at).map((p) => p.lesson_id));
  const retestByModule = new Map((retests ?? []).map((r) => [r.module_id, r.status]));
  const dueCount = (dueRetests ?? []).length;
  const org = Array.isArray(brand) ? (brand[0] ?? null) : null;

  const firstName = profile.full_name?.split(' ')[0];

  return (
    <div className="space-y-6">
      <BrandBand org={org} />
      <div>
        <h1 className="text-xl font-semibold">My training</h1>
        {firstName && <p className="text-gray-600">G&apos;day, {firstName}.</p>}
      </div>

      {dueCount > 0 && (
        <Link
          href="/retest"
          className="block rounded border border-amber-300 bg-amber-50 p-4 text-amber-900 hover:bg-amber-100"
        >
          <span className="font-medium">
            {dueCount === 1 ? `A ${check} is ready for you.` : `${dueCount} ${check}s are ready for you.`}
          </span>{' '}
          <span className="underline">Start now</span>
        </Link>
      )}

      {myCourses.length === 0 && (
        <div className="space-y-2 rounded border border-gray-200 p-4 text-gray-600">
          <p>
            Nothing assigned to you yet. When training is assigned, it&apos;ll
            show up here.
          </p>
          {profile.role === 'admin' && (
            <p className="text-sm">
              To do a course yourself, include yourself when you assign it on the{' '}
              <Link href="/assign" className="underline">
                Assign
              </Link>{' '}
              page (for example by adding your name, or your unit).
            </p>
          )}
        </div>
      )}

      <ul className="space-y-4">
        {myCourses.map((course) => {
          const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
          const done = lessonIds.filter((id) => watched.has(id)).length;
          const pct = lessonIds.length === 0 ? 0 : Math.round((done / lessonIds.length) * 100);

          const moduleStatuses = course.modules.map((m) => retestByModule.get(m.id));
          const retestWaiting = moduleStatuses.some((s) => s === 'sent' || s === 'requeued');
          const allVerified =
            course.modules.length > 0 && moduleStatuses.every((s) => s === 'passed');

          const picture = pictureFor(course);
          return (
            <li key={course.id} className="rounded border border-gray-200 p-4">
              <Link href={`/courses/${course.id}`} className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {picture && <Thumb src={picture} className="w-full shrink-0 sm:w-44" />}
                <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium underline">{course.title}</span>
                  <span className="shrink-0 text-sm text-gray-500">
                    {done} of {lessonIds.length} watched
                  </span>
                </div>
                {course.description && (
                  <p className="text-sm text-gray-600">{course.description}</p>
                )}
                <div className="h-2 w-full rounded bg-gray-100">
                  <div className="h-2 rounded bg-green-600" style={{ width: `${pct}%` }} />
                </div>
                {allVerified && (
                  <span className="inline-block text-sm font-medium text-green-700">
                    ✓ Retention-verified
                  </span>
                )}
                {retestWaiting && !allVerified && (
                  <span className="inline-block rounded bg-amber-50 px-2 py-1 text-sm text-amber-800">
                    Your {check} is on its way. Check your email.
                  </span>
                )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile, homeFor } from '@/lib/auth';
import { BrandBand } from '@/components/brand-band';
import { RETEST_MAX_CYCLES } from '@/lib/constants';
import { getBrand } from '@/brands';

const check = getBrand().voice.checkName;

// My training. Courses arrive already filtered by row level security: a course
// row is visible only if it is published and an assignment rule matches this
// user.
export default async function MyTrainingPage() {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  // Admins and viewers have no personal training; send them to reporting.
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
      .select('id, title, description, modules(id, lessons(id))')
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

      {(courses ?? []).length === 0 && (
        <p className="rounded border border-gray-200 p-4 text-gray-600">
          Nothing assigned to you yet. When training is assigned, it&apos;ll
          show up here.
        </p>
      )}

      <ul className="space-y-4">
        {(courses ?? []).map((course) => {
          const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
          const done = lessonIds.filter((id) => watched.has(id)).length;
          const pct = lessonIds.length === 0 ? 0 : Math.round((done / lessonIds.length) * 100);

          const moduleStatuses = course.modules.map((m) => retestByModule.get(m.id));
          const retestWaiting = moduleStatuses.some((s) => s === 'sent' || s === 'requeued');
          const allVerified =
            course.modules.length > 0 && moduleStatuses.every((s) => s === 'passed');

          return (
            <li key={course.id} className="rounded border border-gray-200 p-4">
              <Link href={`/courses/${course.id}`} className="block space-y-2">
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
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile, homeFor } from '@/lib/auth';
import { BrandBand } from '@/components/brand-band';
import { RETEST_MAX_CYCLES } from '@/lib/constants';
import { cap, getBrand } from '@/brands';
import { Landing } from '@/components/landing';
import { Thumb } from '@/components/thumb';
import { coverUrl, videoThumbnails } from '@/lib/thumbnails';

const check = getBrand().voice.checkName;

const dateFmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' });
const shortDate = (iso: string) => dateFmt.format(new Date(iso));

type Announcement = { id: string; title: string; body: string; important: boolean; created_at: string; author_name: string | null; read_at: string | null };
type Thread = { id: string; title: string; last_message_at: string; last_message_by_name: string | null; unread: boolean; closed: boolean };
type Latest = { key: string; href: string; title: string; from: string | null; text: string; when: string; tags: string[] };

// A small heading in the brand colour, with a short rule before it.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink">
      <span aria-hidden="true" className="h-px w-5 bg-current" />
      {children}
    </p>
  );
}

const card = 'rounded-xl border border-gray-200 p-5';
const bigButton =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-fg shadow-sm hover:opacity-90';

// Logged out: the public welcome page with a login box. Logged in: the home
// page (continue learning, quick checks, latest messages) and my training.
// Courses arrive already filtered by row level security: a course row is
// visible only if it is published and an assignment rule matches this user.
export default async function HomePage() {
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
    { data: announcements },
    { data: threads },
  ] = await Promise.all([
    supabase
      .from('courses')
      .select('id, title, description, cover_path, modules(id, title, sort_order, lessons(id, title, sort_order, bunny_video_id))')
      .eq('published', true)
      .order('title'),
    supabase.from('lesson_progress').select('lesson_id, watched_at, quiz_passed_at').eq('user_id', profile.id),
    supabase.from('retests').select('module_id, status, due_at').eq('user_id', profile.id),
    supabase.rpc('my_open_retests', { p_max_cycles: RETEST_MAX_CYCLES }),
    supabase.rpc('my_brand'),
    supabase.rpc('my_announcements', { p_limit: 5 }),
    supabase.rpc('my_threads', { p_limit: 5 }),
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
  type Course = (typeof myCourses)[number];
  const ordered = (course: Course) =>
    [...course.modules]
      .sort((a, b) => a.sort_order - b.sort_order)
      .flatMap((m) => [...m.lessons].sort((a, b) => a.sort_order - b.sort_order));

  // Each card's picture: the course cover, or the first video's thumbnail.
  const thumbs = myCourses.length > 0 ? await videoThumbnails() : new Map<string, string>();
  const thumbOf = (videoId: string | null) => (videoId ? (thumbs.get(videoId.toLowerCase()) ?? null) : null);
  const pictureFor = (course: Course): string | null =>
    coverUrl(course.cover_path) ?? thumbOf(ordered(course).find((l) => l.bunny_video_id)?.bunny_video_id ?? null);

  const watched = new Set((progress ?? []).filter((p) => p.watched_at).map((p) => p.lesson_id));
  // A lesson is done once it's watched or its quiz is passed (videos can be
  // optional on some courses).
  const doneLessons = new Set(
    (progress ?? []).filter((p) => p.watched_at || p.quiz_passed_at).map((p) => p.lesson_id),
  );
  const lastTouched = new Map(
    (progress ?? []).map((p) => [p.lesson_id, Math.max(Date.parse(p.watched_at ?? '') || 0, Date.parse(p.quiz_passed_at ?? '') || 0)]),
  );
  const retestByModule = new Map((retests ?? []).map((r) => [r.module_id, r.status]));
  const dueCount = (dueRetests ?? []).length;
  const org = Array.isArray(brand) ? (brand[0] ?? null) : null;
  const firstName = profile.full_name?.split(' ')[0];

  // ---- Continue learning: the unfinished course touched most recently, or
  // else the first one not started yet.
  const summaries = myCourses.map((course) => {
    const lessons = ordered(course);
    const done = lessons.filter((l) => doneLessons.has(l.id)).length;
    const touched = Math.max(0, ...lessons.map((l) => lastTouched.get(l.id) ?? 0));
    return { course, lessons, done, touched, next: lessons.find((l) => !doneLessons.has(l.id)) ?? null };
  });
  const unfinished = summaries.filter((s) => s.next);
  const current =
    [...unfinished].filter((s) => s.done > 0).sort((a, b) => b.touched - a.touched)[0] ?? unfinished[0] ?? null;
  const finishedCount = summaries.filter((s) => s.lessons.length > 0 && !s.next).length;

  // ---- Quick checks: one ready now, or the next one coming.
  const upcoming = (retests ?? [])
    .filter((r) => r.status === 'pending' && r.due_at && Date.parse(r.due_at) > Date.now())
    .sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!))[0];
  const upcomingModule = upcoming
    ? myCourses.flatMap((c) => c.modules.map((m) => ({ m, c }))).find((x) => x.m.id === upcoming.module_id)
    : undefined;

  // ---- Latest messages: newest updates and conversations, together.
  const latest: Latest[] = [
    ...((announcements ?? []) as Announcement[]).map((a) => ({
      key: `a-${a.id}`,
      href: '/messages',
      title: a.title,
      from: a.author_name ? `From ${a.author_name}` : null,
      text: a.body,
      when: a.created_at,
      tags: [...(a.read_at ? [] : ['New']), ...(a.important ? ['Important'] : []), 'Update'],
    })),
    ...((threads ?? []) as Thread[]).map((t) => ({
      key: `t-${t.id}`,
      href: `/messages/threads/${t.id}`,
      title: t.title,
      from: t.last_message_by_name ? `Last message from ${t.last_message_by_name}` : null,
      text: '',
      when: t.last_message_at,
      tags: [...(t.unread ? ['New'] : []), t.closed ? 'Closed' : 'Conversation'],
    })),
  ]
    .sort((a, b) => Date.parse(b.when) - Date.parse(a.when))
    .slice(0, 3);

  return (
    <div className="space-y-8">
      <BrandBand org={org} />
      <h1 className="text-2xl font-extrabold uppercase tracking-tight sm:text-3xl">
        {firstName ? (
          <>
            Welcome back, <span className="text-brand-ink">{firstName}</span>
          </>
        ) : (
          'Welcome back'
        )}
      </h1>

      {myCourses.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Continue learning */}
          <section className={`${card} space-y-3`} aria-labelledby="continue-heading">
            <Eyebrow>
              <span id="continue-heading">{current?.done ? 'Continue learning' : current ? 'Start learning' : 'All caught up'}</span>
            </Eyebrow>
            {current ? (
              <>
                <p className="text-lg font-semibold">{current.course.title}</p>
                <div className="h-2 w-full rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-brand"
                    style={{ width: `${current.lessons.length ? Math.round((current.done / current.lessons.length) * 100) : 0}%` }}
                  />
                </div>
                <p className="text-sm text-gray-600">
                  {current.done} of {current.lessons.length} lessons done
                  {current.lessons.length ? ` · ${Math.round((current.done / current.lessons.length) * 100)}%` : ''}
                </p>
                {current.next && (
                  <div className="flex items-center gap-3">
                    {current.next.bunny_video_id && (
                      <Thumb src={thumbOf(current.next.bunny_video_id)} play className="w-24 shrink-0" />
                    )}
                    <p className="min-w-0 text-sm">
                      <span className="block text-gray-500">Next</span>
                      <span className="block font-medium">{current.next.title}</span>
                    </p>
                  </div>
                )}
                {current.next && (
                  <Link href={`/lessons/${current.next.id}`} className={bigButton}>
                    {current.done ? 'Resume' : 'Start'}
                  </Link>
                )}
              </>
            ) : (
              <p className="text-gray-600">
                You&apos;ve done every lesson in {finishedCount === 1 ? 'your course' : `all ${finishedCount} courses`}. Nice work.
              </p>
            )}
          </section>

          {/* Quick checks */}
          <section className={`${card} space-y-3`} aria-labelledby="check-heading">
            <Eyebrow>
              <span id="check-heading">{cap(check)}s</span>
            </Eyebrow>
            {dueCount > 0 ? (
              <>
                <p className="text-lg font-semibold">
                  {dueCount === 1 ? `A ${check} is ready for you` : `${dueCount} ${check}s are ready for you`}
                </p>
                <p className="text-sm text-gray-600">A few questions to help it stick. It only takes a couple of minutes.</p>
                <Link href="/retest" className={bigButton}>
                  Start now
                </Link>
              </>
            ) : upcoming ? (
              <>
                <p className="text-lg font-semibold">Your next {check}</p>
                <p className="text-gray-600">
                  {upcomingModule ? <>On {upcomingModule.m.title}, arriving </> : 'Arriving '}
                  {shortDate(upcoming.due_at!)}. We&apos;ll email you when it&apos;s ready.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold">Nothing waiting</p>
                <p className="text-gray-600">
                  A few days after you finish a lesson, a {check} arrives by email to help it stick.
                </p>
              </>
            )}
          </section>
        </div>
      )}

      {latest.length > 0 && (
        <section className="space-y-3" aria-labelledby="latest-heading">
          <h2 id="latest-heading" className="text-lg font-extrabold uppercase tracking-tight">
            Latest messages
          </h2>
          <ul className="space-y-3">
            {latest.map((m) => (
              <li key={m.key}>
                <Link
                  href={m.href}
                  className={`flex flex-col gap-3 rounded-xl border p-4 hover:bg-gray-50 sm:flex-row sm:items-start sm:gap-5 ${
                    m.tags.includes('New') ? 'border-brand bg-brand-soft' : 'border-gray-200'
                  }`}
                >
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:w-32 sm:flex-col sm:items-start">
                    {m.tags.map((t) => (
                      <span
                        key={t}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                          t === 'New'
                            ? 'bg-brand text-brand-fg'
                            : t === 'Important'
                              ? 'bg-amber-100 text-amber-900'
                              : 'border border-gray-300 text-gray-600'
                        }`}
                      >
                        {t}
                      </span>
                    ))}
                    <span className="text-xs text-gray-500">{shortDate(m.when)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{m.title}</p>
                    {m.from && <p className="text-xs text-gray-500">{m.from}</p>}
                    {m.text && <p className="mt-1 line-clamp-2 text-sm text-gray-600">{m.text}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold uppercase tracking-wide text-brand-ink">
                    Open <span aria-hidden="true">&rarr;</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/messages" className="inline-block text-sm font-semibold uppercase tracking-wide text-brand-ink">
            All messages <span aria-hidden="true">&rarr;</span>
          </Link>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="training-heading">
        <h2 id="training-heading" className="text-lg font-extrabold uppercase tracking-tight">
          My training
        </h2>

        {myCourses.length === 0 && (
          <div className="space-y-2 rounded-xl border border-gray-200 p-4 text-gray-600">
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
            const allVerified = course.modules.length > 0 && moduleStatuses.every((s) => s === 'passed');

            const picture = pictureFor(course);
            return (
              <li key={course.id} className="rounded-xl border border-gray-200 p-4">
                <Link href={`/courses/${course.id}`} className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  {picture && <Thumb src={picture} className="w-full shrink-0 sm:w-44" />}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-medium underline">{course.title}</span>
                      <span className="shrink-0 text-sm text-gray-500">
                        {done} of {lessonIds.length} watched
                      </span>
                    </div>
                    {course.description && <p className="text-sm text-gray-600">{course.description}</p>}
                    <div className="h-2 w-full rounded bg-gray-100">
                      <div className="h-2 rounded bg-green-600" style={{ width: `${pct}%` }} />
                    </div>
                    {allVerified && (
                      <span className="inline-block text-sm font-medium text-green-700">✓ Retention-verified</span>
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
      </section>
    </div>
  );
}

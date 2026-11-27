import Link from 'next/link';
import { NextButton, type NextStep } from './next-button';
import { videoThumbnails } from '@/lib/thumbnails';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signedEmbedUrl } from '@/lib/bunny';
import { VideoPlayer } from './video-player';
import { Quiz } from './quiz';
import { ScormPlayer } from './scorm-player';
import { WrittenPrompts } from './written-prompts';
import { Discussion, type Post } from './discussion';

export default async function LessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: lesson }, { data: progress }] = await Promise.all([
    supabase
      .from('lessons')
      .select(
        'id, title, kind, scorm_package_id, bunny_video_id, sample_video_url, image_url, script, expectancy, duration_seconds, watch_threshold, video_aspect, modules(id, title, course_id, courses(id, title))'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('lesson_progress')
      .select('watch_pct, watched_at, quiz_passed_at')
      .eq('user_id', user!.id)
      .eq('lesson_id', id)
      .maybeSingle(),
  ]);

  if (!lesson) notFound();

  // SCORM lessons: launch info comes from get_scorm_launch, which also checks
  // the course is published and assigned to this learner.
  const scormLaunch =
    lesson.kind === 'scorm'
      ? (await supabase.rpc('get_scorm_launch', { p_lesson_id: lesson.id })).data
      : null;
  if (lesson.kind === 'scorm' && !scormLaunch) notFound();

  const embedUrl = signedEmbedUrl(lesson.bunny_video_id);
  // Without generated db types, supabase-js types to-one joins as arrays
  // even though PostgREST returns an object for them — normalise both shapes.
  const one = <T,>(rel: T | T[] | null): T | null =>
    Array.isArray(rel) ? (rel[0] ?? null) : rel;
  const parentModule = one(lesson.modules);
  const courseTitle = one(parentModule?.courses ?? null)?.title;

  // The lesson after this one in the course (across modules), for the
  // "Next" button once the quiz is passed. On the last lesson it goes back to
  // the course page.
  const { data: outline } = await supabase
    .from('modules')
    .select('sort_order, lessons(id, title, kind, sort_order, bunny_video_id)')
    .eq('course_id', parentModule?.course_id ?? '');
  const ordered = (outline ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((m) => [...(m.lessons ?? [])].sort((a, b) => a.sort_order - b.sort_order));
  const here = ordered.findIndex((l) => l.id === lesson.id);
  const following = here >= 0 ? ordered[here + 1] : undefined;
  const next: NextStep = following
    ? {
        href: `/lessons/${following.id}`,
        label: following.kind === 'video' ? 'Next video' : 'Next lesson',
        eyebrow: 'Up next',
        title: following.title,
        image: following.bunny_video_id
          ? ((await videoThumbnails()).get(following.bunny_video_id.toLowerCase()) ?? null)
          : null,
      }
    : {
        href: `/courses/${parentModule?.course_id}`,
        label: 'Finish course',
        eyebrow: 'All done',
        title: 'That was the last one. Back to the course page.',
      };

  // The second Next button, at the bottom of the page: once the quiz is
  // passed, or once a lesson with no quiz has been watched (get_lesson_quiz
  // answers null for a watched lesson only when it has no quiz).
  const done =
    lesson.kind !== 'scorm' &&
    (Boolean(progress?.quiz_passed_at) ||
      (Boolean(progress?.watched_at) &&
        !(await supabase.rpc('get_lesson_quiz', { p_lesson_id: lesson.id })).data));

  // Lesson discussion: only when an admin has turned it on.
  const [{ data: mode }, { data: me }] = await Promise.all([
    supabase.rpc('discussion_mode'),
    supabase.from('users').select('role, unit_id').eq('id', user!.id).maybeSingle(),
  ]);
  const discussionOn = mode === 'unit';
  const posts = discussionOn
    ? (((await supabase.rpc('lesson_discussion', { p_lesson: lesson.id })).data ?? []) as Post[])
    : [];

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/courses/${parentModule?.course_id}`}
          className="text-sm text-gray-500 underline"
        >
          &larr; {courseTitle ?? 'Back to course'}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{lesson.title}</h1>
      </div>

      {/* Told first, it changes how they watch. Told after, it does nothing. */}
      {lesson.expectancy && !scormLaunch && (
        <div className="rounded border-l-4 border-brand bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-600">Before you watch</p>
          <p className="mt-1">{lesson.expectancy}</p>
        </div>
      )}

      {scormLaunch ? (
        <ScormPlayer
          lessonId={lesson.id}
          title={lesson.title}
          packageId={scormLaunch.package_id}
          launchHref={scormLaunch.launch_href}
          initiallyComplete={Boolean(progress?.watched_at)}
          preview={Boolean(scormLaunch.preview)}
          launch={{
            studentId: scormLaunch.student_id,
            studentName: scormLaunch.student_name ?? '',
            masteryScore:
              scormLaunch.mastery_score == null ? null : Number(scormLaunch.mastery_score),
            attempt: scormLaunch.attempt,
          }}
        />
      ) : (
      <VideoPlayer
        lessonId={lesson.id}
        title={lesson.title}
        durationSeconds={lesson.duration_seconds}
        watchThreshold={Number(lesson.watch_threshold)}
        aspect={lesson.video_aspect == null ? null : Number(lesson.video_aspect)}
        embedUrl={embedUrl}
        sampleVideoUrl={lesson.sample_video_url}
        imageUrl={lesson.image_url}
        initialPct={progress?.watch_pct ?? 0}
        initiallyWatched={Boolean(progress?.watched_at)}
      />
      )}

      {lesson.script && (
        <details className="rounded border border-gray-200 p-4" open>
          <summary className="cursor-pointer font-medium">Script</summary>
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-gray-700">
            {lesson.script
              .split('\n')
              .filter((line: string) => line.trim())
              .map((line: string, i: number) => (
                <p key={i}>{line}</p>
              ))}
          </div>
        </details>
      )}

      {!scormLaunch && (
        <Quiz
          lessonId={lesson.id}
          unlocked={Boolean(progress?.watched_at)}
          alreadyPassed={Boolean(progress?.quiz_passed_at)}
          next={next}
        />
      )}

      {!scormLaunch && <WrittenPrompts lessonId={lesson.id} unlocked={Boolean(progress?.watched_at)} />}

      {discussionOn && (
        <Discussion
          lessonId={lesson.id}
          posts={posts}
          placed={Boolean(me?.unit_id)}
          showStores={me?.role === 'manager' || me?.role === 'admin'}
        />
      )}

      <p className="text-sm text-gray-600">
        Stuck on something?{' '}
        <Link href={`/messages?lesson=${lesson.id}`} className="text-brand-ink underline">
          Ask your manager about this lesson
        </Link>
        .
      </p>

      {done && (
        <section aria-label="Next" className="rounded border border-gray-200 bg-brand-soft p-4">
          <p className="text-sm font-medium">You&apos;ve finished this lesson.</p>
          <NextButton next={next} />
        </section>
      )}
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signedEmbedUrl } from '@/lib/bunny';
import { VideoPlayer } from './video-player';
import { Quiz } from './quiz';
import { ScormPlayer } from './scorm-player';

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
        'id, title, kind, scorm_package_id, bunny_video_id, sample_video_url, image_url, script, duration_seconds, watch_threshold, modules(id, title, course_id, courses(id, title))'
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
        />
      )}
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadCourseTree } from '@/lib/course-tree';
import { bunnyConfigured, signedEmbedUrl } from '@/lib/bunny';
import { checkCourse, hasErrors } from '@/lib/course-check';
import { ANSWER_LETTERS } from '@/lib/quiz-csv';
import { formatDuration } from '../../api';
import { PublishButton } from './publish-button';

export const metadata = { title: 'Check course' };

// Admin only. Two jobs: list anything wrong or missing (errors block
// publishing), and show the whole course the way staff will meet it, with the
// right answers marked, so it can be read through before anyone is assigned.
export default async function CheckCoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['admin']);
  const { id } = await params;
  const supabase = await createClient();
  const tree = await loadCourseTree(supabase, id);
  if (!tree) notFound();

  const issues = checkCourse(tree, { bunnyReady: bunnyConfigured() });
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const { count: assignments } = await supabase
    .from('assignments')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', id);

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/build/${tree.id}`} className="text-sm text-gray-500 underline">
          &larr; Back to editing
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Check: {tree.title}</h1>
      </div>

      <section className="space-y-3 rounded border border-gray-200 p-4">
        <h2 className="font-semibold">
          {errors.length
            ? `${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before publishing`
            : warnings.length
              ? 'Ready to publish, with a few things to look at'
              : 'Ready to publish'}
        </h2>
        {issues.length > 0 && (
          <ul className="space-y-1 text-sm">
            {[...errors, ...warnings].map((i, k) => (
              <li key={k} className={i.level === 'error' ? 'text-red-700' : 'text-amber-800'}>
                <span className="font-medium">{i.level === 'error' ? 'Fix' : 'Check'}:</span> {i.where}. {i.message}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <PublishButton courseId={tree.id} published={tree.published} blocked={hasErrors(issues)} />
          {tree.published && (
            <span className="text-sm text-gray-600">
              {assignments ? (
                <>
                  Assigned. Change who gets it on the{' '}
                  <Link href="/assign" className="underline">
                    Assign page
                  </Link>
                  .
                </>
              ) : (
                <>
                  Published, but nobody has it yet.{' '}
                  <Link href="/assign" className="font-medium text-brand-ink underline">
                    Assign it
                  </Link>
                </>
              )}
            </span>
          )}
        </div>
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="font-semibold">Read it through</h2>
          <p className="text-sm text-gray-600">
            This is the course as staff will see it, with the correct answers marked. Watching here doesn&apos;t
            count as progress.
          </p>
        </div>
        <div className="rounded border border-gray-200 p-4">
          <p className="text-lg font-semibold">{tree.title}</p>
          {tree.description && <p className="text-gray-600">{tree.description}</p>}
        </div>

        {tree.modules.map((m, mi) => (
          <div key={m.id} className="space-y-4">
            <div>
              <h3 className="font-semibold">
                Module {mi + 1}: {m.title}
              </h3>
              {m.intro && <p className="mt-1 whitespace-pre-line text-gray-700">{m.intro}</p>}
            </div>
            {m.lessons.map((l, li) => {
              const embed = signedEmbedUrl(l.bunny_video_id);
              return (
                <article key={l.id} className="space-y-3 rounded border border-gray-200 p-4">
                  <h4 className="font-medium">
                    Lesson {li + 1}: {l.title}
                    {l.duration_seconds ? (
                      <span className="ml-2 text-sm font-normal text-gray-600">{formatDuration(l.duration_seconds)}</span>
                    ) : null}
                  </h4>
                  {l.kind === 'scorm' ? (
                    <p className="text-sm text-gray-600">
                      SCORM package.{' '}
                      <Link href={`/lessons/${l.id}`} className="underline">
                        Preview it
                      </Link>
                    </p>
                  ) : embed ? (
                    <div className="aspect-video w-full overflow-hidden rounded bg-black">
                      <iframe
                        src={embed}
                        title={`Video: ${l.title}`}
                        className="h-full w-full"
                        loading="lazy"
                        allow="accelerometer; gyroscope; encrypted-media; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : l.sample_video_url && !l.bunny_video_id ? (
                    <video src={l.sample_video_url} controls preload="metadata" className="w-full rounded bg-black" />
                  ) : (
                    <p className="rounded bg-gray-100 p-6 text-center text-sm text-gray-600">
                      {l.bunny_video_id ? "Video set, but Bunny isn't connected on this site, so it can't play here." : 'No video yet.'}
                    </p>
                  )}
                  {l.script && (
                    <div className="space-y-1 text-sm text-gray-700">
                      {l.script.split('\n').filter((x) => x.trim()).map((x, k) => (
                        <p key={k}>{x}</p>
                      ))}
                    </div>
                  )}
                  {l.kind !== 'scorm' &&
                    (l.quiz?.questions.length ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">
                          Quick check: {l.quiz.questions.length} question{l.quiz.questions.length === 1 ? '' : 's'}, pass mark{' '}
                          {Math.round(l.quiz.pass_mark * 100)}%
                        </p>
                        <ol className="space-y-2 text-sm">
                          {l.quiz.questions.map((q, qi) => (
                            <li key={q.id}>
                              <p className="font-medium">
                                {qi + 1}. {q.text}
                              </p>
                              <ul>
                                {q.options.map((o, j) => (
                                  <li key={j} className={j === q.correct_index ? 'font-medium text-green-800' : 'text-gray-700'}>
                                    {ANSWER_LETTERS[j]}. {o} {j === q.correct_index && '(correct)'}
                                  </li>
                                ))}
                              </ul>
                              {q.explanation && <p className="text-gray-600">Why: {q.explanation}</p>}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-600">No questions. Watch only.</p>
                    ))}
                </article>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}

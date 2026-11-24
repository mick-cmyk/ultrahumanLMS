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
import { WatchSetting } from './watch-setting';
import { DraftActions, ReviewControl } from './review-controls';
import type { QuizQuestion } from '@/lib/quiz-csv';
import type { WrittenPrompt } from '@/lib/lesson-import';

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
  const allLessons = tree.modules.flatMap((m) => m.lessons);
  const toReview = allLessons.filter((l) => l.needs_review).length;
  const waiting = allLessons.filter((l) => l.draft).length;
  const [{ count: assignments }, { data: assignedToMe }] = await Promise.all([
    supabase.from('assignments').select('id', { count: 'exact', head: true }).eq('course_id', id),
    // Is it assigned to this admin? Progress and quizzes only count on a
    // published course assigned to you, so a half-built course never collects any.
    supabase.rpc('user_sees_course', { p_course_id: id }),
  ]);
  const canTake = tree.published && assignedToMe === true;

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/build/${tree.id}`} className="text-sm text-gray-500 underline">
          &larr; Back to editing
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Check: {tree.title}</h1>
      </div>

      {/* Go through the course for real, the way staff do. */}
      <section className="flex flex-col gap-3 rounded border border-gray-200 bg-brand-soft p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-semibold">Take the course</h2>
          {canTake ? (
            <p className="text-sm text-gray-600">
              Watch the videos and answer the questions exactly as staff do. Your progress counts like anyone
              else&apos;s, and the quick check will arrive by email.
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              {tree.published
                ? 'It isn’t assigned to you yet. Assign it to everyone, or add yourself under Individuals on the Assign page, then come back here.'
                : 'Publish it first, then assign it to yourself (or everyone) on the Assign page. Until then, the Read it through section below shows every video and question.'}
            </p>
          )}
        </div>
        {canTake ? (
          <Link
            href={`/courses/${tree.id}`}
            className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-lg bg-brand px-6 py-2 font-semibold text-brand-fg hover:opacity-90"
          >
            Take the course <span aria-hidden="true">&nbsp;&rarr;</span>
          </Link>
        ) : (
          tree.published && (
            <Link href="/assign" className="shrink-0 font-medium text-brand-ink underline">
              Go to Assign
            </Link>
          )
        )}
      </section>

      <section className="space-y-3 rounded border border-gray-200 p-4">
        <h2 className="font-semibold">
          {errors.length
            ? `${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before publishing`
            : warnings.length
              ? 'Ready to publish, with a few things to look at'
              : 'Ready to publish'}
        </h2>
        {(toReview > 0 || waiting > 0) && (
          <p className="text-sm">
            {toReview > 0 && (
              <>
                <span className="font-medium">
                  {toReview} lesson{toReview === 1 ? '' : 's'} to review.
                </span>{' '}
                Read each one below and tick it off.{' '}
              </>
            )}
            {waiting > 0 && (
              <>
                <span className="font-medium">
                  {waiting} change{waiting === 1 ? '' : 's'} waiting.
                </span>{' '}
                Staff keep the current questions until each change is reviewed and swapped in.
              </>
            )}
          </p>
        )}
        {issues.length > 0 && (
          <ul className="space-y-1 text-sm">
            {[...errors, ...warnings].map((i, k) => (
              <li key={k} className={i.level === 'error' ? 'text-red-700' : 'text-amber-800'}>
                <span className="font-medium">{i.level === 'error' ? 'Fix' : 'Check'}:</span> {i.where}. {i.message}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-gray-200 pt-3">
          <WatchSetting courseId={tree.id} requireWatch={tree.require_watch} />
        </div>
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
                <article
                  key={l.id}
                  id={`lesson-${l.id}`}
                  className={`space-y-3 rounded border p-4 ${l.needs_review || l.draft ? 'border-amber-400' : 'border-gray-200'}`}
                >
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
                  {l.expectancy && l.kind !== 'scorm' && (
                    <p className="rounded border-l-4 border-brand bg-gray-50 p-3 text-sm">
                      <span className="font-medium">Before you watch:</span> {l.expectancy}
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
                      <QuestionList passMark={l.quiz.pass_mark} questions={l.quiz.questions} />
                    ) : (
                      <p className="text-sm text-gray-600">No questions. Watch only.</p>
                    ))}
                  {l.kind !== 'scorm' && <PromptList prompts={l.written_prompts} />}
                  {l.kind !== 'scorm' && (
                    <ReviewControl lessonId={l.id} reviewedAt={l.reviewed_at} needsReview={l.needs_review} />
                  )}
                  {l.draft && (
                    <div className="space-y-3 rounded border border-amber-400 bg-amber-50 p-3">
                      <div>
                        <p className="font-medium text-amber-900">Change waiting for review</p>
                        <p className="text-sm text-amber-900">
                          {l.draft.note ? `${l.draft.note}. ` : ''}Saved{' '}
                          {new Date(l.draft.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}. Staff see
                          the version above until this is swapped in.
                        </p>
                      </div>
                      {l.draft.expectancy && (
                        <p className="text-sm">
                          <span className="font-medium">Before you watch:</span> {l.draft.expectancy}
                        </p>
                      )}
                      {l.draft.questions.length ? (
                        <QuestionList passMark={l.draft.pass_mark} questions={l.draft.questions} />
                      ) : (
                        <p className="text-sm">No questions in this version. Swapping it in makes the lesson watch only.</p>
                      )}
                      <PromptList prompts={l.draft.written_prompts} />
                      <DraftActions lessonId={l.id} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}

function QuestionList({ passMark, questions }: { passMark: number; questions: QuizQuestion[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        Quick check: {questions.length} question{questions.length === 1 ? '' : 's'}, pass mark {Math.round(passMark * 100)}%
      </p>
      <ol className="space-y-2 text-sm">
        {questions.map((q, qi) => (
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
  );
}

function PromptList({ prompts }: { prompts: WrittenPrompt[] }) {
  if (!prompts.length) return null;
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium">Explain it in your own words (not marked)</p>
      <ol className="space-y-2">
        {prompts.map((p, i) => (
          <li key={p.id}>
            <p className="font-medium">
              {i + 1}. {p.prompt}
              {p.max_words ? <span className="font-normal text-gray-600"> (up to {p.max_words} words)</span> : null}
            </p>
            {p.model_answer && <p className="text-gray-600">Model answer: {p.model_answer}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

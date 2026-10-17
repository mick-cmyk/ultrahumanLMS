'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type Question = { id: string; text: string; options: string[] };
type Quiz = { pass_mark: number; questions: Question[] };
type Result = {
  id: string;
  chosen: number | null;
  correct_index: number;
  correct: boolean;
  explanation: string | null;
};
type AttemptResult = {
  score: number;
  correct_count: number;
  total: number;
  pass_mark: number;
  passed: boolean;
  results: Result[];
};

// Retrieval practice: quiz unlocks once the video is watched. Answer → immediate
// feedback and an explanation whether right or wrong (the error moment is the
// learning moment). Fail → retry immediately with questions reshuffled.
export function Quiz({
  lessonId,
  unlocked,
  alreadyPassed,
}: {
  lessonId: string;
  unlocked: boolean;
  alreadyPassed: boolean;
}) {
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [order, setOrder] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [passed, setPassed] = useState(alreadyPassed);
  const [loading, setLoading] = useState(unlocked);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const shuffle = useCallback((qs: Question[]) => {
    const a = [...qs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/quiz?lesson_id=${lessonId}`);
        const body = await res.json();
        if (cancelled) return;
        if (body.quiz) {
          setQuiz(body.quiz);
          setOrder(shuffle(body.quiz.questions));
        }
      } catch {
        if (!cancelled) setError('Could not load the quiz. Refresh to try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, lessonId, shuffle]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!quiz) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson_id: lessonId, answers }),
      });
      const body: AttemptResult & { error?: string } = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong marking your answers.');
        return;
      }
      setResult(body);
      if (body.passed) {
        setPassed(true);
        // Refresh so the course/lesson watched+passed states update.
        router.refresh();
      }
    } catch {
      setError('Something went wrong marking your answers.');
    } finally {
      setSubmitting(false);
    }
  }

  function retry() {
    setResult(null);
    setAnswers({});
    if (quiz) setOrder(shuffle(quiz.questions));
  }

  if (!unlocked && !passed) {
    return (
      <section className="rounded border border-gray-200 p-4 text-gray-600">
        <h2 className="font-medium text-gray-900">Quiz</h2>
        <p className="mt-1 text-sm">
          Watch the video to unlock the quiz.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="rounded border border-gray-200 p-4 text-gray-600">
        Loading quiz…
      </section>
    );
  }

  // Unlocked but no quiz payload → watch-only lesson.
  if (!quiz && !passed) {
    return null;
  }

  const feedbackFor = (id: string) =>
    result?.results.find((r) => r.id === id);

  return (
    <section className="space-y-4 rounded border border-gray-200 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">Quiz</h2>
        {passed && (
          <span className="text-sm font-medium text-green-700">✓ Passed</span>
        )}
      </div>

      {result && (
        <div
          className={`rounded p-3 text-sm ${
            result.passed
              ? 'bg-green-50 text-green-800'
              : 'bg-amber-50 text-amber-900'
          }`}
        >
          You got {result.correct_count} of {result.total} right (
          {Math.round(result.score * 100)}%).{' '}
          {result.passed
            ? 'Nice work — that counts as passed.'
            : `You need ${Math.round(
                result.pass_mark * 100
              )}% to pass. Have another go — the explanations below will help.`}
        </div>
      )}

      {quiz && (
        <form onSubmit={submit} className="space-y-5">
          {order.map((q, qi) => {
            const fb = feedbackFor(q.id);
            return (
              <fieldset key={q.id} className="space-y-2">
                <legend className="font-medium">
                  {qi + 1}. {q.text}
                </legend>
                {q.options.map((opt, oi) => {
                  const isChosen = answers[q.id] === oi;
                  const isCorrect = fb && oi === fb.correct_index;
                  const isWrongChosen = fb && fb.chosen === oi && !fb.correct;
                  return (
                    <label
                      key={oi}
                      className={`flex items-center gap-2 rounded border p-2 ${
                        isCorrect
                          ? 'border-green-500 bg-green-50'
                          : isWrongChosen
                            ? 'border-red-400 bg-red-50'
                            : 'border-gray-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        checked={isChosen}
                        disabled={Boolean(result)}
                        onChange={() =>
                          setAnswers((a) => ({ ...a, [q.id]: oi }))
                        }
                      />
                      <span>{opt}</span>
                    </label>
                  );
                })}
                {fb && (
                  <p className="text-sm text-gray-600">
                    <strong>{fb.correct ? 'Correct. ' : 'Not quite. '}</strong>
                    {fb.explanation}
                  </p>
                )}
              </fieldset>
            );
          })}

          {error && <p className="text-sm text-red-700">{error}</p>}

          {!result ? (
            <button
              type="submit"
              disabled={submitting || Object.keys(answers).length < order.length}
              className="rounded bg-brand hover:opacity-90 px-4 py-2 font-medium text-brand-fg disabled:opacity-50"
            >
              {submitting ? 'Checking…' : 'Submit answers'}
            </button>
          ) : (
            !result.passed && (
              <button
                type="button"
                onClick={retry}
                className="rounded bg-brand hover:opacity-90 px-4 py-2 font-medium text-brand-fg"
              >
                Try again
              </button>
            )
          )}
        </form>
      )}
    </section>
  );
}

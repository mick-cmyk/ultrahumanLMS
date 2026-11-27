'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { NextButton, type NextStep } from './next-button';

type Question = { id: string; text: string; options: string[] };
type Quiz = { pass_mark: number; questions: Question[] };
type Marked = {
  id: string;
  chosen: number;
  correct: boolean;
  correct_index: number;
  explanation: string | null;
};
type AttemptResult = {
  score: number;
  correct_count: number;
  total: number;
  pass_mark: number;
  passed: boolean;
};

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const primary =
  'inline-flex min-h-12 items-center justify-center rounded-lg bg-brand px-6 py-2 font-semibold text-brand-fg shadow-sm hover:opacity-90 disabled:opacity-50';

// Retrieval practice, one question at a time. The quiz unlocks once the video
// is watched. Pick an answer and it's marked straight away, with the question
// maker's explanation whether right or wrong (the error moment is the learning
// moment), then on to the next. The first answer to each question is the one
// that counts. At the end the attempt is scored and saved; fail and you can go
// again straight away with the questions reshuffled.
export function Quiz({
  lessonId,
  unlocked,
  alreadyPassed,
  next,
}: {
  lessonId: string;
  unlocked: boolean;
  alreadyPassed: boolean;
  /** Where to go once passed: the next lesson, or back to the course. */
  next?: NextStep;
}) {
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [order, setOrder] = useState<Question[]>([]);
  const [step, setStep] = useState(0);
  const [marked, setMarked] = useState<Record<string, Marked>>({});
  const [checking, setChecking] = useState<number | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [passed, setPassed] = useState(alreadyPassed);
  // Someone who has already passed sees that first, with the option to go again.
  const [taking, setTaking] = useState(!alreadyPassed);
  const [loading, setLoading] = useState(unlocked);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState('');

  // Move focus to each new question, the feedback and the result, so screen
  // reader and keyboard users follow along.
  const feedbackRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const current = order[step];
  const mark = current ? marked[current.id] : undefined;
  useEffect(() => {
    if (mark) feedbackRef.current?.focus();
  }, [mark]);
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

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

  async function choose(oi: number) {
    if (!current || mark || checking !== null) return;
    setChecking(oi);
    setError('');
    try {
      const res = await fetch('/api/quiz/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson_id: lessonId, question_id: current.id, chosen: oi }),
      });
      const body: Marked & { error?: string } = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Could not check that answer. Try again.');
        return;
      }
      setMarked((m) => ({ ...m, [current.id]: body }));
    } catch {
      setError('Could not check that answer. Check your connection and try again.');
    } finally {
      setChecking(null);
    }
  }

  async function finish() {
    setFinishing(true);
    setError('');
    const answers = Object.fromEntries(Object.values(marked).map((m) => [m.id, m.chosen]));
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson_id: lessonId, answers }),
      });
      const body: AttemptResult & { error?: string } = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong saving your answers.');
        return;
      }
      setResult(body);
      if (body.passed) {
        setPassed(true);
        // Refresh so the course and lesson watched and passed states update.
        router.refresh();
      }
    } catch {
      setError('Something went wrong saving your answers. Try again.');
    } finally {
      setFinishing(false);
    }
  }

  function goNext() {
    setStep((s) => s + 1);
    // Wait for the next question to render, then focus its heading.
    requestAnimationFrame(() => questionRef.current?.focus());
  }

  function startAgain() {
    setResult(null);
    setMarked({});
    setStep(0);
    setTaking(true);
    if (quiz) setOrder(shuffle(quiz.questions));
    requestAnimationFrame(() => questionRef.current?.focus());
  }

  if (!unlocked && !passed) {
    return (
      <section className="rounded border border-gray-200 p-4 text-gray-600">
        <h2 className="font-medium text-gray-900">Quiz</h2>
        <p className="mt-1 text-sm">Watch the video to unlock the quiz.</p>
      </section>
    );
  }

  if (loading) {
    return <section className="rounded border border-gray-200 p-4 text-gray-600">Loading quiz…</section>;
  }

  // Unlocked but no quiz payload: a watch-only lesson. Once it's watched,
  // the way on is all that's needed.
  if (!quiz && !passed) {
    if (error) {
      return (
        <section role="alert" className="rounded border border-gray-200 p-4 text-sm text-red-700">
          {error}
        </section>
      );
    }
    return next ? (
      <section className="rounded border border-gray-200 p-4">
        <p className="text-sm text-gray-600">No quiz for this one.</p>
        <NextButton next={next} />
      </section>
    ) : null;
  }

  const total = order.length;
  const last = step === total - 1;

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Quiz</h2>
        {passed && (
          <span className="text-sm font-medium text-green-700">
            <span aria-hidden="true">✓ </span>Passed
          </span>
        )}
      </div>

      {/* The result, once the last question is done. */}
      {result && (
        <div ref={resultRef} tabIndex={-1} aria-live="polite" className="space-y-3 outline-none">
          <div className={`rounded-lg p-4 ${result.passed ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
            <p className="text-lg font-semibold">
              You got {result.correct_count} of {result.total} right.
            </p>
            <p className="text-sm">
              {result.passed
                ? 'Nice work. That counts as passed.'
                : passed
                  ? `You need ${Math.round(result.pass_mark * 100)}% to pass this time. Your earlier pass still counts.`
                  : `You need ${Math.round(result.pass_mark * 100)}% to pass. Have another go: the questions come in a new order.`}
            </p>
            {result.passed && next && <NextButton next={next} />}
          </div>
          {!result.passed && (
            <button type="button" onClick={startAgain} className={primary}>
              Try again
            </button>
          )}
        </div>
      )}

      {/* Already passed, before going again. */}
      {!result && !taking && passed && (
        <div className="space-y-3">
          <div className="rounded-lg bg-green-50 p-4 text-sm text-green-900">
            You&apos;ve passed this one.
            {next && <NextButton next={next} />}
          </div>
          {quiz && (
            <button
              type="button"
              onClick={startAgain}
              className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
            >
              Do the quiz again
            </button>
          )}
        </div>
      )}

      {/* One question at a time. */}
      {!result && taking && current && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>
                Question {step + 1} of {total}
              </span>
            </div>
            <div className="mt-2 flex gap-1" aria-hidden="true">
              {order.map((q, i) => {
                const m = marked[q.id];
                return (
                  <span
                    key={q.id}
                    className={`h-1.5 flex-1 rounded-full ${
                      m ? (m.correct ? 'bg-green-600' : 'bg-red-600') : i === step ? 'bg-brand' : 'bg-gray-200'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          <h3 ref={questionRef} tabIndex={-1} className="text-lg font-semibold outline-none">
            {current.text}
          </h3>

          <ul className="space-y-2" aria-label="Answers">
            {current.options.map((opt, oi) => {
              const isRight = mark && oi === mark.correct_index;
              const isWrongPick = mark && oi === mark.chosen && !mark.correct;
              const look = isRight
                ? 'border-green-600 bg-green-50 text-green-900'
                : isWrongPick
                  ? 'border-red-600 bg-red-50 text-red-800'
                  : mark
                    ? 'border-gray-200 opacity-60'
                    : 'border-gray-300 hover:border-brand hover:bg-brand-soft';
              return (
                <li key={oi}>
                  <button
                    type="button"
                    disabled={Boolean(mark) || checking !== null}
                    aria-pressed={mark ? oi === mark.chosen : undefined}
                    onClick={() => choose(oi)}
                    className={`flex min-h-12 w-full items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors disabled:cursor-default ${look}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                        isRight ? 'border-green-600 bg-green-600 text-white' : isWrongPick ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300'
                      }`}
                    >
                      {isRight ? '✓' : isWrongPick ? '✗' : LETTERS[oi]}
                    </span>
                    <span className="pt-0.5">
                      {opt}
                      {checking === oi && <span className="ml-2 text-sm text-gray-500">Checking…</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {mark && (
            <div
              ref={feedbackRef}
              tabIndex={-1}
              aria-live="polite"
              className={`rounded-lg border-l-4 p-4 outline-none ${
                mark.correct ? 'border-green-600 bg-green-50 text-green-900' : 'border-red-600 bg-red-50 text-red-800'
              }`}
            >
              <p className="font-semibold">{mark.correct ? 'Correct.' : 'Not quite.'}</p>
              {!mark.correct && (
                <p className="text-sm">
                  The answer is {LETTERS[mark.correct_index]}: {current.options[mark.correct_index]}
                </p>
              )}
              {mark.explanation && <p className="mt-2 text-sm">{mark.explanation}</p>}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          {mark && (
            <button type="button" onClick={last ? finish : goNext} disabled={finishing} className={primary}>
              {last ? (finishing ? 'Saving…' : 'See my result') : 'Next question'}
              {!finishing && <span aria-hidden="true">&nbsp;&rarr;</span>}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

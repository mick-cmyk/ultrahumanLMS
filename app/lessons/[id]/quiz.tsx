'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { NextButton, type NextStep } from './next-button';
import { QuestionStep, stepButton as primary } from '@/components/question-step';

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

  // The result is focused when it appears, so it's announced.
  const resultRef = useRef<HTMLDivElement>(null);
  const current = order[step];
  const mark = current ? marked[current.id] : undefined;
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
  }

  function startAgain() {
    setResult(null);
    setMarked({});
    setStep(0);
    setTaking(true);
    if (quiz) setOrder(shuffle(quiz.questions));
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
        <QuestionStep
          step={step}
          progress={order.map((q) => (marked[q.id] ? marked[q.id].correct : null))}
          text={current.text}
          options={current.options}
          mark={mark}
          checking={checking}
          onChoose={choose}
          error={error}
          nextLabel={last ? (finishing ? 'Saving…' : 'See my result') : 'Next question'}
          onNext={last ? finish : goNext}
          busy={finishing}
        />
      )}
    </section>
  );
}

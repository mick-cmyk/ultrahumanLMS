'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getBrand } from '@/brands';
import { QuestionStep, type StepMark } from '@/components/question-step';

const check = getBrand().voice.checkName;

type Question = { id: string; text: string; options: string[]; lesson_id: string };
type Result = {
  id: string;
  correct: boolean;
  correct_index?: number;
  explanation?: string | null;
  lesson_id: string;
  lesson_title: string;
};
type GradeResult = {
  ok: boolean;
  passed: boolean;
  correct_count: number;
  total: number;
  pass_mark: number;
  capped: boolean;
  results: Result[];
  reason?: string;
};

// The quick check, one question at a time. Each answer is marked straight
// away with the question maker's explanation. The database keeps the first
// answer to each question, and the final marking uses those answers.
export function RetestPlayer({
  retestId,
  moduleTitle,
  courseTitle,
  questions,
}: {
  retestId: string;
  moduleTitle: string;
  courseTitle: string;
  questions: Question[];
}) {
  const resultRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [marked, setMarked] = useState<Record<string, StepMark>>({});
  const [checking, setChecking] = useState<number | null>(null);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const current = questions[step];
  const mark = current ? marked[current.id] : undefined;
  const last = step === questions.length - 1;

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  async function choose(oi: number) {
    if (!current || mark || checking !== null) return;
    setChecking(oi);
    setError('');
    try {
      const res = await fetch('/api/retest/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retest_id: retestId, question_id: current.id, chosen: oi }),
      });
      const body: StepMark & { error?: string } = await res.json();
      if (!res.ok) {
        setError(
          body.error === 'this check is not available'
            ? `This ${check} isn't open any more. Go back to your training to see where you're up to.`
            : 'Could not check that answer. Try again.'
        );
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
    setSubmitting(true);
    setError('');
    const answers = Object.fromEntries(Object.entries(marked).map(([id, m]) => [id, m.chosen]));
    try {
      const res = await fetch('/api/retest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retest_id: retestId, answers }),
      });
      const body: GradeResult & { error?: string } = await res.json();
      if (!res.ok || !body.ok) {
        setError(
          body.error ??
            (body.reason === 'already_passed'
              ? `This ${check} has already been passed.`
              : `Something went wrong marking your ${check}.`)
        );
        return;
      }
      setResult(body);
    } catch {
      setError(`Something went wrong marking your ${check}.`);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const missed = result.results.filter((r) => !r.correct);
    const revisit = Array.from(new Map(missed.map((r) => [r.lesson_id, r.lesson_title])).entries());

    return (
      <div ref={resultRef} tabIndex={-1} aria-live="polite" className="mx-auto max-w-lg space-y-4 py-6 outline-none">
        <h1 className="text-xl font-semibold">{moduleTitle}</h1>
        {result.passed ? (
          <div className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
            <p className="text-lg font-semibold">
              Passed: {result.correct_count} of {result.total} right.
            </p>
            <p className="text-sm">
              That is this module retention-verified. This check came a few days later on purpose, because spacing it
              out is what makes it stick. Nothing else to do.
            </p>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <p className="text-lg font-semibold">
              You got {result.correct_count} of {result.total}. Worth another quick look.
            </p>
            {revisit.length > 0 && (
              <div className="text-sm">
                <p className="mb-1">Topics to refresh:</p>
                <ul className="list-inside list-disc space-y-1">
                  {revisit.map(([lessonId, title]) => (
                    <li key={lessonId}>
                      <Link href={`/lessons/${lessonId}`} className="underline">
                        {title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-sm">
              {result.capped
                ? "We'll leave it there for now. Your manager can help you finish this off."
                : `We'll send you another ${check} in a few days.`}
            </p>
          </div>
        )}
        <Link href="/" className="text-sm underline">
          Back to my training
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 py-6">
      <div>
        <p className="text-sm text-gray-500">{courseTitle}</p>
        <h1 className="text-xl font-semibold">
          {moduleTitle}: {check}
        </h1>
        <p className="mt-1 text-gray-600">
          A few quick questions to lock this in. It takes about two minutes. Your first answer to each one is the one
          that counts.
        </p>
      </div>

      {current && (
        <QuestionStep
          step={step}
          progress={questions.map((q) => (marked[q.id] ? marked[q.id].correct : null))}
          text={current.text}
          options={current.options}
          mark={mark}
          checking={checking}
          onChoose={choose}
          error={error}
          nextLabel={last ? (submitting ? 'Saving…' : 'See my result') : 'Next question'}
          onNext={last ? finish : () => setStep((s) => s + 1)}
          busy={submitting}
        />
      )}
    </div>
  );
}

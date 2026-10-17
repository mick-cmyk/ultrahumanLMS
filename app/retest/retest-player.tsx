'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getBrand } from '@/brands';

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
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<GradeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
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
    const revisit = Array.from(
      new Map(missed.map((r) => [r.lesson_id, r.lesson_title])).entries()
    );

    return (
      <div className="mx-auto max-w-lg space-y-4 py-6">
        <h1 className="text-xl font-semibold">{moduleTitle}</h1>
        {result.passed ? (
          <div className="space-y-2 rounded border border-green-200 bg-green-50 p-4 text-green-900">
            <p className="font-medium">
              Passed: {result.correct_count} of {result.total} right.
            </p>
            <p className="text-sm">
              That is this module retention-verified. This check came a few days
              later on purpose, because spacing it out is what makes it stick.
              Nothing else to do.
            </p>
          </div>
        ) : (
          <div className="space-y-3 rounded border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <p className="font-medium">
              You got {result.correct_count} of {result.total}. Worth another
              quick look.
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
    <div className="mx-auto max-w-lg space-y-4 py-6">
      <div>
        <p className="text-sm text-gray-500">{courseTitle}</p>
        <h1 className="text-xl font-semibold">{moduleTitle}: {check}</h1>
        <p className="mt-1 text-gray-600">
          A few quick questions to lock this in. It takes about two minutes.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        {questions.map((q, qi) => (
          <fieldset key={q.id} className="space-y-2">
            <legend className="font-medium">
              {qi + 1}. {q.text}
            </legend>
            {q.options.map((opt, oi) => (
              <label
                key={oi}
                className="flex items-center gap-2 rounded border border-gray-200 p-2"
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={answers[q.id] === oi}
                  onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                />
                <span>{opt}</span>
              </label>
            ))}
          </fieldset>
        ))}

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={submitting || Object.keys(answers).length < questions.length}
          className="rounded bg-brand hover:opacity-90 px-4 py-2 font-medium text-brand-fg disabled:opacity-50"
        >
          {submitting ? 'Checking...' : 'Submit answers'}
        </button>
      </form>
    </div>
  );
}

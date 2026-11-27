'use client';

import { useEffect, useRef } from 'react';

// One question on screen at a time, marked straight away. Shared by the quiz
// after a video and the quick check a few days later.

export type StepMark = {
  chosen: number;
  correct: boolean;
  correct_index: number;
  explanation: string | null;
};

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const stepButton =
  'inline-flex min-h-12 items-center justify-center rounded-lg bg-brand px-6 py-2 font-semibold text-brand-fg shadow-sm hover:opacity-90 disabled:opacity-50';

export function QuestionStep({
  step,
  progress,
  text,
  options,
  mark,
  checking,
  onChoose,
  error,
  nextLabel,
  onNext,
  busy = false,
}: {
  /** 0-based position of this question. */
  step: number;
  /** One entry per question: right, wrong, or not answered yet. */
  progress: (boolean | null)[];
  text: string;
  options: string[];
  mark: StepMark | undefined;
  /** The answer being checked right now, if any. */
  checking: number | null;
  onChoose: (index: number) => void;
  error: string;
  nextLabel: string;
  onNext: () => void;
  busy?: boolean;
}) {
  // Focus the question when it appears and the feedback once it's marked, so
  // screen reader and keyboard users follow along.
  const questionRef = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step > 0) questionRef.current?.focus();
  }, [step]);
  useEffect(() => {
    if (mark) feedbackRef.current?.focus();
  }, [mark]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-600">
          Question {step + 1} of {progress.length}
        </p>
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {progress.map((p, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                p === true ? 'bg-green-600' : p === false ? 'bg-red-600' : i === step ? 'bg-brand' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
      </div>

      <h3 ref={questionRef} tabIndex={-1} className="text-lg font-semibold outline-none">
        {text}
      </h3>

      <ul className="space-y-2" aria-label="Answers">
        {options.map((opt, oi) => {
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
                onClick={() => onChoose(oi)}
                className={`flex min-h-12 w-full items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors disabled:cursor-default ${look}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                    isRight
                      ? 'border-green-600 bg-green-600 text-white'
                      : isWrongPick
                        ? 'border-red-600 bg-red-600 text-white'
                        : 'border-gray-300'
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
              The answer is {LETTERS[mark.correct_index]}: {options[mark.correct_index]}
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
        <button type="button" onClick={onNext} disabled={busy} className={stepButton}>
          {nextLabel}
          {!busy && <span aria-hidden="true">&nbsp;&rarr;</span>}
        </button>
      )}
    </div>
  );
}

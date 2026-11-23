'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { courseApi } from '../../api';

const btn = 'min-h-11 rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50';
const primary = 'min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50';

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    const res = await courseApi(body);
    setBusy(false);
    if (!res.ok) setError(res.error!);
    else router.refresh();
  }
  return { busy, error, run };
}

function Err({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="w-full text-sm text-red-700">
      {text}
    </p>
  ) : null;
}

// The review tick for a lesson's live questions.
export function ReviewControl({
  lessonId,
  reviewedAt,
  needsReview,
}: {
  lessonId: string;
  reviewedAt: string | null;
  needsReview: boolean;
}) {
  const a = useAction();
  if (needsReview) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded bg-amber-50 p-3">
        <p className="text-sm text-amber-900">
          Not reviewed yet. Read every question and answer above, then tick it off. Publishing waits for this.
        </p>
        <button type="button" className={primary} disabled={a.busy}
          onClick={() => a.run({ action: 'lesson.review', lesson_id: lessonId, reviewed: true })}>
          {a.busy ? 'Saving…' : "I've reviewed this lesson"}
        </button>
        <Err text={a.error} />
      </div>
    );
  }
  if (!reviewedAt) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-green-800">
        <span aria-hidden="true">✓ </span>Reviewed {new Date(reviewedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
      </p>
      <button type="button" className={btn} disabled={a.busy}
        onClick={() => a.run({ action: 'lesson.review', lesson_id: lessonId, reviewed: false })}>
        Undo
      </button>
      <Err text={a.error} />
    </div>
  );
}

// A change waiting on a live lesson: swap it in, or throw it away.
export function DraftActions({ lessonId }: { lessonId: string }) {
  const a = useAction();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={primary} disabled={a.busy}
        onClick={() => {
          if (confirm('Swap this change in? Staff will see the new questions straight away.')) {
            a.run({ action: 'draft.apply', lesson_id: lessonId });
          }
        }}>
        {a.busy ? 'Saving…' : "I've reviewed it. Swap it in"}
      </button>
      <button type="button" className={`${btn} text-red-700`} disabled={a.busy}
        onClick={() => {
          if (confirm('Throw this change away? Staff keep the current questions.')) {
            a.run({ action: 'draft.discard', lesson_id: lessonId });
          }
        }}>
        Discard the change
      </button>
      <Err text={a.error} />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { courseApi } from '../../api';

export function PublishButton({
  courseId,
  published,
  blocked,
}: {
  courseId: string;
  published: boolean;
  blocked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(next: boolean) {
    if (!next && !confirm('Unpublish? Staff who have it assigned will stop seeing it until you publish again.')) return;
    setBusy(true);
    setError('');
    const res = await courseApi({ action: 'course.publish', id: courseId, published: next });
    setBusy(false);
    if (!res.ok) setError(res.error!);
    else router.refresh();
  }

  return (
    <>
      {published ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(false)}
          className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Unpublish
        </button>
      ) : (
        <button
          type="button"
          disabled={busy || blocked}
          onClick={() => run(true)}
          className="min-h-11 rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Publishing…' : blocked ? 'Fix the problems above to publish' : 'Publish'}
        </button>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
    </>
  );
}

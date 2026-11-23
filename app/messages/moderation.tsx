'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagesApi, when } from './api';

export type ReportedPost = {
  id: string;
  lesson_id: string;
  lesson_title: string;
  unit_name: string;
  body: string;
  author_name: string | null;
  reported_at: string;
  reported_by_name: string | null;
};

// Posts someone has reported, for the managers and admins over that store.
export function Moderation({ posts }: { posts: ReportedPost[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function act(id: string, what: 'hide' | 'clear') {
    setBusy(id);
    setError('');
    const r = await messagesApi({ action: 'moderate', id, what });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded border border-amber-300 bg-amber-50 p-4" aria-labelledby="reported-heading">
      <h2 id="reported-heading" className="font-semibold text-amber-900">
        Reported posts ({posts.length})
      </h2>
      <p className="text-sm text-amber-900">
        Someone thinks these lesson posts shouldn&apos;t be there. Hide one to take it down, or keep it if it&apos;s fine.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {posts.map((p) => (
          <li key={p.id} className="space-y-2 rounded bg-surface p-3">
            <p className="text-xs text-gray-600">
              {p.author_name ?? 'Someone'} at {p.unit_name}, on{' '}
              <Link href={`/lessons/${p.lesson_id}`} className="underline">
                {p.lesson_title}
              </Link>
              . Reported by {p.reported_by_name ?? 'someone'}, {when(p.reported_at)}.
            </p>
            <p className="whitespace-pre-line">{p.body}</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy === p.id}
                onClick={() => act(p.id, 'hide')}
                className="min-h-11 rounded border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
              >
                Hide it
              </button>
              <button
                type="button"
                disabled={busy === p.id}
                onClick={() => act(p.id, 'clear')}
                className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Keep it
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

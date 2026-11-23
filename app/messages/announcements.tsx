'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagesApi, when } from './api';

export type Announcement = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  important: boolean;
  created_at: string;
  author_name: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
};

// Updates for the person, newest first. Opening the page counts as reading
// them; "Got it" is the acknowledgement managers see in their counts.
export function Announcements({ items }: { items: Announcement[] }) {
  const router = useRouter();
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (items.some((a) => !a.read_at)) {
      // Refresh so the badge in the header drops once they're marked read.
      messagesApi({ action: 'read_all' }).then(() => router.refresh());
    }
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ack(id: string) {
    setError('');
    const r = await messagesApi({ action: 'ack', id });
    if (!r.ok) return setError(r.error);
    setAcked((s) => new Set(s).add(id));
    router.refresh();
  }

  const waiting = items.filter((a) => !a.acknowledged_at && !acked.has(a.id));
  const done = items.filter((a) => a.acknowledged_at || acked.has(a.id));
  const shown = showAll ? done : done.slice(0, 5);

  return (
    <section className="space-y-3" aria-labelledby="updates-heading">
      <h2 id="updates-heading" className="text-lg font-semibold">
        Updates
      </h2>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {items.length === 0 && <p className="text-sm text-gray-600">No updates yet.</p>}

      {waiting.map((a) => (
        <article key={a.id} className="space-y-2 rounded border-l-4 border-brand bg-gray-50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">
              {a.title}
              {a.important && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Important</span>
              )}
            </h3>
            <span className="text-xs text-gray-500">
              {a.author_name ?? 'Someone'}, {when(a.created_at)}
            </span>
          </div>
          <p className="whitespace-pre-line">{a.body}</p>
          {a.link_url && (
            <p>
              <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="break-all text-brand-ink underline">
                {a.link_url}
              </a>
            </p>
          )}
          <button
            type="button"
            onClick={() => ack(a.id)}
            className="min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90"
          >
            Got it
          </button>
        </article>
      ))}

      {done.length > 0 && (
        <ul className="divide-y divide-gray-200 border-y border-gray-200">
          {shown.map((a) => (
            <li key={a.id} className="py-2">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 py-1">
                  <span className="font-medium">{a.title}</span>
                  <span className="text-xs text-gray-500">
                    {a.author_name ?? 'Someone'}, {when(a.created_at)}
                  </span>
                </summary>
                <p className="mt-2 whitespace-pre-line text-sm text-gray-700">{a.body}</p>
                {a.link_url && (
                  <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-sm text-brand-ink underline">
                    {a.link_url}
                  </a>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
      {done.length > 5 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="text-sm text-brand-ink underline">
          Show {done.length - 5} older updates
        </button>
      )}
    </section>
  );
}

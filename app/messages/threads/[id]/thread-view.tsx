'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagesApi, when } from '../../api';

export type Thread = {
  id: string;
  title: string;
  subject_id: string;
  subject_name: string | null;
  unit_name: string | null;
  lesson_id: string | null;
  lesson_title: string | null;
  created_at: string;
  closed: boolean;
  mine: boolean;
  messages: { id: string; body: string; created_at: string; author_name: string; author_role: string | null; mine: boolean }[];
};

const ROLE: Record<string, string> = { manager: 'Manager', admin: 'Head office', viewer: 'Reporting' };

export function ThreadView({ thread: t }: { thread: Thread }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function reply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await messagesApi({ action: 'reply', id: t.id, body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setBody('');
    router.refresh();
  }

  async function close(closed: boolean) {
    setError('');
    const r = await messagesApi({ action: 'close', id: t.id, closed });
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-sm text-gray-600">
          {t.mine ? 'Your conversation with your managers' : `With ${t.subject_name ?? 'someone'}${t.unit_name ? `, ${t.unit_name}` : ''}`}
          {t.lesson_id && (
            <>
              {' '}
              about{' '}
              <Link href={`/lessons/${t.lesson_id}`} className="underline">
                {t.lesson_title}
              </Link>
            </>
          )}
          .
        </p>
        <p className="text-xs text-gray-500">
          {t.mine
            ? 'Only you and the managers above you can see this.'
            : `Only ${t.subject_name ?? 'they'} and the managers over their store can see this.`}
        </p>
      </div>

      <ol className="space-y-3">
        {t.messages.map((m) => (
          <li
            key={m.id}
            className={`max-w-[42rem] rounded p-3 ${m.mine ? 'ml-auto bg-brand-soft' : 'border border-gray-200 bg-gray-50'}`}
          >
            <p className="mb-1 text-xs text-gray-600">
              <span className="font-medium text-gray-800">{m.mine ? 'You' : m.author_name}</span>
              {!m.mine && m.author_role && ROLE[m.author_role] ? ` (${ROLE[m.author_role]})` : ''}, {when(m.created_at)}
            </p>
            <p className="whitespace-pre-line">{m.body}</p>
          </li>
        ))}
      </ol>

      {t.closed && (
        <p className="rounded bg-gray-100 p-3 text-sm text-gray-700">
          This conversation is closed. Replying opens it again.
        </p>
      )}

      <form onSubmit={reply} className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Reply</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={4000}
            className="w-full rounded border border-gray-300 bg-surface px-3 py-2"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Sending...' : 'Send reply'}
          </button>
          {!t.closed ? (
            <button type="button" onClick={() => close(true)} className="min-h-11 px-2 text-sm underline">
              Close conversation
            </button>
          ) : (
            <button type="button" onClick={() => close(false)} className="min-h-11 px-2 text-sm underline">
              Open it again
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

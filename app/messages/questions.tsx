'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagesApi, when } from './api';
import type { Role } from '@/lib/auth';

export type ThreadRow = {
  id: string;
  title: string;
  subject_id: string;
  subject_name: string | null;
  unit_name: string | null;
  lesson_id: string | null;
  lesson_title: string | null;
  created_at: string;
  last_message_at: string;
  last_message_by_name: string | null;
  messages: number;
  unread: boolean;
  waiting: boolean;
  closed: boolean;
  mine: boolean;
};

export type Person = { id: string; full_name: string | null; email: string; unit_id: string | null };

const field = 'w-full rounded border border-gray-300 bg-surface px-3 py-2';

export function Questions({
  threads,
  role,
  placed,
  people,
  lesson,
}: {
  threads: ThreadRow[];
  role: Role;
  placed: boolean;
  people: Person[];
  lesson: { id: string; title: string } | null;
}) {
  const manages = role === 'manager' || role === 'admin';
  const [mode, setMode] = useState<'none' | 'ask' | 'message'>(lesson ? 'ask' : 'none');
  const [filter, setFilter] = useState<'all' | 'waiting' | 'mine'>('all');

  const shown = threads.filter((t) =>
    filter === 'waiting' ? t.waiting && !t.mine : filter === 'mine' ? t.mine : true
  );
  const waitingCount = threads.filter((t) => t.waiting && !t.mine).length;

  return (
    <section className="space-y-3" aria-labelledby="questions-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="questions-heading" className="text-lg font-semibold">
          {manages ? 'Conversations' : 'Questions'}
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode(mode === 'ask' ? 'none' : 'ask')}
            aria-expanded={mode === 'ask'}
            className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            {manages ? 'Ask your own manager' : 'Ask a question'}
          </button>
          {manages && (
            <button
              type="button"
              onClick={() => setMode(mode === 'message' ? 'none' : 'message')}
              aria-expanded={mode === 'message'}
              className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Message someone in your team
            </button>
          )}
        </div>
      </div>

      {mode === 'ask' && <AskForm placed={placed} manages={manages} lesson={lesson} onDone={() => setMode('none')} />}
      {mode === 'message' && <MessageForm people={people} onDone={() => setMode('none')} />}

      {manages && threads.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Show">
          {(
            [
              ['all', 'All'],
              ['waiting', `Waiting for a reply (${waitingCount})`],
              ['mine', 'My own questions'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={`min-h-9 rounded-full border px-3 py-1 ${filter === k ? 'border-brand bg-brand-soft text-brand-ink' : 'border-gray-300'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {threads.length === 0 ? (
        <p className="text-sm text-gray-600">
          {manages
            ? 'No conversations yet. When your team asks a question, it shows up here.'
            : 'No questions yet. Your managers can see what you ask here, and reply.'}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-600">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-gray-200 border-y border-gray-200">
          {shown.map((t) => (
            <li key={t.id}>
              <Link href={`/messages/threads/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 hover:bg-gray-50">
                <span className="min-w-[12rem] flex-1">
                  <span className={`block ${t.unread ? 'font-semibold' : 'font-medium'}`}>
                    {t.unread && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand" aria-label="New" />}
                    {t.title}
                  </span>
                  <span className="block text-sm text-gray-600">
                    {manages && !t.mine ? `${t.subject_name ?? 'Someone'}${t.unit_name ? `, ${t.unit_name}` : ''}` : 'You'}
                    {t.lesson_title ? ` · about "${t.lesson_title}"` : ''}
                  </span>
                </span>
                <span className="text-right text-sm text-gray-600">
                  {t.closed ? (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">Closed</span>
                  ) : t.waiting && !t.mine ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Needs a reply</span>
                  ) : null}
                  <span className="block text-xs text-gray-500">
                    {t.last_message_by_name ?? 'Someone'}, {when(t.last_message_at)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AskForm({
  placed,
  manages,
  lesson,
  onDone,
}: {
  placed: boolean;
  manages: boolean;
  lesson: { id: string; title: string } | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(lesson ? `About "${lesson.title}"` : '');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await messagesApi<string>({ action: 'start_thread', title, body, lesson: lesson?.id ?? null });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone();
    router.push(`/messages/threads/${r.data}`);
  }

  return (
    <form onSubmit={send} className="space-y-3 rounded border border-gray-200 p-4">
      <p className="text-sm text-gray-600">
        {placed
          ? `Your ${manages ? 'managers above you' : 'managers'} will see this and can reply. Other staff can't see it.`
          : 'You aren\'t placed in a store yet, so this goes to head office.'}
      </p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Subject</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required className={field} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Your question</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000} required className={field} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy || !title.trim() || !body.trim()}
          className="min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Sending...' : 'Send'}
        </button>
        <button type="button" onClick={onDone} className="min-h-11 px-2 text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function MessageForm({ people, onDone }: { people: Person[]; onDone: () => void }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [to, setTo] = useState<Person | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return people
      .filter((p) => (p.full_name ?? '').toLowerCase().includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, people]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!to) return setError('Pick who it\'s for.');
    setBusy(true);
    setError('');
    const r = await messagesApi<string>({ action: 'start_thread', title, body, about: to.id });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone();
    router.push(`/messages/threads/${r.data}`);
  }

  return (
    <form onSubmit={send} className="space-y-3 rounded border border-gray-200 p-4">
      <p className="text-sm text-gray-600">
        They&apos;ll get an email, and can reply here. Managers above them can see it too. It isn&apos;t a private chat.
      </p>
      {to ? (
        <p className="flex items-center gap-3 text-sm">
          <span>
            To: <span className="font-medium">{to.full_name ?? to.email}</span>
          </span>
          <button type="button" onClick={() => setTo(null)} className="underline">
            Change
          </button>
        </p>
      ) : (
        <div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Who to</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              className={field}
            />
          </label>
          {matches.length > 0 && (
            <ul className="mt-1 divide-y divide-gray-100 rounded border border-gray-200">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setTo(p)}
                    className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    {p.full_name ?? p.email} <span className="text-gray-500">{p.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Subject</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required className={field} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Message</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000} required className={field} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy || !to || !title.trim() || !body.trim()}
          className="min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Sending...' : 'Send'}
        </button>
        <button type="button" onClick={onDone} className="min-h-11 px-2 text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

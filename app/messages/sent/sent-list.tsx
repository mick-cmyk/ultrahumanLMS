'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagesApi, when } from '../api';

export type SentRow = {
  id: string;
  title: string;
  created_at: string;
  author_name: string | null;
  audience_label: string | null;
  important: boolean;
  recipients: number;
  read: number;
  acknowledged: number;
  mine: boolean;
};

type Outstanding = { user_id: string; full_name: string | null; email: string; unit_name: string | null; read_at: string | null };

export function SentList({ rows }: { rows: SentRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-gray-600">Nothing sent yet.</p>;
  return (
    <ul className="divide-y divide-gray-200 border-y border-gray-200">
      {rows.map((r) => (
        <SentItem key={r.id} row={r} />
      ))}
    </ul>
  );
}

function SentItem({ row: r }: { row: SentRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Outstanding[] | null>(null);
  const [error, setError] = useState('');
  const pct = r.recipients ? Math.round((r.acknowledged / r.recipients) * 100) : 0;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !list) {
      const res = await messagesApi<Outstanding[]>({ action: 'outstanding', id: r.id });
      if (!res.ok) setError(res.error);
      else setList(res.data);
    }
  }

  async function remove() {
    if (!confirm(`Take down "${r.title}"? It disappears from everyone's Messages, and emails that haven't gone yet are stopped.`)) return;
    const res = await messagesApi({ action: 'delete_announcement', id: r.id });
    if (!res.ok) return setError(res.error);
    router.refresh();
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-[12rem] flex-1">
          <p className="font-medium">
            {r.title}
            {r.important && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Emailed</span>
            )}
          </p>
          <p className="text-sm text-gray-600">
            {r.audience_label ?? 'Picked people'} · {when(r.created_at)}
            {!r.mine && r.author_name ? ` · from ${r.author_name}` : ''}
          </p>
        </div>
        <div className="w-48 text-sm">
          <p>
            <span className="font-medium">{r.acknowledged}</span> of {r.recipients} said &quot;Got it&quot;
          </p>
          <div className="mt-1 h-2 overflow-hidden rounded bg-gray-200" aria-hidden>
            <div className={`h-full ${pct === 100 ? 'bg-green-600' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-gray-500">{r.read} opened Messages</p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          {open ? 'Close' : 'Who hasn\'t'}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-2 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          {list === null && !error && <p className="text-gray-500">Loading...</p>}
          {list && list.length === 0 && <p className="text-green-800">Everyone has said &quot;Got it&quot;.</p>}
          {list && list.length > 0 && (
            <ul className="space-y-1">
              {list.map((p) => (
                <li key={p.user_id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {p.full_name ?? p.email}
                    {p.unit_name && <span className="text-gray-500">, {p.unit_name}</span>}
                  </span>
                  <span className="text-xs text-gray-500">{p.read_at ? 'Opened it, no "Got it" yet' : 'Not opened'}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={remove} className="text-sm text-red-700 underline">
            Take this update down
          </button>
        </div>
      )}
    </li>
  );
}

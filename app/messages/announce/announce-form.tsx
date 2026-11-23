'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { levelLabel, type Unit } from '@/lib/units';
import { messagesApi } from '../api';

type TreeUnit = Unit & { depth: number };
const field = 'w-full rounded border border-gray-300 bg-surface px-3 py-2';

export function AnnounceForm({ units, isAdmin }: { units: TreeUnit[]; isAdmin: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [everyone, setEveryone] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [important, setImportant] = useState(false);
  const [reach, setReach] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rule = useMemo(() => ({ all: everyone, unit_ids: everyone ? [] : [...picked] }), [everyone, picked]);
  const ruleKey = JSON.stringify(rule);
  const label = everyone
    ? isAdmin
      ? 'Everyone'
      : 'Everyone in my area'
    : units
        .filter((u) => picked.has(u.id))
        .map((u) => u.name)
        .join(', ')
        .slice(0, 200);

  useEffect(() => {
    if (!everyone && picked.size === 0) {
      setReach(0);
      return;
    }
    setReach(null);
    const t = setTimeout(async () => {
      const r = await messagesApi<number>({ action: 'reach', rule });
      setReach(r.ok ? r.data : null);
    }, 300);
    return () => clearTimeout(t);
    // ruleKey covers rule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleKey]);

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await messagesApi<{ recipients: number; emails: number; send_after: string | null }>({
      action: 'announce',
      title,
      body,
      link,
      rule,
      label,
      important,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push('/messages/sent');
    router.refresh();
  }

  return (
    <form onSubmit={send} className="space-y-5">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          placeholder="For example: New returns policy from Monday"
          className={field}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Message</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={4000} required className={field} />
        <span className="mt-1 block text-xs text-gray-500">Keep it short. Most people read these on their phone.</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Link (optional)</span>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          type="url"
          placeholder="https://..."
          className={field}
        />
      </label>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">Who it goes to</legend>
        <label className="flex items-center gap-3">
          <input type="radio" name="who" checked={everyone} onChange={() => setEveryone(true)} className="h-5 w-5" />
          <span>{isAdmin ? 'Everyone' : 'Everyone in my area'}</span>
        </label>
        <label className="flex items-center gap-3">
          <input type="radio" name="who" checked={!everyone} onChange={() => setEveryone(false)} className="h-5 w-5" />
          <span>Pick places</span>
        </label>
        {!everyone && (
          <div className="max-h-72 overflow-y-auto rounded border border-gray-200 p-2">
            <p className="mb-1 px-1 text-xs text-gray-500">Ticking a place includes everyone under it.</p>
            {units.map((u) => (
              <label key={u.id} className="flex min-h-9 items-center gap-2" style={{ paddingLeft: `${u.depth * 1.25}rem` }}>
                <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4" />
                <span className="text-sm">
                  {u.name} <span className="text-gray-500">({levelLabel(u.kind)})</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="text-sm text-gray-700" aria-live="polite">
          {reach === null ? 'Counting...' : `Goes to ${reach} ${reach === 1 ? 'person' : 'people'}.`}
        </p>
      </fieldset>

      <label className="flex items-start gap-3">
        <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} className="mt-1 h-5 w-5" />
        <span>
          <span className="block text-sm font-medium">Important: email it as well</span>
          <span className="block text-sm text-gray-600">
            Emails only go out between 8am and 8pm (Sydney time). Anything sent later goes at 8am. Use this for things
            people must know, not everyday news.
          </span>
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !title.trim() || !body.trim() || !reach}
        className="min-h-11 rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Sending...' : 'Send update'}
      </button>
    </form>
  );
}

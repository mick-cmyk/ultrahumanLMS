'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type Pending = {
  id: string;
  email: string;
  full_name: string;
  unit_name: string;
  note: string | null;
  created_at: string;
  role_choices: string[];
};

const ROLE_LABEL: Record<string, string> = {
  learner: 'Learner (does the training)',
  viewer: 'Viewer (reads reports for this place)',
  manager: 'Manager (reports, adds and removes staff here)',
  admin: 'Admin (everything)',
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function ApprovalsClient({ pending }: { pending: Pending[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});

  async function decide(p: Pending, action: 'approve' | 'decline') {
    if (action === 'decline' && !confirm(`Decline ${p.full_name}? They won't get a login.`)) return;
    setBusy(p.id);
    setMsg(null);
    try {
      const res = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id: p.id, role: roles[p.id] ?? 'learner' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: body.error ?? 'Something went wrong.' });
      else {
        setMsg({
          ok: true,
          text:
            action === 'decline'
              ? `${p.full_name} was declined.`
              : body.role_applied === false && (roles[p.id] ?? 'learner') !== 'learner'
                ? `${p.full_name} is in. They already had a login, so their role hasn't changed. Change it on the People page if needed.`
                : `${p.full_name} is in as a ${roles[p.id] ?? 'learner'}. We've emailed them to say they can log in.`,
        });
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {msg && (
        <p role="status" className={`rounded p-3 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </p>
      )}
      {pending.length === 0 ? (
        <p className="rounded border border-gray-200 p-4 text-gray-600">Nobody is waiting right now.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 p-4">
              <div>
                <div className="font-medium">{p.full_name}</div>
                <div className="text-sm text-gray-600">{p.email}</div>
                <div className="text-sm text-gray-600">
                  {p.unit_name}, asked {when(p.created_at)}
                </div>
                {p.note && (
                  <blockquote className="mt-2 border-l-2 border-gray-300 pl-3 text-sm text-gray-700">{p.note}</blockquote>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {p.role_choices.length > 1 && (
                  <label className="text-sm">
                    <span className="sr-only">Role for {p.full_name}</span>
                    <select
                      value={roles[p.id] ?? 'learner'}
                      onChange={(e) => setRoles({ ...roles, [p.id]: e.target.value })}
                      className="min-h-11 rounded border border-gray-300 bg-surface px-2 py-2"
                    >
                      {p.role_choices.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r] ?? r}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => decide(p, 'approve')}
                  className="min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
                >
                  {busy === p.id ? 'Saving...' : 'Approve'}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => decide(p, 'decline')}
                  className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm text-red-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type DeveloperRequest = { id: string; requested_by_name: string | null; reason: string | null; created_at: string };

// For the developer only: an admin has asked to remove their developer access.
export function DeveloperRequests({ requests }: { requests: DeveloperRequest[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function decide(id: string, approve: boolean) {
    if (approve && !confirm('Give up your developer access? You stay an admin, but other admins will then be able to change or remove your account.')) return;
    setBusy(id);
    setError('');
    try {
      const res = await fetch('/api/developer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decide', id, approve }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? 'Could not save that.');
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 rounded border border-amber-300 bg-amber-50 p-4" aria-labelledby="dev-req-heading">
      <h2 id="dev-req-heading" className="font-semibold text-amber-900">
        Someone wants to remove your developer access
      </h2>
      {requests.map((r) => (
        <div key={r.id} className="space-y-2 rounded bg-surface p-3 text-sm">
          <p>
            <span className="font-medium">{r.requested_by_name ?? 'An admin'}</span> asked on{' '}
            {new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>
          {r.reason && <p className="whitespace-pre-line">Reason: {r.reason}</p>}
          <p className="text-gray-600">Nothing changes unless you approve. Declining keeps everything as it is.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => decide(r.id, false)}
              className="min-h-11 rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            >
              Decline, keep my access
            </button>
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => decide(r.id, true)}
              className="min-h-11 rounded border border-red-300 px-4 py-2 text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

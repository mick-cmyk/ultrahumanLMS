'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function StartButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/retest/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          body.error ??
            (body.reason === 'used'
              ? 'This link has already been used. Log in to carry on.'
              : 'That link has stopped working. Log in to carry on.')
        );
        return;
      }
      router.replace('/retest');
      router.refresh();
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={start}
        disabled={busy}
        className="rounded bg-brand hover:opacity-90 px-5 py-3 font-medium text-brand-fg disabled:opacity-50"
      >
        {busy ? 'Starting...' : 'Start the check'}
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

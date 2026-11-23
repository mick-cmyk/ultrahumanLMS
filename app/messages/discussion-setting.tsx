'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { messagesApi } from './api';

// Admin switch for lesson discussions. For now "on" means each store or
// branch talks among itself (plus the managers above it).
export function DiscussionSetting({ mode }: { mode: string }) {
  const router = useRouter();
  const [on, setOn] = useState(mode === 'unit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function change(next: boolean) {
    setBusy(true);
    setError('');
    const r = await messagesApi({ action: 'discussion_mode', mode: next ? 'unit' : 'off' });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOn(next);
    router.refresh();
  }

  return (
    <section className="space-y-2 rounded border border-gray-200 p-4" aria-labelledby="discussion-heading">
      <h2 id="discussion-heading" className="font-semibold">
        Lesson discussions
      </h2>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={on}
          disabled={busy}
          onChange={(e) => change(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium">Let staff talk about each lesson with their own store or branch</span>
          <span className="block text-sm text-gray-600">
            A discussion box appears under every lesson. Staff only see posts from their own store or branch, never
            another store or another retailer. Managers above them can see, pin and hide posts, and anyone can report
            one. There are no private messages.
          </span>
        </span>
      </label>
      {busy && <p className="text-sm text-gray-500">Saving...</p>}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

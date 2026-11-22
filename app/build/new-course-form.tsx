'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { courseApi } from './api';

export function NewCourseForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Give the course a title.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await courseApi({ action: 'course.create', title });
    setBusy(false);
    if (!res.ok) setError(res.error!);
    else router.push(`/build/${res.id}`);
  }

  return (
    <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded border border-gray-200 p-4">
      <label className="block min-w-0 flex-1">
        <span className="mb-1 block text-sm font-medium">New course title</span>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError('');
          }}
          placeholder="For example: Manual handling refresher"
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create course'}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}

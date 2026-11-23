'use client';

import { useState } from 'react';
import Link from 'next/link';

type Place = { id: string; name: string; depth?: number };

// Self-registration form. With a sign-up link the place is fixed (`place`);
// on the general page the person picks it (`places`).
export function RegisterForm({ code, place, places }: { code?: string; place?: Place; places?: Place[] }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [unitId, setUnitId] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'pending' | 'approved' | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Type your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("That email address doesn't look right.");
    if (!place && !unitId) return setError('Choose where you work.');
    setBusy(true);
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, unit_id: place ? undefined : unitId, full_name: name, email, website }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? 'Something went wrong. Try again in a minute.');
      else setDone(body.status === 'approved' ? 'approved' : 'pending');
    } catch {
      setError('Something went wrong. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done === 'approved') {
    return (
      <div role="status" className="space-y-3 rounded border border-green-300 bg-green-50 p-4 text-green-800">
        <h2 className="text-lg font-semibold">You&apos;re in</h2>
        <p>Log in with {email.trim()} and we&apos;ll email you a link to tap. There&apos;s no password.</p>
        <Link href="/login" className="inline-block rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90">
          Log in
        </Link>
      </div>
    );
  }
  if (done === 'pending') {
    return (
      <div role="status" className="space-y-2 rounded border border-gray-200 p-4">
        <h2 className="text-lg font-semibold">Thanks, {name.trim().split(' ')[0]}</h2>
        <p className="text-gray-700">
          Your request has gone to your manager. Once they approve it, we&apos;ll email {email.trim()} to say you can log in.
        </p>
      </div>
    );
  }

  const input = 'w-full rounded border border-gray-300 bg-surface px-3 py-2';
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {place && (
        <p className="rounded bg-brand-soft p-3 text-sm">
          You&apos;re signing up for <span className="font-medium">{place.name}</span>.
        </p>
      )}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Full name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Work email</span>
        <span className="mb-1 block text-sm text-gray-600">You&apos;ll use this to log in.</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={input} />
      </label>
      {!place && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Where you work</span>
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={input}>
            <option value="">Choose...</option>
            {(places ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {'  '.repeat(p.depth ?? 0)}
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* Trap for bots: hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Sending...' : 'Ask for access'}
      </button>
      <p className="text-sm text-gray-600">
        Already signed up?{' '}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

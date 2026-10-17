'use client';

import { getBrand } from '@/brands';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const brand = getBrand();

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  );
  const [errorMessage, setErrorMessage] = useState('');
  const linkError = searchParams.get('error');

  // Some magic links come back with the session in the URL fragment (the
  // implicit flow) rather than as a ?code= (PKCE). The server can't see a
  // fragment, so those land here logged-out. Instantiating the browser client
  // lets it read the fragment and persist the session, then we continue on.
  useEffect(() => {
    if (!window.location.hash.includes('access_token')) return;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        window.history.replaceState(null, '', window.location.pathname);
        router.replace('/');
        router.refresh();
      }
    });
  }, [router]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Accounts are created by your manager or the admin, never here.
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setStatus('error');
      setErrorMessage(
        /not found|signups not allowed/i.test(error.message)
          ? "We couldn't find that email. Check the spelling, or ask your manager to add you."
          : 'Something went wrong sending your link. Try again in a minute.'
      );
      return;
    }
    setStatus('sent');
  }

  if (status === 'sent') {
    return (
      <div className="mt-10 space-y-2">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-gray-600">
          We&apos;ve sent a login link to <strong>{email}</strong>. Tap it on
          this device and you&apos;re in. No password needed.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-10 max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Log in to {brand.name}</h1>
      <p className="text-gray-600">
        Enter your work email and we&apos;ll send you a login link.
      </p>
      {linkError && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          That login link has expired or was already used. Enter your email to
          get a fresh one.
        </p>
      )}
      <form onSubmit={sendLink} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Email</span>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={status === 'sending'}
          className="w-full rounded bg-brand hover:opacity-90 px-4 py-2 font-medium text-brand-fg disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : 'Send me a login link'}
        </button>
      </form>
      {status === 'error' && (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

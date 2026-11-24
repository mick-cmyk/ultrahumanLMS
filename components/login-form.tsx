'use client';

import { getBrand } from '@/brands';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

const brand = getBrand();

type Props = {
  /** Focus the email box on load. True on /login, false on the landing page. */
  autoFocus?: boolean;
  /** Heading level and wording differ between the full page and the landing card. */
  variant?: 'page' | 'card';
  /** The general sign-up page is on: offer it to an email with no account. */
  signupOpen?: boolean;
};

function Form({ autoFocus = false, variant = 'page', signupOpen = false }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error' | 'unknown' | 'wait'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // Seconds left before another link can be asked for. The sign-in service
  // allows one link per email address a minute.
  const [wait, setWait] = useState(0);
  const linkError = searchParams.get('error');
  const Heading = variant === 'page' ? 'h1' : 'h2';

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

  // Count the wait down once a second; the message updates as it goes.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    // Demo accounts use .invalid addresses, which can never receive email.
    // Sending would only bounce and hurt the sending domain, so stop here.
    if (/\.invalid$/i.test(email.trim())) {
      setStatus('error');
      setErrorMessage("That's a demo account, so it can't get email. Ask whoever gave you the demo for a login link.");
      return;
    }
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
      if (/not found|signups not allowed/i.test(error.message)) {
        setStatus('unknown');
        return;
      }
      // Asked again too soon: one link per email address a minute.
      const seconds = error.message.match(/after (\d+) seconds?/i);
      if (seconds) {
        setStatus('wait');
        setWait(Number(seconds[1]));
        return;
      }
      setStatus('error');
      setErrorMessage(
        error.status === 429
          ? 'A lot of login emails have gone out in the last hour. Wait a few minutes, then try again.'
          : 'Something went wrong sending your link. Try again in a minute.'
      );
      return;
    }
    setStatus('sent');
  }

  if (status === 'sent') {
    return (
      <div className="space-y-2" role="status">
        <Heading className="text-xl font-semibold">Check your email</Heading>
        <p className="text-gray-600">
          We&apos;ve sent a login link to <strong>{email}</strong>. Tap it on this device and
          you&apos;re in. No password needed.
        </p>
        <p className="text-sm text-gray-500">
          Not there after a minute? Check your junk or spam folder. You can ask for a new link once a minute.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Heading className="text-xl font-semibold">
          {variant === 'page' ? `Log in to ${brand.name}` : 'Already on the team? Log in'}
        </Heading>
        <p className="text-gray-600">Enter your work email and we&apos;ll send you a login link.</p>
      </div>
      {linkError && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          That login link has expired or was already used. Enter your email to get a fresh one.
        </p>
      )}
      <form onSubmit={sendLink} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Email</span>
          <input
            id={`login-email-${variant}`}
            type="email"
            required
            autoFocus={autoFocus}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded border border-gray-300 bg-surface px-3 py-2.5"
          />
        </label>
        <button
          type="submit"
          disabled={status === 'sending' || (status === 'wait' && wait > 0)}
          className="w-full rounded bg-brand px-4 py-2.5 font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : status === 'wait' && wait > 0 ? `Try again in ${wait}s` : 'Send me a login link'}
        </button>
      </form>
      {status === 'unknown' && (
        <div role="alert" className="space-y-3 rounded bg-amber-50 p-3 text-sm text-amber-800">
          {signupOpen ? (
            <>
              <p>
                There&apos;s no account for <strong>{email.trim()}</strong> yet. Check the spelling, or ask for access
                and tell us where you work.
              </p>
              <Link
                href="/register"
                onClick={() => {
                  // Carry the email over without putting it in the address bar.
                  try {
                    sessionStorage.setItem('signup-email', email.trim());
                  } catch {
                    /* storage blocked: they type it again */
                  }
                }}
                className="inline-block rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90"
              >
                Ask for access
              </Link>
            </>
          ) : (
            <p>We couldn&apos;t find that email. Check the spelling, or ask your manager to add you.</p>
          )}
        </div>
      )}
      {status === 'wait' && (
        <div className="space-y-1 rounded bg-amber-50 p-3 text-sm text-amber-800">
          {/* Only this line is announced; the ticking countdown below is not. */}
          <p role="alert" className="font-medium">A login link was sent to this email less than a minute ago.</p>
          <p>
            Check your inbox and junk folder first, it may already be there.{' '}
            {wait > 0
              ? `For safety, you can ask for a new one in ${wait} second${wait === 1 ? '' : 's'}.`
              : 'You can ask for a new one now.'}
          </p>
        </div>
      )}
      {status === 'error' && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

export function LoginForm(props: Props) {
  return (
    <Suspense>
      <Form {...props} />
    </Suspense>
  );
}

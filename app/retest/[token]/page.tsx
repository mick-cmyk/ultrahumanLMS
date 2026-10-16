import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { StartButton } from './start-button';

// Landing page for the emailed re-test link. Reading this page changes
// nothing: it never spends the token or logs anyone in. Mail scanners and link
// previews fetch URLs, so the session is only created when a person presses
// Start, which posts to /api/retest/start.
const STOPPED: Record<string, string> = {
  not_found: "This re-test link isn't valid. It may have been mistyped.",
  used: 'This link has already been used. Log in to carry on.',
  expired: 'This re-test link has expired. Log in and check your training for the latest one.',
  already_passed: "You've already passed this re-test. You're all set.",
  inactive: 'This account is switched off. Ask your manager.',
  not_learner: 'This link is for staff training only. Use the login page.',
};

export default async function RetestLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Already logged in on this device? Skip the button and go straight in.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/retest');

  const service = createServiceClient();
  const { data: check } = await service.rpc('check_retest_token', { p_token: token });

  if (!check?.valid) {
    const reason = (check?.reason as string) ?? 'not_found';
    return (
      <div className="mx-auto max-w-lg space-y-3 py-6">
        <h1 className="text-xl font-semibold">Re-test</h1>
        <p className="rounded border border-gray-200 bg-gray-50 p-4 text-gray-700">
          {STOPPED[reason] ?? STOPPED.not_found}
        </p>
        <Link href="/login" className="text-sm underline">
          Go to the login page
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 py-6">
      <h1 className="text-xl font-semibold">Your quick check is ready</h1>
      <p className="text-gray-600">
        A few questions to lock in what you learned. It takes about two minutes
        and you do not need to log in.
      </p>
      <StartButton token={token} />
    </div>
  );
}

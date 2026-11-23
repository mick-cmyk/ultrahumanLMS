import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { SentList, type SentRow } from './sent-list';

export const metadata = { title: 'Sent updates' };

export default async function SentPage() {
  const profile = await requireRole(['manager', 'admin']);
  const supabase = await createClient();
  const { data } = await supabase.rpc('sent_announcements', { p_limit: 100 });

  return (
    <div className="space-y-4">
      <Link href="/messages" className="text-sm text-gray-500 underline">
        &larr; Messages
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Sent updates</h1>
          <p className="text-gray-600">
            {profile.role === 'admin' ? 'Every update, from anyone.' : 'Updates you have sent.'} &quot;Got it&quot; means
            they&apos;ve read it and said so.
          </p>
        </div>
        <Link
          href="/messages/announce"
          className="inline-flex min-h-11 items-center rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90"
        >
          Send an update
        </Link>
      </div>
      <SentList rows={(data ?? []) as SentRow[]} />
    </div>
  );
}

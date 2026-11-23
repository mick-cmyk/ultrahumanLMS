import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ThreadView, type Thread } from './thread-view';

export const metadata = { title: 'Conversation' };

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['learner', 'viewer', 'manager', 'admin']);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  // get_thread refuses anyone who can't see it, and marks it read.
  const { data, error } = await supabase.rpc('get_thread', { p_id: id });
  if (error || !data) notFound();

  return (
    <div className="space-y-4">
      <Link href="/messages" className="text-sm text-gray-500 underline">
        &larr; Messages
      </Link>
      <ThreadView thread={data as Thread} />
    </div>
  );
}

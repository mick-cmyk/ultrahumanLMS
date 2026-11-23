import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { orderTree, type Unit } from '@/lib/units';
import { AnnounceForm } from './announce-form';

export const metadata = { title: 'Send an update' };

export default async function AnnouncePage() {
  const profile = await requireRole(['manager', 'admin']);
  const supabase = await createClient();

  const [{ data: units }, { data: scopes }] = await Promise.all([
    supabase.from('units').select('id, parent_id, kind, name, state, suburb, path, active'),
    supabase.from('user_scopes').select('unit_id').eq('user_id', profile.id),
  ]);

  // A manager picks from the places they manage (and everything under them);
  // RLS also shows them the names of the units above, which they can't target.
  let tree = orderTree(((units ?? []) as Unit[]).filter((u) => u.active !== false));
  if (profile.role === 'manager') {
    const mine = new Set((scopes ?? []).map((s) => s.unit_id as string));
    tree = tree.filter((u) => (u.path ?? []).some((p) => mine.has(p)));
    const minDepth = Math.min(...tree.map((u) => u.depth));
    tree = tree.map((u) => ({ ...u, depth: u.depth - minDepth }));
  }

  return (
    <div className="space-y-4">
      <Link href="/messages" className="text-sm text-gray-500 underline">
        &larr; Messages
      </Link>
      <div>
        <h1 className="text-xl font-semibold">Send an update</h1>
        <p className="text-gray-600">
          It appears in Messages for everyone you pick, and they tap &quot;Got it&quot; once they&apos;ve read it. You
          can see who hasn&apos;t under Sent updates.
        </p>
      </div>
      <AnnounceForm units={tree} isAdmin={profile.role === 'admin'} />
    </div>
  );
}

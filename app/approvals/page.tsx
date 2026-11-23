import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ApprovalsClient, type Pending } from './approvals-client';

export const metadata = { title: 'Approvals' };

// Sign-up requests the caller may decide: admins see all, manager-approvers
// see their own places (pending_registrations decides).
export default async function ApprovalsPage() {
  const profile = await requireRole(['admin', 'manager']);
  const supabase = await createClient();
  const [{ data }, { data: me }] = await Promise.all([
    supabase.rpc('pending_registrations'),
    supabase.from('users').select('is_approver').eq('id', profile.id).single(),
  ]);
  const pending = (data ?? []) as Pending[];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="text-gray-600">
          People who have asked to join. Approve someone and they get an email saying they can log in.
        </p>
      </div>
      {profile.role === 'manager' && !me?.is_approver ? (
        <p className="rounded border border-gray-200 p-4 text-gray-700">
          You&apos;re not an approver, so sign-up requests don&apos;t come to you. An admin can make you one on the People page.
        </p>
      ) : (
        <ApprovalsClient pending={pending} />
      )}
    </div>
  );
}

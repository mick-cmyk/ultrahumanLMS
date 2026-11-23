import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { orderTree, type Unit } from '@/lib/units';
import { PeopleClient } from './people-client';
import { SignupPanel } from './signup-panel';

export default async function PeoplePage() {
  const profile = await requireRole(['admin']);
  const supabase = await createClient();

  const [{ data: users }, { data: units }, { data: scopes }, { data: settings }, { data: pending }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, active, unit_id, is_approver')
      .order('full_name'),
    supabase.from('units').select('id, parent_id, kind, name, state, suburb, path, active, signup_code'),
    supabase.from('user_scopes').select('user_id, unit_id'),
    supabase.rpc('registration_settings'),
    supabase.rpc('pending_registrations'),
  ]);
  const reg = (settings ?? {}) as { general?: boolean; auto_approve?: boolean };
  const approverCount = (users ?? []).filter(
    (u) => u.active && u.is_approver && (u.role === 'admin' || u.role === 'manager')
  ).length;

  const tree = orderTree((units ?? []) as Unit[]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">People</h1>
        <p className="text-gray-600">
          Everyone in the system. Add someone, import a list, change roles, choose what a
          viewer or manager can see, or deactivate someone who&apos;s left.
        </p>
      </div>
      <SignupPanel
        units={tree}
        general={reg.general === true}
        autoApprove={reg.auto_approve === true}
        pendingCount={(pending ?? []).length}
        approverCount={approverCount}
      />
      <PeopleClient
        me={profile.id}
        users={users ?? []}
        units={tree}
        scopes={scopes ?? []}
      />
    </div>
  );
}

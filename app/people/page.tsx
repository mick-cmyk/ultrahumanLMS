import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { orderTree, type Unit } from '@/lib/units';
import { PeopleClient } from './people-client';

export default async function PeoplePage() {
  const profile = await requireRole(['admin']);
  const supabase = await createClient();

  const [{ data: users }, { data: units }, { data: scopes }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, active, unit_id')
      .order('full_name'),
    supabase.from('units').select('id, parent_id, kind, name, state, suburb, path, active'),
    supabase.from('user_scopes').select('user_id, unit_id'),
  ]);

  const tree = orderTree((units ?? []) as Unit[]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">People</h1>
        <p className="text-gray-600">
          Everyone in the system. Import a list, change roles, choose what a
          viewer or manager can see, or deactivate someone who&apos;s left.
        </p>
      </div>
      <PeopleClient
        me={profile.id}
        users={users ?? []}
        units={tree}
        scopes={scopes ?? []}
      />
    </div>
  );
}

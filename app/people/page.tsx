import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PeopleClient } from './people-client';

export default async function PeoplePage() {
  await requireRole(['admin']);
  const supabase = await createClient();

  const [{ data: users }, { data: orgs }, { data: stores }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name, email, role, active, org_id, store_id')
      .order('full_name'),
    supabase.from('orgs').select('id, name').order('name'),
    supabase.from('stores').select('id, name, state, org_id').order('name'),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">People</h1>
        <p className="text-gray-600">
          Everyone in the system. Import a list, change roles, or deactivate
          someone who&apos;s left.
        </p>
      </div>
      <PeopleClient
        users={users ?? []}
        orgs={orgs ?? []}
        stores={stores ?? []}
      />
    </div>
  );
}

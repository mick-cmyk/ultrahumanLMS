import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { StructureClient } from './structure-client';

export default async function StructurePage() {
  await requireRole(['admin']);
  const supabase = await createClient();

  const [{ data: groups }, { data: orgs }, { data: stores }] = await Promise.all([
    supabase.from('groups').select('id, name').order('name'),
    supabase
      .from('orgs')
      .select('id, name, type, group_id, logo_url, brand_color')
      .order('name'),
    supabase.from('stores').select('id, name, state, suburb, org_id').order('name'),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Structure</h1>
        <p className="text-gray-600">
          Groups, orgs, and stores. Onboarding a new coordinator company is:
          create a group, add its orgs, invite a coordinator.
        </p>
      </div>
      <StructureClient
        groups={groups ?? []}
        orgs={orgs ?? []}
        stores={stores ?? []}
      />
    </div>
  );
}

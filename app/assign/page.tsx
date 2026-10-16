import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AssignForm } from './assign-form';

export default async function AssignPage() {
  await requireRole(['admin']);
  const supabase = await createClient();

  const [{ data: courses }, { data: orgs }, { data: stores }, { data: users }] =
    await Promise.all([
      supabase.from('courses').select('id, title, published').order('title'),
      supabase.from('orgs').select('id, name').order('name'),
      supabase.from('stores').select('id, name, state, org_id').order('name'),
      supabase
        .from('users')
        .select('id, full_name, email, org_id, store_id')
        .eq('active', true)
        .order('full_name'),
    ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Assign a course</h1>
        <p className="text-gray-600">
          Target by org, state, and store, then fine-tune with individuals. The
          reach updates as you go.
        </p>
      </div>
      <AssignForm
        courses={courses ?? []}
        orgs={orgs ?? []}
        stores={stores ?? []}
        users={users ?? []}
      />
    </div>
  );
}

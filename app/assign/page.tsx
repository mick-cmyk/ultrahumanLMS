import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { orderTree, type Unit } from '@/lib/units';
import { AssignForm } from './assign-form';

export default async function AssignPage() {
  await requireRole(['admin']);
  const supabase = await createClient();

  const [{ data: courses }, { data: units }, { data: users }] = await Promise.all([
    supabase.from('courses').select('id, title, published').order('title'),
    supabase.from('units').select('id, parent_id, kind, name, state, suburb, path, active'),
    supabase
      .from('users')
      .select('id, full_name, email, unit_id')
      .eq('active', true)
      .order('full_name'),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Assign a course</h1>
        <p className="text-gray-600">
          Pick where it goes. Choosing a unit includes everything beneath it.
          Fine-tune with individuals. The reach updates as you go.
        </p>
      </div>
      <AssignForm
        courses={courses ?? []}
        units={orderTree((units ?? []) as Unit[])}
        users={users ?? []}
      />
    </div>
  );
}

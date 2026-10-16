import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { orderTree, type Unit } from '@/lib/units';
import { StructureClient } from './structure-client';

export default async function StructurePage() {
  await requireRole(['admin']);
  const supabase = await createClient();

  const [{ data: units }, { data: people }] = await Promise.all([
    supabase
      .from('units')
      .select('id, parent_id, kind, name, state, suburb, logo_url, brand_color, path, active'),
    supabase.from('users').select('unit_id').eq('active', true),
  ]);

  const counts: Record<string, number> = {};
  for (const p of people ?? []) {
    if (p.unit_id) counts[p.unit_id] = (counts[p.unit_id] ?? 0) + 1;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Structure</h1>
        <p className="text-gray-600">
          Your supplier at the top, then retail brands, regions and stores
          beneath. Staff can sit at any level, so a person with no retail
          partner can sit straight under the supplier.
        </p>
      </div>
      <StructureClient units={orderTree((units ?? []) as Unit[])} counts={counts} />
    </div>
  );
}

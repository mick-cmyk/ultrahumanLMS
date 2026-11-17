import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ScormImport } from './scorm-import';

export const metadata = { title: 'Import SCORM' };

// Admin only: bring in a SCORM 1.2 package as a lesson. The zip is unpacked in
// the browser and each file goes straight to storage under the admin's own
// session, so there's no server upload limit and no service role involved.
export default async function ImportPage() {
  const profile = await requireRole(['admin']);
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from('courses')
    .select('id, title, published, modules(id, title, sort_order)')
    .order('title');

  const options = (courses ?? []).map((c) => ({
    id: c.id as string,
    title: c.title as string,
    published: Boolean(c.published),
    modules: ((c.modules as { id: string; title: string; sort_order: number }[] | null) ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({ id: m.id, title: m.title })),
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Import a SCORM package</h1>
        <p className="mt-1 text-sm text-gray-600">
          Bring in a SCORM 1.2 zip as a lesson. Staff take it inside the app, and it counts as done
          when the package reports passed or completed. SCORM lessons don&apos;t add questions to the
          week-later check.
        </p>
      </div>
      <ScormImport courses={options} userId={profile.id} />
    </div>
  );
}

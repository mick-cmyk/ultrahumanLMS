import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { levelLabel } from '@/lib/units';

type Ancestor = { id: string; name: string; kind: string; depth: number };
type Row = {
  user_id: string;
  email: string;
  full_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  state: string | null;
  ancestors: Ancestor[];
  completed: boolean;
  retention_verified: boolean;
};

type Agg = { key: string; label: string; assigned: number; completed: number; verified: number };

function groupBy(rows: Row[], keyFn: (r: Row) => [string, string] | null): Agg[] {
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    const [key, label] = k;
    const a = map.get(key) ?? { key, label, assigned: 0, completed: 0, verified: 0 };
    a.assigned++;
    if (r.completed) a.completed++;
    if (r.retention_verified) a.verified++;
    map.set(key, a);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function GroupTable({ title, rows }: { title: string; rows: Agg[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-medium text-gray-700">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 pr-4">Group</th>
              <th className="py-2 pr-4">Assigned</th>
              <th className="py-2 pr-4">Completed</th>
              <th className="py-2 pr-4">Retention-verified</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-gray-100">
                <td className="py-2 pr-4">{r.label}</td>
                <td className="py-2 pr-4">{r.assigned}</td>
                <td className="py-2 pr-4">{r.completed}</td>
                <td className="py-2 pr-4">{r.verified}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function CourseReportPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  await requireRole(['admin', 'viewer', 'manager']);
  const supabase = await createClient();

  const [{ data: course }, { data, error }] = await Promise.all([
    supabase.from('courses').select('title').eq('id', courseId).maybeSingle(),
    supabase.rpc('report_course_rollup', { p_course_id: courseId }),
  ]);

  if (!course) notFound();
  if (error) throw new Error(`Failed to load report: ${error.message}`);
  const rows = (data ?? []) as Row[];

  // One table per level that appears in the data, top to bottom. The top of
  // the tree (the supplier) is one big group, so it is skipped. A level is
  // identified by the kind of the unit at that depth.
  const levels = new Map<number, string>();
  for (const r of rows) {
    for (const a of r.ancestors) {
      if (a.depth >= 1 && !levels.has(a.depth)) levels.set(a.depth, a.kind);
    }
  }
  const levelTables = [...levels.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, kind]) => ({
      title: `By ${levelLabel(kind).toLowerCase()}`,
      rows: groupBy(rows, (r) => {
        const a = r.ancestors.find((x) => x.depth === depth);
        return a ? [a.id, a.name] : null;
      }),
    }));
  const byState = groupBy(rows, (r) => (r.state ? [r.state, r.state] : null));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-sm text-gray-500 underline">
          &larr; Reporting
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">{course.title}</h1>
          <a
            href={`/reports/${courseId}/export`}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Export CSV
          </a>
        </div>
        <p className="text-gray-600">
          {rows.length} assigned · {rows.filter((r) => r.completed).length} completed ·{' '}
          {rows.filter((r) => r.retention_verified).length} retention-verified
        </p>
      </div>

      {rows.length === 0 && (
        <p className="rounded border border-gray-200 p-4 text-gray-600">
          No one in your scope is assigned this course yet. Assign it (or widen
          the rule) and they&apos;ll appear here.
        </p>
      )}

      {levelTables.map((t) => (
        <GroupTable key={t.title} title={t.title} rows={t.rows} />
      ))}
      <GroupTable title="By state" rows={byState} />

      <section className="space-y-2">
        <h2 className="font-medium text-gray-700">By person</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Where</th>
                <th className="py-2 pr-4">Completed</th>
                <th className="py-2 pr-4">Retention-verified</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email))
                .map((r) => (
                  <tr key={r.user_id} className="border-b border-gray-100">
                    <td className="py-2 pr-4">{r.full_name ?? r.email}</td>
                    <td className="py-2 pr-4">{r.unit_name ?? '-'}</td>
                    <td className="py-2 pr-4">{r.completed ? '✓' : '-'}</td>
                    <td className="py-2 pr-4">{r.retention_verified ? '✓' : '-'}</td>
                  </tr>
                ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-gray-500">
                    No one assigned yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

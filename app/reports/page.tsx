import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

type Summary = {
  course_id: string;
  title: string;
  assigned: number;
  completed: number;
  retention_verified: number;
};

function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

// Reporting home: two headline numbers per course, side by side. The gap
// between Completed and Retention-verified is the story. Scope is enforced in
// the database by report_courses_summary, from the viewer's own role and the
// units they were given.
export default async function ReportsPage() {
  const profile = await requireRole(['admin', 'viewer', 'manager']);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('report_courses_summary');
  if (error) throw new Error(`Failed to load reporting: ${error.message}`);
  const rows = (data ?? []) as Summary[];

  const scopeLabel = profile.role === 'admin' ? 'everyone' : 'the units you can see';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reporting</h1>
        <p className="text-gray-600">
          Completed vs retention-verified, across {scopeLabel}. Denominators are
          live and count active staff only.
        </p>
      </div>

      {rows.length === 0 && (
        <p className="rounded border border-gray-200 p-4 text-gray-600">
          No published courses with assignments in your scope yet.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <Link
            key={r.course_id}
            href={`/reports/${r.course_id}`}
            className="block rounded border border-gray-200 p-4 hover:bg-gray-50"
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium underline">{r.title}</span>
              <span className="text-sm text-gray-500">{r.assigned} assigned</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Stat label="Completed" value={r.completed} total={r.assigned} colour="bg-blue-600" />
              <Stat
                label="Retention-verified"
                value={r.retention_verified}
                total={r.assigned}
                colour="bg-green-600"
              />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  total,
  colour,
}: {
  label: string;
  value: number;
  total: number;
  colour: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm font-medium">
          {value} of {total} ({pct(value, total)}%)
        </span>
      </div>
      <div className="mt-1 h-2 w-full rounded bg-gray-100">
        <div className={`h-2 rounded ${colour}`} style={{ width: `${pct(value, total)}%` }} />
      </div>
    </div>
  );
}

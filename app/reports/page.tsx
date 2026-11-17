import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getBrand } from '@/brands';

const check = getBrand().voice.checkName;

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

// Reporting home. The lead figure is the gap: of the people who completed a
// course, how many still knew it at the later check. Completed alone only says
// who clicked through. Scope is enforced in
// the database by report_courses_summary, from the viewer's own role and the
// units they were given.
export default async function ReportsPage() {
  const profile = await requireRole(['admin', 'viewer', 'manager']);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('report_courses_summary');
  if (error) throw new Error(`Failed to load reporting: ${error.message}`);
  const rows = (data ?? []) as Summary[];

  const scopeLabel = profile.role === 'admin' ? 'everyone' : 'the units you can see';
  const totals = rows.reduce(
    (t, r) => ({ completed: t.completed + r.completed, verified: t.verified + r.retention_verified }),
    { completed: 0, verified: 0 }
  );
  const notYet = Math.max(0, totals.completed - totals.verified);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Reporting</h1>
        <p className="text-gray-600">
          Completed vs retention-verified, across {scopeLabel}. Denominators are
          live and count active staff only.
        </p>
      </div>

      {totals.completed > 0 && (
        <section
          aria-label="Summary"
          className="rounded-lg border border-gray-200 bg-brand-soft p-4"
        >
          <p className="text-3xl font-semibold">
            {pct(totals.verified, totals.completed)}%
          </p>
          <p className="mt-1 text-gray-800">
            of the {totals.completed} who completed training still knew it at their {check}.
          </p>
          {notYet > 0 && (
            <p className="mt-2 text-sm text-gray-700">
              <strong>{notYet}</strong> completed but haven&apos;t proven it yet. Some
              aren&apos;t due for their {check} yet; the rest are the people to follow up.
            </p>
          )}
        </section>
      )}

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
            <p className="mt-2 text-sm text-gray-700">
              {r.completed === 0
                ? 'Nobody has completed it yet.'
                : `Of ${r.completed} who completed, ${r.retention_verified} still knew it (${pct(
                    r.retention_verified,
                    r.completed
                  )}%).`}
              {r.completed - r.retention_verified > 0 &&
                ` ${r.completed - r.retention_verified} not proven yet.`}
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Stat label="Completed" value={r.completed} total={r.assigned} colour="bg-brand" />
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
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={value}
        className="mt-1 h-2 w-full rounded bg-gray-100"
      >
        <div className={`h-2 rounded ${colour}`} style={{ width: `${pct(value, total)}%` }} />
      </div>
    </div>
  );
}

import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { orderTree, unitPathLabel, type Unit } from '@/lib/units';
import { TeamClient } from './team-client';

type Summary = {
  course_id: string;
  title: string;
  assigned: number;
  completed: number;
  retention_verified: number;
};

export default async function TeamPage() {
  const profile = await requireRole(['manager']);
  const supabase = await createClient();

  const [{ data: staff }, { data: summary }, { data: units }, { data: scopes }, { data: pending }] =
    await Promise.all([
      // Row level security scopes this to the manager's part of the tree.
      supabase
        .from('users')
        .select('id, full_name, email, role, active, unit_id')
        .order('full_name'),
      supabase.rpc('report_courses_summary'),
      supabase.from('units').select('id, parent_id, kind, name, state, suburb, path, active'),
      supabase.from('user_scopes').select('unit_id').eq('user_id', profile.id),
      // Sign-up requests this manager can approve (none unless they're an approver).
      supabase.rpc('pending_registrations'),
    ]);
  const pendingCount = (pending ?? []).length;

  const allUnits = (units ?? []) as Unit[];
  const byId = new Map(allUnits.map((u) => [u.id, u]));

  // Places this manager can add people to: their scope units and everything
  // below them. (The database re-checks on every add.)
  const scopeIds = new Set((scopes ?? []).map((s) => s.unit_id));
  const placeable = orderTree(
    allUnits.filter((u) => u.active && u.path.some((id) => scopeIds.has(id)))
  );

  // Exclude the manager themselves from the staff list.
  const team = (staff ?? [])
    .filter((u) => u.id !== profile.id)
    .map((u) => ({
      ...u,
      unit_label: u.unit_id && byId.get(u.unit_id)
        ? unitPathLabel(byId.get(u.unit_id)!, byId) || byId.get(u.unit_id)!.name
        : '',
    }));
  const rows = (summary ?? []) as Summary[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">My team</h1>
        <p className="text-gray-600">
          Add someone new, or deactivate a person who&apos;s moved on. Keeping
          this list current is what keeps the reporting honest.
        </p>
      </div>
      {pendingCount > 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          {pendingCount} {pendingCount === 1 ? 'person has' : 'people have'} asked to join your team.{' '}
          <Link href="/approvals" className="font-medium underline">
            Approve or decline
          </Link>
        </p>
      )}

      <TeamClient
        staff={team}
        places={placeable.map((u) => ({ id: u.id, name: u.name, kind: u.kind, depth: u.depth }))}
      />

      <section className="space-y-3">
        <h2 className="font-medium">Team progress</h2>
        {rows.length === 0 && (
          <p className="text-sm text-gray-600">No courses assigned to your team yet.</p>
        )}
        {rows.map((r) => (
          <Link
            key={r.course_id}
            href={`/reports/${r.course_id}`}
            className="block rounded border border-gray-200 p-3 text-sm hover:bg-gray-50"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium underline">{r.title}</span>
              <span className="text-gray-600">
                {r.assigned} assigned · {r.completed} completed · {r.retention_verified}{' '}
                retention-verified
              </span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

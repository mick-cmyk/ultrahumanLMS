import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
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

  const [{ data: staff }, { data: summary }] = await Promise.all([
    // RLS scopes this to the manager's store/org.
    supabase
      .from('users')
      .select('id, full_name, email, role, active, store_id')
      .order('full_name'),
    supabase.rpc('report_courses_summary'),
  ]);

  // Exclude the manager themselves from the staff list.
  const team = (staff ?? []).filter((u) => u.id !== profile.id);
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

      <TeamClient staff={team} />

      <section className="space-y-3">
        <h2 className="font-medium">Team progress</h2>
        {rows.length === 0 && (
          <p className="text-sm text-gray-600">
            No courses assigned to your team yet.
          </p>
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
                {r.assigned} assigned · {r.completed} completed ·{' '}
                {r.retention_verified} retention-verified
              </span>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv } from '@/lib/csv';

type Row = {
  full_name: string | null;
  email: string;
  org_name: string | null;
  store_name: string | null;
  state: string | null;
  completed: boolean;
  retention_verified: boolean;
};

// Person-level CSV for a course, scoped to the viewer by report_course_rollup.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const { courseId } = await params;
  await requireRole(['admin', 'coordinator', 'manager']);
  const supabase = await createClient();

  const [{ data: course }, { data, error }] = await Promise.all([
    supabase.from('courses').select('title').eq('id', courseId).maybeSingle(),
    supabase.rpc('report_course_rollup', { p_course_id: courseId }),
  ]);
  if (error) {
    return new Response(`Failed to build export: ${error.message}`, { status: 400 });
  }

  const rows = (data ?? []) as Row[];
  const csv = toCsv(
    ['Name', 'Email', 'Org', 'Store', 'State', 'Completed', 'Retention-verified'],
    rows.map((r) => [
      r.full_name ?? '',
      r.email,
      r.org_name ?? '',
      r.store_name ?? '',
      r.state ?? '',
      r.completed ? 'yes' : 'no',
      r.retention_verified ? 'yes' : 'no',
    ])
  );

  const slug = (course?.title ?? 'course').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}-report.csv"`,
    },
  });
}

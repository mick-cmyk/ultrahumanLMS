import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { NewCourseForm } from './new-course-form';

export const metadata = { title: 'Courses' };

// Admin only: every course, draft or published, with a way to start a new one.
export default async function BuildPage() {
  await requireRole(['admin']);
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from('courses')
    .select('id, title, published, created_at, modules(lessons(id, kind)), assignments(id)')
    .order('created_at', { ascending: false });

  const rows = (courses ?? []).map((c) => {
    const lessons = ((c.modules as { lessons: { id: string; kind: string }[] }[] | null) ?? []).flatMap(
      (m) => m.lessons ?? []
    );
    return {
      id: c.id as string,
      title: c.title as string,
      published: Boolean(c.published),
      lessons: lessons.length,
      scorm: lessons.some((l) => l.kind === 'scorm'),
      assigned: ((c.assignments as { id: string }[] | null) ?? []).length > 0,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Courses</h1>
        <p className="mt-1 text-sm text-gray-600">
          Build a video course: add modules and lessons, paste each lesson&apos;s Bunny video link,
          upload the questions from the template, then check it and publish. Nobody sees a course until
          it&apos;s published and assigned.
        </p>
      </div>

      <NewCourseForm />

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">No courses yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded border border-gray-200">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <Link href={`/build/${c.id}`} className="font-medium underline">
                  {c.title}
                </Link>
                <div className="text-sm text-gray-600">
                  {c.lessons} lesson{c.lessons === 1 ? '' : 's'}
                  {c.scorm ? ', includes SCORM' : ''}
                  {c.published && !c.assigned ? ', not assigned to anyone yet' : ''}
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span
                  className={`rounded-full px-2.5 py-0.5 ${
                    c.published ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {c.published ? 'Published' : 'Draft'}
                </span>
                <Link href={`/build/${c.id}/check`} className="text-brand-ink underline">
                  Check
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

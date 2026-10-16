import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: course }, { data: progress }] = await Promise.all([
    supabase
      .from('courses')
      .select(
        'id, title, description, modules(id, title, sort_order, lessons(id, title, sort_order, duration_seconds))'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('lesson_progress')
      .select('lesson_id, watched_at')
      .eq('user_id', user!.id),
  ]);

  if (!course) notFound();

  const watched = new Set(
    (progress ?? []).filter((p) => p.watched_at).map((p) => p.lesson_id)
  );

  const modules = [...course.modules].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-gray-500 underline">
          &larr; My training
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{course.title}</h1>
        {course.description && (
          <p className="text-gray-600">{course.description}</p>
        )}
      </div>

      {modules.map((module) => (
        <section key={module.id} className="space-y-2">
          <h2 className="font-medium text-gray-700">{module.title}</h2>
          <ul className="divide-y divide-gray-100 rounded border border-gray-200">
            {[...module.lessons]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((lesson) => (
                <li key={lesson.id}>
                  <Link
                    href={`/lessons/${lesson.id}`}
                    className="flex items-center justify-between gap-4 p-3 hover:bg-gray-50"
                  >
                    <span className="underline">{lesson.title}</span>
                    <span className="shrink-0 text-sm text-gray-500">
                      {watched.has(lesson.id)
                        ? '✓ Watched'
                        : lesson.duration_seconds
                          ? `${Math.round(lesson.duration_seconds / 60)} min`
                          : ''}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

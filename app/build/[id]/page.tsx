import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadCourseTree } from '@/lib/course-tree';
import { bunnyConfigured } from '@/lib/bunny';
import { CourseEditor } from './course-editor';

export const metadata = { title: 'Edit course' };

export default async function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(['admin']);
  const { id } = await params;
  const supabase = await createClient();
  const tree = await loadCourseTree(supabase, id);
  if (!tree) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/build" className="text-sm text-gray-500 underline">
            &larr; Courses
          </Link>
          <h1 className="mt-2 text-xl font-semibold">{tree.title}</h1>
          <p className="text-sm text-gray-600">
            {tree.published
              ? 'Published. Changes show to staff straight away.'
              : 'Draft. Staff can\'t see it yet.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        {tree.modules.length > 0 && (
          <a
            href="#scorm-export"
            className="inline-flex min-h-11 items-center rounded border border-gray-300 px-4 py-2 font-medium hover:bg-gray-50"
          >
            Download SCORM
          </a>
        )}
        <Link
          href={`/build/${tree.id}/check`}
          className="inline-flex min-h-11 items-center rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:opacity-90"
        >
          {tree.published ? 'Check course' : 'Check and publish'}
        </Link>
        </div>
      </div>
      {!bunnyConfigured() && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          Bunny isn&apos;t connected on this site yet, so videos won&apos;t play. You can still build
          the course. Ask your developer to add the Bunny library settings before publishing.
        </p>
      )}
      <CourseEditor course={tree} lookupAvailable={Boolean(process.env.BUNNY_STREAM_API_KEY)} />
    </div>
  );
}

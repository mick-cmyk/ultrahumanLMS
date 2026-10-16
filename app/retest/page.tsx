import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { RETEST_MAX_CYCLES, RETEST_QUESTION_COUNT } from '@/lib/constants';
import { RetestPlayer } from './retest-player';

type OpenRetest = {
  retest_id: string;
  module_title: string;
  course_title: string;
  due_at: string;
};
type BuiltQuestion = { id: string; text: string; options: string[]; lesson_id: string };

// The re-test itself, for a logged-in learner. Reached from the email link
// (which starts the session) or from the banner on My training. Everything is
// done by database functions that act as the signed-in learner.
export default async function RetestPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const supabase = await createClient();

  const { data: open, error } = await supabase.rpc('my_open_retests', {
    p_max_cycles: RETEST_MAX_CYCLES,
  });
  if (error) throw new Error(`Failed to load re-tests: ${error.message}`);
  const list = (open ?? []) as OpenRetest[];

  if (list.length === 0) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-6">
        <h1 className="text-xl font-semibold">Re-test</h1>
        <p className="rounded border border-gray-200 bg-gray-50 p-4 text-gray-700">
          Nothing is due right now. If you just passed one, you are all set. We
          will email you when the next check is ready.
        </p>
        <Link href="/" className="text-sm underline">
          Back to my training
        </Link>
      </div>
    );
  }

  const chosen = id ? list.find((r) => r.retest_id === id) : list.length === 1 ? list[0] : undefined;

  if (!chosen) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-6">
        <h1 className="text-xl font-semibold">Your checks</h1>
        <ul className="divide-y divide-gray-100 rounded border border-gray-200">
          {list.map((r) => (
            <li key={r.retest_id}>
              <Link
                href={`/retest?id=${r.retest_id}`}
                className="block p-3 hover:bg-gray-50"
              >
                <span className="font-medium underline">{r.module_title}</span>
                <span className="block text-sm text-gray-500">{r.course_title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { data: built, error: buildErr } = await supabase.rpc('build_my_retest', {
    p_retest_id: chosen.retest_id,
    p_count: RETEST_QUESTION_COUNT,
    p_max_cycles: RETEST_MAX_CYCLES,
  });
  if (buildErr || !built?.valid) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-6">
        <h1 className="text-xl font-semibold">Re-test</h1>
        <p className="rounded border border-gray-200 bg-gray-50 p-4 text-gray-700">
          This check is not available right now.
        </p>
        <Link href="/" className="text-sm underline">
          Back to my training
        </Link>
      </div>
    );
  }

  return (
    <RetestPlayer
      retestId={chosen.retest_id}
      moduleTitle={built.module_title as string}
      courseTitle={built.course_title as string}
      questions={built.questions as BuiltQuestion[]}
    />
  );
}

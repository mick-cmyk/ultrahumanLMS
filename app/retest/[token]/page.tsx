import { createServiceClient } from '@/lib/supabase/service';
import { RetestPlayer } from './retest-player';
import { RETEST_QUESTION_COUNT } from '@/lib/constants';

type BuiltQuestion = { id: string; text: string; options: string[]; lesson_id: string };

// No-login re-test, reached from the email deep link. The token authenticates
// this single re-test session only (spec). We build the question set here and
// hand it to the player; grading happens through /api/retest with the token.
export default async function RetestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('build_retest', {
    p_token: token,
    p_count: RETEST_QUESTION_COUNT,
  });

  const invalidCopy: Record<string, string> = {
    not_found: "This re-test link isn't valid. It may have been mistyped.",
    used: 'This re-test has already been completed. Nice work — nothing more to do.',
    expired: 'This re-test link has expired. You&apos;ll get a fresh one soon.',
    already_passed: "You've already passed this re-test. You're all set.",
  };

  if (error || !data || !data.valid) {
    const reason = (data?.reason as string) ?? 'not_found';
    return (
      <div className="mx-auto max-w-lg space-y-3 py-6">
        <h1 className="text-xl font-semibold">Re-test</h1>
        <p className="rounded border border-gray-200 bg-gray-50 p-4 text-gray-700">
          {invalidCopy[reason] ?? invalidCopy.not_found}
        </p>
      </div>
    );
  }

  return (
    <RetestPlayer
      token={token}
      moduleTitle={data.module_title as string}
      courseTitle={data.course_title as string}
      questions={data.questions as BuiltQuestion[]}
    />
  );
}

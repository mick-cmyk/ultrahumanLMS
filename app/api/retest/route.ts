import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  DEFAULT_PASS_MARK,
  REQUEUE_DELAY_DAYS,
  RETEST_MAX_CYCLES,
} from '@/lib/constants';

// POST /api/retest  { retest_id, answers: { question_id: choice_index } }
// The learner is logged in (the email link starts a real session), so this is
// graded by grade_my_retest as them. The database function checks the re-test
// is theirs, due, unpassed and under the cycle cap, and locks the row so a
// double tap grades once.
export async function POST(request: Request) {
  let payload: { retest_id?: string; answers?: Record<string, number> };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { retest_id, answers } = payload;
  if (typeof retest_id !== 'string' || typeof answers !== 'object' || !answers) {
    return NextResponse.json({ error: 'retest_id and answers are required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('grade_my_retest', {
    p_retest_id: retest_id,
    p_answers: answers,
    p_pass_mark: DEFAULT_PASS_MARK,
    p_requeue_delay_days: REQUEUE_DELAY_DAYS,
    p_max_cycles: RETEST_MAX_CYCLES,
  });

  if (error) {
    const status = /not authenticated/.test(error.message) ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}

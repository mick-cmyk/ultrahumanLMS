import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  DEFAULT_PASS_MARK,
  REQUEUE_DELAY_DAYS,
  RETEST_MAX_CYCLES,
} from '@/lib/constants';

// POST /api/retest  { token, answers: { question_id: choice_index } }
// The single-use token is the only credential — grade_retest validates it,
// scores, and applies pass / requeue / cap. Runs as service role because the
// taker has no login session.
export async function POST(request: Request) {
  let payload: { token?: string; answers?: Record<string, number> };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { token, answers } = payload;
  if (typeof token !== 'string' || typeof answers !== 'object' || !answers) {
    return NextResponse.json(
      { error: 'token and answers are required' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('grade_retest', {
    p_token: token,
    p_answers: answers,
    p_pass_mark: DEFAULT_PASS_MARK,
    p_requeue_delay_days: REQUEUE_DELAY_DAYS,
    p_max_cycles: RETEST_MAX_CYCLES,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}

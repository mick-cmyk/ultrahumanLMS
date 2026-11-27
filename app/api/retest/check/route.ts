import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RETEST_MAX_CYCLES } from '@/lib/constants';

// POST /api/retest/check  { retest_id, question_id, chosen }
// Marks one quick check answer straight away, with the explanation. The
// database keeps the first answer to each question and grade_my_retest uses
// it, so a checked answer can't be changed later.
export async function POST(request: Request) {
  let payload: { retest_id?: unknown; question_id?: unknown; chosen?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { retest_id, question_id, chosen } = payload;
  if (typeof retest_id !== 'string' || typeof question_id !== 'string' || typeof chosen !== 'number') {
    return NextResponse.json({ error: 'retest_id, question_id and chosen are required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('check_retest_answer', {
    p_retest_id: retest_id,
    p_question_id: question_id,
    p_chosen: chosen,
    p_max_cycles: RETEST_MAX_CYCLES,
  });
  if (error) {
    const status = /not authenticated/.test(error.message) ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}

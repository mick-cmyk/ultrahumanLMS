import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/quiz/check  { lesson_id, question_id, chosen }
// Marks one answer and returns { correct, correct_index, explanation }, so the
// quiz can show the question maker's explanation straight away. Records
// nothing; the attempt is scored by POST /api/quiz once all are answered.
export async function POST(request: Request) {
  let payload: { lesson_id?: unknown; question_id?: unknown; chosen?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { lesson_id, question_id, chosen } = payload;
  if (typeof lesson_id !== 'string' || typeof question_id !== 'string' || typeof chosen !== 'number') {
    return NextResponse.json({ error: 'lesson_id, question_id and chosen are required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('check_quiz_answer', {
    p_lesson_id: lesson_id,
    p_question_id: question_id,
    p_chosen: chosen,
  });
  if (error) {
    const status = /not authenticated/.test(error.message) ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}

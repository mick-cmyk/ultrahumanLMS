import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RETEST_DELAY_DAYS } from '@/lib/constants';

// GET /api/quiz?lesson_id=…  → the quiz with answers stripped (or null if the
// lesson is watch-only or not yet watched). Scored server-side only.
export async function GET(request: Request) {
  const lessonId = new URL(request.url).searchParams.get('lesson_id');
  if (!lessonId) {
    return NextResponse.json({ error: 'lesson_id is required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_lesson_quiz', {
    p_lesson_id: lessonId,
  });

  if (error) {
    const status = /not authenticated/.test(error.message) ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ quiz: data });
}

// POST /api/quiz  { lesson_id, answers: { question_id: choice_index } }
// Records the attempt and returns per-question feedback + pass/fail.
export async function POST(request: Request) {
  let payload: { lesson_id?: string; answers?: Record<string, number> };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { lesson_id, answers } = payload;
  if (typeof lesson_id !== 'string' || typeof answers !== 'object' || !answers) {
    return NextResponse.json(
      { error: 'lesson_id and answers are required' },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('record_quiz_attempt', {
    p_lesson_id: lesson_id,
    p_answers: answers,
    p_retest_delay_days: RETEST_DELAY_DAYS,
  });

  if (error) {
    const status = /not authenticated/.test(error.message) ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}

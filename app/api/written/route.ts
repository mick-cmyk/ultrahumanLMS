import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET /api/written?lesson_id=…  → the lesson's written prompts as this learner
// may see them (model answers only for prompts they've already answered).
export async function GET(request: Request) {
  const lessonId = new URL(request.url).searchParams.get('lesson_id');
  if (!lessonId) {
    return NextResponse.json({ error: 'lesson_id is required' }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_written_prompts', { p_lesson_id: lessonId });
  if (error) {
    const status = /not authenticated/.test(error.message) ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ prompts: data ?? [] });
}

// POST /api/written  { lesson_id, prompt_id, answer } → { id, answer, model_answer }
// Saved once. A second submit returns the first answer.
export async function POST(request: Request) {
  let payload: { lesson_id?: unknown; prompt_id?: unknown; answer?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { lesson_id, prompt_id, answer } = payload;
  if (typeof lesson_id !== 'string' || typeof prompt_id !== 'string' || typeof answer !== 'string') {
    return NextResponse.json({ error: 'lesson_id, prompt_id and answer are required' }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_written_answer', {
    p_lesson_id: lesson_id,
    p_prompt_id: prompt_id,
    p_answer: answer.slice(0, 4000),
  });
  if (error) {
    const status = /not authenticated/.test(error.message) ? 401 : 400;
    const message = /write something/.test(error.message)
      ? 'Write your answer first.'
      : /watch the lesson/.test(error.message)
        ? 'Watch the video first.'
        : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json(data);
}

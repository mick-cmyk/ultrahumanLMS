import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Receives throttled watch updates from the lesson player. All the rules —
// own row only, GREATEST(existing, incoming), watched_at stamped at the
// lesson threshold, assignment check — live in the record_watch_progress
// Postgres function, running as the learner's own session.
export async function POST(request: Request) {
  // sendBeacon posts arrive without a JSON content type, so parse from text.
  let payload: { lesson_id?: string; watch_pct?: number };
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { lesson_id, watch_pct } = payload;
  if (typeof lesson_id !== 'string' || typeof watch_pct !== 'number') {
    return NextResponse.json(
      { error: 'lesson_id and watch_pct are required' },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('record_watch_progress', {
    p_lesson_id: lesson_id,
    p_watch_pct: watch_pct,
  });

  if (error) {
    const status = /not authenticated/.test(error.message) ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}

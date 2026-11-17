import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RETEST_DELAY_DAYS } from '@/lib/constants';

// Saves a SCORM package's state (LMSCommit / LMSFinish from the player).
// Everything is decided by record_scorm_commit, running as the learner:
// assignment, own row only, validation, completion. Accepts text/plain too,
// because navigator.sendBeacon (used when the page is closing) sends that.

const KEYS = ['lesson_status', 'score_raw', 'score_min', 'score_max', 'lesson_location', 'suspend_data'] as const;

export async function POST(request: Request) {
  let body: { lessonId?: unknown; state?: Record<string, unknown>; sessionSeconds?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  if (typeof body.lessonId !== 'string' || !body.state || typeof body.state !== 'object') {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  // Only pass on the keys the database understands, as strings.
  const state: Record<string, string> = {};
  for (const k of KEYS) {
    const v = body.state[k];
    if (typeof v === 'string' || typeof v === 'number') state[k] = String(v);
  }
  const seconds = Math.max(0, Math.min(86400, Math.round(Number(body.sessionSeconds) || 0)));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('record_scorm_commit', {
    p_lesson_id: body.lessonId,
    p_state: state,
    p_session_seconds: seconds,
    p_retest_delay_days: RETEST_DELAY_DAYS,
  });
  if (error) {
    const status = /not authenticated/.test(error.message) ? 401 : /not found|not assigned/.test(error.message) ? 404 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}

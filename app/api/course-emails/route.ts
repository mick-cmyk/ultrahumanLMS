import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// Admin controls for the "new course" email queue, under the admin's session
// (the database functions check the role).
//   { action: 'cancel', assignment_id }   stop emails that haven't gone yet
//   { action: 'limit', limit }            emails per hour, 1 to 10000
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 });

  let b: { action?: string; assignment_id?: string; limit?: number };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const supabase = await createClient();

  if (b.action === 'cancel' && b.assignment_id) {
    const { data, error } = await supabase.rpc('cancel_course_emails', { p_assignment: b.assignment_id });
    if (error) return NextResponse.json({ error: 'Could not cancel those emails.' }, { status: 400 });
    return NextResponse.json({ cancelled: data });
  }
  if (b.action === 'limit') {
    const n = Number(b.limit);
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      return NextResponse.json({ error: 'Pick a whole number from 1 to 10000.' }, { status: 400 });
    }
    const { error } = await supabase.rpc('set_email_hourly_limit', { p_limit: n });
    if (error) return NextResponse.json({ error: 'Could not save the limit.' }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

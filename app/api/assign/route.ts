import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// Save an assignment rule for a course. Admin only. Writes through the admin's
// own session — RLS admin policy authorises the insert.
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  let payload: {
    course_id?: string;
    rule?: Record<string, unknown>;
    label?: string;
    due_days?: number | null;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { course_id, rule, label, due_days } = payload;
  if (typeof course_id !== 'string' || typeof rule !== 'object' || !rule) {
    return NextResponse.json(
      { error: 'course_id and rule are required' },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('assignments')
    .insert({
      course_id,
      rule,
      label: label?.trim() || null,
      due_days: due_days ?? null,
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}

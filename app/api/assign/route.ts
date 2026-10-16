import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const STRING_LISTS = ['unit_ids', 'states', 'include_user_ids', 'exclude_user_ids'] as const;

// Keep only the fields the rule function understands, with the right types.
// Anything else in the payload is dropped rather than stored.
function cleanRule(raw: Record<string, unknown>): Record<string, unknown> | null {
  const rule: Record<string, unknown> = { all: raw.all === true };
  for (const key of STRING_LISTS) {
    const v = raw[key];
    if (v === undefined) {
      rule[key] = [];
    } else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      rule[key] = v;
    } else {
      return null;
    }
  }
  return rule;
}

// Save an assignment rule for a course. Admin only: only the supplier decides
// who gets which course. Writes through the admin's own session, so the row
// level security policy authorises the insert.
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

  const { course_id, rule: rawRule, label, due_days } = payload;
  if (typeof course_id !== 'string' || typeof rawRule !== 'object' || !rawRule) {
    return NextResponse.json({ error: 'course_id and rule are required' }, { status: 400 });
  }
  const rule = cleanRule(rawRule);
  if (!rule) return NextResponse.json({ error: 'rule is malformed' }, { status: 400 });
  if (due_days != null && (!Number.isInteger(due_days) || due_days < 1 || due_days > 3650)) {
    return NextResponse.json({ error: 'due days must be a whole number of days' }, { status: 400 });
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

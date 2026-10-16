import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// Live "this will reach N people" for a draft rule. Admin only.
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  let rule: unknown;
  try {
    rule = (await request.json()).rule;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('preview_rule_reach', { p_rule: rule });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ reach: data });
}

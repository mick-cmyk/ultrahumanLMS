import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// Admin: change a user's role and/or active flag. Writes through the admin's
// own session — RLS admin policy authorises it. Soft-delete only (active flag),
// never a hard delete.
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  let payload: { id?: string; active?: boolean; role?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { id, active, role } = payload;
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const validRoles = ['learner', 'manager', 'coordinator', 'admin'];
  if (role !== undefined && !validRoles.includes(role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof active === 'boolean') patch.active = active;
  if (role !== undefined) patch.role = role;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from('users').update(patch).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

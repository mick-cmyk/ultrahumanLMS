import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// Admin only: change a person's role, unit, or active flag, and manage the
// units a viewer or manager can see (their scope). Writes go through the
// admin's own session, so row level security is the final gate. Soft delete
// only (the active flag), never a hard delete.
//
// Body: { id, active?, role?, unit_id?, add_scope?, remove_scope? }
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  let payload: {
    id?: string;
    active?: boolean;
    role?: string;
    unit_id?: string | null;
    add_scope?: string;
    remove_scope?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { id, active, role, unit_id, add_scope, remove_scope } = payload;
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  const validRoles = ['learner', 'viewer', 'manager', 'admin'];
  if (role !== undefined && !validRoles.includes(role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 });
  }
  // An admin cannot lock themselves out.
  if (id === profile.id && (role !== undefined && role !== 'admin' || active === false)) {
    return NextResponse.json({ error: 'You cannot demote or deactivate yourself' }, { status: 400 });
  }

  const supabase = await createClient();

  const patch: Record<string, unknown> = {};
  if (typeof active === 'boolean') patch.active = active;
  if (role !== undefined) patch.role = role;
  if (unit_id !== undefined) patch.unit_id = unit_id;

  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabase.from('users').update(patch).eq('id', id).select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'No such person' }, { status: 404 });
    }
    // Only viewers and managers carry a scope. Clear it when the role changes
    // to one that cannot use it, so it cannot come back to life later.
    if (role === 'learner' || role === 'admin') {
      await supabase.from('user_scopes').delete().eq('user_id', id);
    }
  }

  if (add_scope) {
    const { error } = await supabase.from('user_scopes').insert({ user_id: id, unit_id: add_scope });
    if (error && !/duplicate/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }
  if (remove_scope) {
    const { error } = await supabase
      .from('user_scopes')
      .delete()
      .eq('user_id', id)
      .eq('unit_id', remove_scope);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (Object.keys(patch).length === 0 && !add_scope && !remove_scope) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { provisionUser } from '@/lib/provision';

// Manager self-serve staff management, scoped to their store/org.
//   action 'add'        → { email, full_name } creates/updates a learner in the
//                         manager's store.
//   action 'deactivate' → { id } soft-deletes, but only someone in scope.
// Runs as service role after verifying the caller is a manager and the target
// is within their store/org.
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'manager') {
    return NextResponse.json({ error: 'Managers only' }, { status: 403 });
  }

  let body: { action?: string; email?: string; full_name?: string; id?: string; active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const service = createServiceClient();

  if (body.action === 'add') {
    const email = (body.email ?? '').trim();
    const fullName = (body.full_name ?? '').trim();
    if (!email || !fullName) {
      return NextResponse.json({ error: 'email and name are required' }, { status: 400 });
    }
    try {
      const { created } = await provisionUser({
        email,
        full_name: fullName,
        org_id: profile.org_id,
        store_id: profile.store_id,
        role: 'learner',
      });
      return NextResponse.json({ ok: true, created });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Could not add that person' },
        { status: 400 }
      );
    }
  }

  if (body.action === 'deactivate' || body.action === 'reactivate') {
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Confirm the target is within the manager's scope before touching them.
    const { data: target } = await service
      .from('users')
      .select('id, org_id, store_id')
      .eq('id', body.id)
      .maybeSingle();
    const inScope =
      target &&
      target.org_id === profile.org_id &&
      (profile.store_id === null || target.store_id === profile.store_id);
    if (!inScope) {
      return NextResponse.json({ error: 'That person is not in your store' }, { status: 403 });
    }

    const { error } = await service
      .from('users')
      .update({ active: body.action === 'reactivate' })
      .eq('id', body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

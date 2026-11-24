import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { provisionUser } from '@/lib/provision';
import { sendWelcome } from '@/lib/email';

// Self-serve staff management for managers (and admins).
//   action 'add'        { email, full_name, unit_id }  add or move a person
//   action 'deactivate' { id }
//   action 'reactivate' { id }
//
// Authorisation is done by the database, as the logged-in user:
//   can_provision_email(email, unit)  may this person be placed in this unit?
//   set_user_active(id, flag)         may this person be switched on or off?
// The service role is only used afterwards to create the login.
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'manager' && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Managers only' }, { status: 403 });
  }

  let body: {
    action?: string;
    email?: string;
    full_name?: string;
    unit_id?: string;
    id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const supabase = await createClient();

  if (body.action === 'add') {
    const email = (body.email ?? '').trim();
    const fullName = (body.full_name ?? '').trim();
    const unitId = body.unit_id ?? '';
    if (!email || !fullName || !unitId) {
      return NextResponse.json({ error: 'name, email and unit are required' }, { status: 400 });
    }

    const { data: allowed, error: checkErr } = await supabase.rpc('can_provision_email', {
      p_email: email,
      p_unit: unitId,
    });
    if (checkErr) return NextResponse.json({ error: checkErr.message }, { status: 400 });
    if (!allowed) {
      return NextResponse.json(
        { error: 'You cannot add that person to that place. They may already belong to someone else.' },
        { status: 403 }
      );
    }

    try {
      const { id, created } = await provisionUser({ email, full_name: fullName, unit_id: unitId });
      // Only a brand-new login gets the welcome email; moving someone doesn't.
      const emailed = created ? await sendWelcome(email, fullName) : false;
      return NextResponse.json({ ok: true, id, created, emailed });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Could not add that person' },
        { status: 400 }
      );
    }
  }

  if (body.action === 'deactivate' || body.action === 'reactivate') {
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const { error } = await supabase.rpc('set_user_active', {
      p_target: body.id,
      p_active: body.action === 'reactivate',
    });
    if (error) {
      const status = /not allowed/i.test(error.message) ? 403 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

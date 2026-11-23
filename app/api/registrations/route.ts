import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { provisionUser } from '@/lib/provision';
import { sendWelcome } from '@/lib/email';

// Self-registration admin, under the caller's own session. The database
// decides who may do what (20261124000100_self_registration.sql).
//   { action: 'approve', id, role? }     approver or admin (role checked by the database)
//   { action: 'decline', id }            approver or admin
//   { action: 'settings', general, auto_approve }   admin
//   { action: 'link', unit_id, on }      admin, or manager for their own places
//
// Approving creates the login with the service role (lib/provision), only
// after registration_for_approval, run as the approver, has said yes.
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin' && profile.role !== 'manager') {
    return NextResponse.json({ error: 'Admins and managers only' }, { status: 403 });
  }

  let b: { action?: string; id?: string; role?: string; general?: boolean; auto_approve?: boolean; unit_id?: string; on?: boolean };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const supabase = await createClient();
  const refused = (msg: string) =>
    NextResponse.json(
      {
        error: /role not allowed/.test(msg)
          ? "You can't give that role for this place."
          : /not allowed/.test(msg)
            ? "You can't do that for this place."
            : /not found/.test(msg)
              ? 'That request has already been dealt with.'
              : /belongs elsewhere/.test(msg)
                ? 'That email already belongs to someone in another area. Ask an admin.'
                : 'Something went wrong.',
      },
      { status: /not allowed|belongs/.test(msg) ? 403 : 400 }
    );

  switch (b.action) {
    case 'approve': {
      if (!b.id) return NextResponse.json({ error: 'Missing request.' }, { status: 400 });
      const { data, error } = await supabase.rpc('registration_for_approval', { p_id: b.id });
      if (error) return refused(error.message);
      const req = (data as { email: string; full_name: string; unit_id: string }[])[0];
      const role = ['learner', 'viewer', 'manager', 'admin'].includes(b.role ?? '') ? b.role! : 'learner';
      // Check the role before creating a login, so a refusal leaves nothing behind.
      if (role !== 'learner') {
        const { data: choices } = await supabase.rpc('registration_role_choices', { p_unit: req.unit_id });
        if (!((choices as string[] | null) ?? []).includes(role)) return refused('role not allowed');
      }
      let userId: string;
      try {
        ({ id: userId } = await provisionUser({ email: req.email, full_name: req.full_name, unit_id: req.unit_id }));
      } catch (e) {
        console.error('[registrations] provisioning failed', e instanceof Error ? e.message : e);
        return NextResponse.json({ error: 'Could not create their login. Try again.' }, { status: 500 });
      }
      const { data: decided, error: decideErr } = await supabase.rpc('decide_registration', {
        p_id: b.id,
        p_approve: true,
        p_user: userId,
        p_role: role,
      });
      if (decideErr) return refused(decideErr.message);
      await sendWelcome(req.email, req.full_name);
      return NextResponse.json({ ok: true, role_applied: (decided as { role_applied?: boolean } | null)?.role_applied ?? false });
    }
    case 'decline': {
      if (!b.id) return NextResponse.json({ error: 'Missing request.' }, { status: 400 });
      const { error } = await supabase.rpc('decide_registration', { p_id: b.id, p_approve: false });
      if (error) return refused(error.message);
      return NextResponse.json({ ok: true });
    }
    case 'settings': {
      const { error } = await supabase.rpc('set_registration_settings', {
        p_general: b.general === true,
        p_auto_approve: b.auto_approve === true,
      });
      if (error) return refused(error.message);
      return NextResponse.json({ ok: true });
    }
    case 'link': {
      if (!b.unit_id) return NextResponse.json({ error: 'Missing place.' }, { status: 400 });
      const { data, error } = await supabase.rpc('set_unit_signup', { p_unit: b.unit_id, p_on: b.on === true });
      if (error) return refused(error.message);
      return NextResponse.json({ ok: true, code: data });
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

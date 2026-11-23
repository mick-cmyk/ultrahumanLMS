import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { provisionUser } from '@/lib/provision';
import { sendApprovalRequest, sendWelcome } from '@/lib/email';

// POST /api/register  { code?, unit_id?, email, full_name, website }
//
// Public self-registration. The database decides everything
// (submit_registration, 20261124000100_self_registration.sql): which place,
// whether it's open, pending or auto-approved, and that an existing login is
// never touched. The service client is needed because an approved request ends
// in creating a login, and the function itself is service role only.
//
// The answer never says whether an email already has an account.
// `website` is a trap field hidden from people; bots fill it in.

const PER_MINUTE_PER_IP = 5;
const PER_HOUR_PER_EMAIL = 3;

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

async function allowed(service: ReturnType<typeof createServiceClient>, key: string, limit: number, seconds: number) {
  const { data, error } = await service.rpc('hit_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: seconds });
  return !error && data !== false;
}

export async function POST(request: Request) {
  let body: { code?: unknown; unit_id?: unknown; email?: unknown; full_name?: unknown; website?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim().slice(0, 64) : '';
  const unitId = typeof body.unit_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.unit_id) ? body.unit_id : null;

  // A bot filled in the hidden field: look successful, do nothing.
  if (typeof body.website === 'string' && body.website.trim()) {
    return NextResponse.json({ status: 'pending' });
  }
  if (!fullName || fullName.length > 200) {
    return NextResponse.json({ error: 'Type your full name.' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }
  if (!code && !unitId) {
    return NextResponse.json({ error: 'Choose where you work.' }, { status: 400 });
  }

  const service = createServiceClient();
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (
    !(await allowed(service, 'register-ip:' + hash(ip), PER_MINUTE_PER_IP, 60)) ||
    !(await allowed(service, 'register-email:' + hash(email), PER_HOUR_PER_EMAIL, 3600))
  ) {
    return NextResponse.json({ error: 'Too many tries. Wait a while and try again.' }, { status: 429 });
  }

  const { data, error } = await service.rpc('submit_registration', {
    p_email: email,
    p_full_name: fullName,
    p_unit: unitId,
    p_code: code || null,
  });
  if (error) {
    if (/closed/.test(error.message)) {
      return NextResponse.json(
        {
          error: code
            ? 'This sign-up link has been turned off. Ask your manager for a new one.'
            : "Sign-up isn't open here. Ask your manager for your site's sign-up link.",
        },
        { status: 400 }
      );
    }
    if (/bad email/.test(error.message)) {
      return NextResponse.json({ error: "That email address can't be used." }, { status: 400 });
    }
    console.error('[register] submit failed', error.message);
    return NextResponse.json({ error: 'Something went wrong. Try again in a minute.' }, { status: 500 });
  }

  const result = data as {
    status: 'existing' | 'pending' | 'approved';
    id?: string;
    unit_id?: string;
    notify?: boolean;
    auto?: boolean;
  };

  if (result.status === 'approved' && result.id && result.unit_id) {
    try {
      const { id } = await provisionUser({ email, full_name: fullName, unit_id: result.unit_id });
      await service.rpc('link_registration_user', { p_request: result.id, p_user: id });
      await sendWelcome(email, fullName);
    } catch (e) {
      console.error('[register] provisioning failed', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'Something went wrong. Try again in a minute.' }, { status: 500 });
    }
    return NextResponse.json({ status: 'approved' });
  }

  if (result.status === 'pending' && result.notify && result.unit_id) {
    const [{ data: approvers }, { data: unit }] = await Promise.all([
      service.rpc('registration_approvers', { p_unit: result.unit_id }),
      service.from('units').select('name').eq('id', result.unit_id).single(),
    ]);
    const place = unit?.name ?? 'your site';
    await Promise.all(
      ((approvers ?? []) as { email: string }[]).map((a) =>
        sendApprovalRequest(a.email, { name: fullName, email, place })
      )
    );
  }

  // Someone who already has a login gets the same answer a new person would,
  // so the form can't be used to check who has an account. Nothing is sent to
  // them and nothing about their account changes.
  if (result.status === 'existing') {
    return NextResponse.json({ status: result.auto ? 'approved' : 'pending' });
  }
  return NextResponse.json({ status: 'pending' });
}

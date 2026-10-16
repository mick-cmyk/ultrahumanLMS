import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/retest/start  { token }
//
// Turns an emailed re-test link into a real login session, so staff go
// straight into the check with no extra step. It is a POST on purpose: the
// page behind the link only shows a Start button, because mail scanners and
// link previews fetch URLs and must not be able to spend a token or log
// anyone in.
//
// Steps: validate the token (service role) -> ask Auth for a one-time
// magic-link hash for that learner -> verify it here, which sets the session
// cookies -> mark the token used.
//
// Only learners can be signed in this way. A token for anyone else is refused,
// so a forwarded or leaked link can never open a manager or admin account.

// Best-effort rate limit per client address. Serverless instances do not share
// memory, so this slows a single hot instance; the real protection is that
// tokens are 256-bit random values, single use, and expire in 7 days.
const hits = new Map<string, number[]>();
function limited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 10;
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (limited(ip)) {
    return NextResponse.json({ error: 'Too many tries. Wait a minute and try again.' }, { status: 429 });
  }

  let token: unknown;
  try {
    token = (await request.json()).token;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: check, error: checkErr } = await service.rpc('check_retest_token', {
    p_token: token,
  });
  if (checkErr || !check?.valid) {
    return NextResponse.json({ ok: false, reason: check?.reason ?? 'not_found' }, { status: 400 });
  }

  const { data: link, error: linkErr } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email: check.email as string,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    return NextResponse.json({ error: 'Could not start your session. Try the login page.' }, { status: 500 });
  }

  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (verifyErr) {
    return NextResponse.json({ error: 'Could not start your session. Try the login page.' }, { status: 500 });
  }

  await service.rpc('use_retest_token', { p_token: token });
  return NextResponse.json({ ok: true, retest_id: check.retest_id });
}

import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { renderEmail, sendEmail } from '@/lib/email';
import { getBrand } from '@/brands';

// Developer access (20261126000200_developer.sql). The database decides who
// may ask and who may decide; this route also emails the developer when
// someone asks.
//   { action: 'request', developer_id, reason }   an admin asks
//   { action: 'decide', id, approve }              the developer decides
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let b: { action?: string; developer_id?: string; reason?: string; id?: string; approve?: boolean };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const supabase = await createClient();
  const friendly = (m: string) =>
    /already a request/i.test(m)
      ? 'There is already a request waiting for the developer.'
      : /not allowed/i.test(m)
        ? 'You can\'t do that.'
        : 'Something went wrong. Try again.';

  if (b.action === 'request' && typeof b.developer_id === 'string') {
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    const { error } = await supabase.rpc('request_developer_removal', { p_developer: b.developer_id, p_reason: reason || null });
    if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });

    // Tell the developer. Admins can read users under RLS.
    const { data: dev } = await supabase.from('users').select('email, full_name').eq('id', b.developer_id).maybeSingle();
    if (dev?.email) {
      const brand = getBrand();
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
      const who = profile.full_name || profile.email;
      const { html, text } = renderEmail({
        heading: 'Someone wants to remove your developer access',
        paragraphs: [
          `Hi ${dev.full_name?.split(' ')[0] ?? 'there'},`,
          `${who} has asked to remove your developer access to ${brand.name}.`,
          ...(reason ? [`Their reason: ${reason}`] : []),
          'Nothing changes unless you approve it. You can approve or decline on the People page.',
        ],
        button: appUrl ? { label: 'Open People', url: `${appUrl}/people` } : undefined,
      });
      await sendEmail({ to: dev.email, subject: `${brand.name}: request to remove your developer access`, html, text });
    }
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'decide' && typeof b.id === 'string') {
    const { error } = await supabase.rpc('decide_developer_removal', { p_id: b.id, p_approve: b.approve === true });
    if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

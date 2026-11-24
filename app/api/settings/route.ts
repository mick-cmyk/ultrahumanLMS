import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { tidyWelcome, welcomeProblem, type WelcomeText } from '@/lib/welcome';

// Site settings, under the admin's own session. The database decides who may
// save and checks the shape (20261127000100_site_text.sql).
//   { action: 'welcome.save', welcome }   save the welcome page wording
//   { action: 'welcome.reset' }           go back to the brand file's wording
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 });

  let b: { action?: string; welcome?: unknown };
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  let welcome: WelcomeText | null;
  if (b.action === 'welcome.save') {
    const problem = welcomeProblem(b.welcome);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    welcome = tidyWelcome(b.welcome as WelcomeText);
  } else if (b.action === 'welcome.reset') {
    welcome = null;
  } else {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_welcome_text', { p_welcome: welcome });
  if (error) {
    const msg = /not allowed/.test(error.message)
      ? 'Only admins can change this.'
      : /check/.test(error.message)
        ? 'That wording could not be saved. Check every box is filled in and there are no long dashes.'
        : 'Something went wrong. Try again.';
    return NextResponse.json({ error: msg }, { status: /not allowed/.test(error.message) ? 403 : 400 });
  }
  return NextResponse.json({ ok: true });
}

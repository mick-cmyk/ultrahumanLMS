import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// PKCE magic-link landing. Hosted Supabase's default email template sends the
// user to the project's Site URL with `?code=...`; exchanging that code sets
// the session cookies. (The `token_hash` variant is handled by /auth/confirm,
// which is what a customised email template uses.)
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL('/login?error=link', origin));
}

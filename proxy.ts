import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the auth session on every request and bounces anyone who isn't
// logged in to /login. Auth callback routes stay reachable logged-out.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and auth.getUser() --
  // it makes sessions randomly drop.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // A magic link can land on any path (it goes to the project's Site URL).
  // If it carries a PKCE `code`, hand it to the callback route to exchange.
  const code = request.nextUrl.searchParams.get('code');
  if (code && !pathname.startsWith('/auth/callback')) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    return NextResponse.redirect(url);
  }

  // The home page shows the public landing page when logged out.
  // The emailed re-test link is /retest/<token>. That landing page and the
  // route behind its Start button must work logged out, because they are what
  // creates the session. Everything else under /retest (the check itself) and
  // grading at /api/retest need a login.
  const isPublic =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    /^\/retest\/[^/]+\/?$/.test(pathname) ||
    pathname === '/api/retest/start';

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Static assets (including lesson media) skip the session check entirely --
  // otherwise a <video src> would be redirected to /login instead of streaming.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sample-videos|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|m4v|mp3|vtt)$).*)',
  ],
};

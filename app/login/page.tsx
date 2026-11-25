import Link from 'next/link';
import { LoginForm } from '@/components/login-form';
import { Welcome } from '@/components/welcome';
import { createClient } from '@/lib/supabase/server';
import { resolveWelcome, welcomeLogo } from '@/lib/welcome';

export default async function LoginPage() {
  // Offer the general sign-up page only while an admin has it switched on.
  const supabase = await createClient();
  const [{ data }, { data: savedWelcome }] = await Promise.all([
    supabase.rpc('registration_options', { p_code: null }),
    supabase.rpc('welcome_text'),
  ]);
  const signupOpen = (data as { open?: boolean } | null)?.open === true;

  // People land here after logging out, from an old link or from a page that
  // needs a login. On a client site, show the same welcome as the front page
  // so they can see what the site is, not just an email box.
  const welcome = resolveWelcome(savedWelcome);
  if (welcome.show) return <Welcome text={welcome.text} logoUrl={welcomeLogo()} signupOpen={signupOpen} />;

  return (
    <div className="mt-10 max-w-sm space-y-6">
      <LoginForm autoFocus variant="page" signupOpen={signupOpen} />
      {signupOpen && (
        <p className="text-sm text-gray-600">
          New here?{' '}
          <Link href="/register" className="font-medium underline">
            Ask for access
          </Link>
        </p>
      )}
    </div>
  );
}

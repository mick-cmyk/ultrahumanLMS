import Link from 'next/link';
import { LoginForm } from '@/components/login-form';
import { createClient } from '@/lib/supabase/server';

export default async function LoginPage() {
  // Offer the general sign-up page only while an admin has it switched on.
  const supabase = await createClient();
  const { data } = await supabase.rpc('registration_options', { p_code: null });
  const signupOpen = (data as { open?: boolean } | null)?.open === true;

  return (
    <div className="mt-10 max-w-sm space-y-6">
      <LoginForm autoFocus variant="page" />
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

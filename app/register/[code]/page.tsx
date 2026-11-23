import { createClient } from '@/lib/supabase/server';
import { getBrand } from '@/brands';
import { RegisterForm } from '@/components/register-form';

export const metadata = { title: 'Sign up' };
export const dynamic = 'force-dynamic';

type Options = { open: boolean; unit?: { id: string; name: string } };

// A sign-up link for one place (made on the People page). The link fixes
// where the person works, so they only give their name and email.
export default async function RegisterForPlacePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc('registration_options', { p_code: code });
  const options = (data ?? { open: false }) as Options;
  const brand = getBrand();

  return (
    <div className="mx-auto mt-8 max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Sign up for {brand.name} training</h1>
      {options.open && options.unit ? (
        <RegisterForm code={code} place={options.unit} />
      ) : (
        <p className="rounded border border-gray-200 p-4 text-gray-700">
          This sign-up link doesn&apos;t work any more. Ask your manager for a new one.
        </p>
      )}
    </div>
  );
}

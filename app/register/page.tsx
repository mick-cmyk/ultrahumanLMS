import { createClient } from '@/lib/supabase/server';
import { getBrand } from '@/brands';
import { RegisterForm } from '@/components/register-form';

export const metadata = { title: 'Sign up' };
export const dynamic = 'force-dynamic';

type Options = { open: boolean; units?: { id: string; name: string; depth: number }[] };

// The general sign-up page: pick where you work. Only open when an admin has
// switched it on (People page). Sign-up links for one place are /register/<code>.
export default async function RegisterPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc('registration_options', { p_code: null });
  const options = (data ?? { open: false }) as Options;
  const brand = getBrand();

  return (
    <div className="mx-auto mt-8 max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Sign up for {brand.name} training</h1>
        {options.open && <p className="text-gray-600">Tell us who you are and where you work.</p>}
      </div>
      {options.open ? (
        <RegisterForm places={options.units ?? []} />
      ) : (
        <p className="rounded border border-gray-200 p-4 text-gray-700">
          Sign-up isn&apos;t open here. Ask your manager for your site&apos;s sign-up link.
        </p>
      )}
    </div>
  );
}

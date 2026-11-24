import type { Metadata } from 'next';
import { requireRole } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getBrand } from '@/brands';
import { defaultWelcome, resolveWelcome, welcomeLogo } from '@/lib/welcome';
import { WelcomeEditor } from './welcome-editor';

export const metadata: Metadata = { title: 'Settings' };

// Admin settings. For now: the wording on the welcome page people see before
// they log in.
export default async function SettingsPage() {
  await requireRole(['admin']);
  const supabase = await createClient();
  const { data: saved, error } = await supabase.rpc('welcome_text');
  if (error) throw new Error(`Failed to load settings: ${error.message}`);
  const welcome = resolveWelcome(saved);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-gray-600">Changes here show on the site straight away.</p>
      </div>
      <WelcomeEditor
        initial={welcome.text}
        defaults={defaultWelcome()}
        custom={welcome.custom}
        brandHasWelcome={Boolean(getBrand().welcome)}
        logoUrl={welcomeLogo()}
      />
    </div>
  );
}

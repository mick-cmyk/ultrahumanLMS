import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type Role = 'learner' | 'manager' | 'coordinator' | 'admin';

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  org_id: string | null;
  store_id: string | null;
  group_id: string | null;
};

// The current user's profile, or null if not logged in. RLS lets a user read
// their own row.
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('users')
    .select('id, email, full_name, role, org_id, store_id, group_id')
    .eq('id', user.id)
    .maybeSingle();
  return (data as Profile) ?? null;
}

// Gate a page to specific roles. Redirects to /login if logged out, or to the
// learner home if logged in without the required role.
export async function requireRole(roles: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (!roles.includes(profile.role)) redirect('/');
  return profile;
}

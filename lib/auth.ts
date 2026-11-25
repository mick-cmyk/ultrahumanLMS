import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// learner: own training only. viewer: reports for their scope. manager: viewer
// plus add and deactivate staff beneath them (and their own training). admin:
// everything.
export type Role = 'learner' | 'viewer' | 'manager' | 'admin';

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  unit_id: string | null;
};

// The current user's profile, or null if not logged in (or deactivated). RLS
// lets a user read their own row.
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('users')
    .select('id, email, full_name, role, unit_id, active')
    .eq('id', user.id)
    .maybeSingle();
  if (!data || !data.active) return null;
  return data as Profile;
}

// Gate a page to specific roles. Redirects to /login if logged out, or home if
// logged in without the required role.
export async function requireRole(roles: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (!roles.includes(profile.role)) redirect('/');
  return profile;
}

// Where each role lands. Viewers have no personal training, so they go to
// reporting. Admins land on My training like everyone else (their own courses).
export function homeFor(role: Role): string {
  return role === 'viewer' ? '/reports' : '/';
}

import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

// Create-or-fetch an auth user by email, then set their public.users profile.
// Re-importing the same email updates rather than duplicates (spec: upsert on
// email). Service-role only; callers must authorise first.
export async function provisionUser(opts: {
  email: string;
  full_name: string;
  org_id: string | null;
  store_id: string | null;
  role?: 'learner' | 'manager' | 'coordinator' | 'admin';
}): Promise<{ id: string; created: boolean }> {
  const db = createServiceClient();
  const email = opts.email.trim().toLowerCase();

  let userId: string;
  let created = false;
  const { data: createdUser, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (error) {
    if (!/already|registered|exists/i.test(error.message)) throw error;
    // Already there — find them.
    const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;
    const found = list.users.find((u) => u.email?.toLowerCase() === email);
    if (!found) throw new Error(`could not locate existing auth user ${email}`);
    userId = found.id;
  } else {
    userId = createdUser.user.id;
    created = true;
  }

  // The mirror trigger created the profile row; fill in the details.
  const { error: profErr } = await db
    .from('users')
    .update({
      full_name: opts.full_name.trim(),
      org_id: opts.org_id,
      store_id: opts.store_id,
      role: opts.role ?? 'learner',
      active: true,
    })
    .eq('id', userId);
  if (profErr) throw profErr;

  return { id: userId, created };
}

// Parse a small CSV (header row required) into objects keyed by lowercased
// header. Handles quoted fields, embedded commas, and doubled quotes.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Skip fully-empty lines.
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') pushRow();
    else if (c === '\r') {
      /* ignore */
    } else field += c;
  }
  if (field !== '' || row.length > 0) pushRow();

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = (r[i] ?? '').trim()));
    return obj;
  });
}

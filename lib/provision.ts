import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

// Create-or-find a person by email and place them in a unit.
//
// Service role, so callers MUST authorise first with the can_provision_email
// database function, run as the logged-in user (it checks scope and refuses to
// pull in people who belong to someone else's area).
//
// This never changes the role of an existing user. A new person is a learner
// (the column default). Promotions are an admin-only edit on the People page.
export async function provisionUser(opts: {
  email: string;
  full_name: string;
  unit_id: string;
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
    // They already have a login. Find them through our own table (indexed by
    // the mirror trigger) rather than paging through every auth user.
    const { data: existing, error: lookupErr } = await db
      .from('users')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!existing) throw new Error(`could not locate existing user ${email}`);
    userId = existing.id;
  } else {
    userId = createdUser.user.id;
    created = true;
  }

  const patch: { unit_id: string; active: boolean; full_name?: string } = {
    unit_id: opts.unit_id,
    active: true,
  };
  const name = opts.full_name.trim();
  if (name) patch.full_name = name;

  const { error: profErr } = await db.from('users').update(patch).eq('id', userId);
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

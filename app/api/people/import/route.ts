import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { provisionUser, parseCsv } from '@/lib/provision';

// CSV import for admins and managers. Columns: email, full_name, unit.
// `unit` is the unit's name as it appears on the Structure page. If two units
// share a name inside the caller's scope the row is refused rather than
// guessed. A manager's units are limited to their own scope; the database
// decides that (can_provision_email), not this route.
export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin' && profile.role !== 'manager') {
    return NextResponse.json({ error: 'Admins and managers only' }, { status: 403 });
  }

  let csv: string;
  try {
    csv = (await request.json()).csv;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (typeof csv !== 'string' || !csv.trim()) {
    return NextResponse.json({ error: 'csv is required' }, { status: 400 });
  }

  const rows = parseCsv(csv);
  if (rows.length === 0) return NextResponse.json({ error: 'No data rows found' }, { status: 400 });
  if (rows.length > 500) {
    return NextResponse.json({ error: 'Import up to 500 people at a time' }, { status: 400 });
  }

  // Units the caller can see (RLS limits this to their part of the tree).
  const supabase = await createClient();
  const { data: units, error: unitErr } = await supabase
    .from('units')
    .select('id, name')
    .eq('active', true);
  if (unitErr) return NextResponse.json({ error: unitErr.message }, { status: 400 });

  const byName = new Map<string, string[]>();
  for (const u of units ?? []) {
    const key = u.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), u.id]);
  }

  const results: { email: string; ok: boolean; created?: boolean; error?: string }[] = [];

  for (const r of rows) {
    const email = (r.email ?? '').trim();
    const fullName = (r.full_name ?? r.name ?? '').trim();
    if (!email) {
      results.push({ email: '(blank)', ok: false, error: 'missing email' });
      continue;
    }

    const unitName = (r.unit ?? r.store ?? '').trim().toLowerCase();
    const matches = unitName ? (byName.get(unitName) ?? []) : [];
    if (matches.length === 0) {
      results.push({ email, ok: false, error: `unknown unit "${r.unit ?? r.store ?? ''}"` });
      continue;
    }
    if (matches.length > 1) {
      results.push({ email, ok: false, error: `"${r.unit ?? r.store}" matches more than one unit` });
      continue;
    }
    const unitId = matches[0];

    const { data: allowed, error: checkErr } = await supabase.rpc('can_provision_email', {
      p_email: email,
      p_unit: unitId,
    });
    if (checkErr || !allowed) {
      results.push({ email, ok: false, error: 'not allowed to add this person here' });
      continue;
    }

    try {
      const { created } = await provisionUser({ email, full_name: fullName, unit_id: unitId });
      results.push({ email, ok: true, created });
    } catch (e) {
      results.push({ email, ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  }

  const created = results.filter((r) => r.ok && r.created).length;
  const updated = results.filter((r) => r.ok && !r.created).length;
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({ created, updated, failed });
}

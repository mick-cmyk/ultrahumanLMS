import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { provisionUser, parseCsv } from '@/lib/provision';

// CSV import (admin + manager). Columns: email, full_name, store.
// Admin: store name resolves to any store. Manager: forced to their own store,
// the store column is ignored. Upserts on email.
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
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data rows found' }, { status: 400 });
  }

  // Store name → { id, org_id } lookup (service role reads all stores).
  const service = createServiceClient();
  const { data: stores } = await service.from('stores').select('id, name, org_id');
  const storeByName = new Map(
    (stores ?? []).map((s) => [s.name.trim().toLowerCase(), s])
  );

  const results: { email: string; ok: boolean; created?: boolean; error?: string }[] = [];

  for (const r of rows) {
    const email = (r.email ?? '').trim();
    const fullName = (r.full_name ?? r.name ?? '').trim();
    if (!email) {
      results.push({ email: '(blank)', ok: false, error: 'missing email' });
      continue;
    }

    let orgId: string | null;
    let storeId: string | null;

    if (profile.role === 'manager') {
      // Managers can only add to their own store/org.
      orgId = profile.org_id;
      storeId = profile.store_id;
    } else {
      const storeName = (r.store ?? '').trim().toLowerCase();
      if (storeName) {
        const store = storeByName.get(storeName);
        if (!store) {
          results.push({ email, ok: false, error: `unknown store "${r.store}"` });
          continue;
        }
        orgId = store.org_id;
        storeId = store.id;
      } else {
        orgId = null;
        storeId = null;
      }
    }

    try {
      const { created } = await provisionUser({
        email,
        full_name: fullName,
        org_id: orgId,
        store_id: storeId,
        role: 'learner',
      });
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

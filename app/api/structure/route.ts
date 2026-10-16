import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// Structure CRUD for groups / orgs / stores (admin only). Create and rename;
// orgs can move between groups. All writes go through the admin's own session
// (RLS admin policies authorise them). No deletes in v1 — history matters.
type Body = {
  action: 'create' | 'update';
  entity: 'group' | 'org' | 'store';
  id?: string;
  values: Record<string, unknown>;
};

const ALLOWED: Record<Body['entity'], string[]> = {
  group: ['name'],
  org: ['name', 'type', 'group_id', 'logo_url', 'brand_color'],
  store: ['name', 'state', 'suburb', 'org_id'],
};

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { action, entity, id, values } = body;
  if (!['group', 'org', 'store'].includes(entity)) {
    return NextResponse.json({ error: 'unknown entity' }, { status: 400 });
  }
  const table = entity === 'group' ? 'groups' : entity === 'org' ? 'orgs' : 'stores';

  // Whitelist columns.
  const patch: Record<string, unknown> = {};
  for (const key of ALLOWED[entity]) {
    if (values && key in values) patch[key] = values[key] === '' ? null : values[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to write' }, { status: 400 });
  }

  const supabase = await createClient();

  if (action === 'create') {
    const { data, error } = await supabase.from(table).insert(patch).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ id: data.id });
  }

  if (action === 'update') {
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const { error } = await supabase.from(table).update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

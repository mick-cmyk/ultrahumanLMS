import { NextResponse } from 'next/server';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// Structure CRUD for the unit tree (admin only). Create, rename, restyle,
// move, and switch on or off. No hard deletes: history matters. All writes go
// through the admin's own session; row level security and the column grants
// are the final gate, and the database refuses a move under the unit's own
// descendants.
type Body = {
  action: 'create' | 'update';
  id?: string;
  values: Record<string, unknown>;
};

const CREATE_FIELDS = ['name', 'kind', 'parent_id', 'state', 'suburb', 'logo_url', 'brand_color'];
const UPDATE_FIELDS = [...CREATE_FIELDS, 'active'];

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

  const { action, id, values } = body;
  const allowed = action === 'create' ? CREATE_FIELDS : UPDATE_FIELDS;

  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (values && key in values) patch[key] = values[key] === '' ? null : values[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to write' }, { status: 400 });
  }

  const supabase = await createClient();

  if (action === 'create') {
    const { data, error } = await supabase.from('units').insert(patch).select('id').single();
    if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });
    return NextResponse.json({ id: data.id });
  }

  if (action === 'update') {
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const { error } = await supabase.from('units').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

function friendly(message: string): string {
  if (/units_single_root/.test(message)) {
    return 'There can only be one top level unit. Pick a parent for this one.';
  }
  if (/underneath itself/.test(message)) return 'A unit cannot be moved underneath itself.';
  return message;
}

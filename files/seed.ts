/**
 * scripts/seed.ts — Phase 1 seed data for P1xel Forge LMS
 *
 * Creates a realistic slice of production shape:
 *   - NARTA group containing two retailer orgs (Harvey Norman, JB Hi-Fi)
 *   - One direct-client org with no group and no stores (Mornington Council)
 *   - 8 stores across VIC / NSW / QLD
 *   - 22 users: learners, two store managers, one org manager, one coordinator (Jason), one admin (Mick)
 *   - 2 courses with modules + lessons (bunny_video_id left as placeholders)
 *   - 4 assignment rules chosen specifically to exercise every branch of user_matches_rule
 *
 * Run:  npm run seed   (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
 * Idempotent-ish: upserts on natural keys where possible; safe to re-run after `supabase db reset`.
 *
 * All emails are @example.com — magic links to these will go nowhere, which is fine.
 * For real login testing, change ONE learner email to your own address.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertOne<T extends Record<string, unknown>>(
  table: string,
  match: Record<string, unknown>,
  row: T
): Promise<any> {
  const { data: existing, error: selErr } = await db.from(table).select('*').match(match).maybeSingle();
  if (selErr) throw new Error(`${table} select failed: ${selErr.message}`);
  if (existing) {
    const { data, error } = await db.from(table).update(row).match(match).select().single();
    if (error) throw new Error(`${table} update failed: ${error.message}`);
    return data;
  }
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  return data;
}

/** Create (or fetch) an auth user, then update the mirrored public.users profile row. */
async function seedUser(opts: {
  email: string;
  full_name: string;
  role: 'learner' | 'manager' | 'coordinator' | 'admin';
  org_id?: string | null;
  store_id?: string | null;
  group_id?: string | null;
}) {
  let userId: string;
  const { data: created, error } = await db.auth.admin.createUser({
    email: opts.email,
    email_confirm: true, // no confirmation dance for seed users
  });
  if (error) {
    if (!/already/i.test(error.message)) throw new Error(`auth create ${opts.email}: ${error.message}`);
    // Already exists — find them
    const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;
    const found = list.users.find((u) => u.email === opts.email);
    if (!found) throw new Error(`could not locate existing auth user ${opts.email}`);
    userId = found.id;
  } else {
    userId = created.user.id;
  }

  // The auth trigger should have created the profile row; update it with real details.
  const { error: profErr } = await db
    .from('users')
    .update({
      full_name: opts.full_name,
      role: opts.role,
      org_id: opts.org_id ?? null,
      store_id: opts.store_id ?? null,
      group_id: opts.group_id ?? null,
      active: true,
    })
    .eq('id', userId);
  if (profErr) throw new Error(`profile update ${opts.email}: ${profErr.message}`);

  return userId;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding…');

  // --- Group + orgs ---------------------------------------------------------
  const narta = await upsertOne('groups', { name: 'NARTA' }, { name: 'NARTA' });

  const harvey = await upsertOne(
    'orgs',
    { name: 'Harvey Norman' },
    { name: 'Harvey Norman', type: 'retailer', group_id: narta.id }
  );
  const jb = await upsertOne(
    'orgs',
    { name: 'JB Hi-Fi' },
    { name: 'JB Hi-Fi', type: 'retailer', group_id: narta.id }
  );
  const council = await upsertOne(
    'orgs',
    { name: 'Mornington Peninsula Council' },
    { name: 'Mornington Peninsula Council', type: 'client', group_id: null }
  );

  // --- Stores ---------------------------------------------------------------
  const storeDefs = [
    { org: harvey, name: 'Harvey Norman Frankston', state: 'VIC', suburb: 'Frankston' },
    { org: harvey, name: 'Harvey Norman Moorabbin', state: 'VIC', suburb: 'Moorabbin' },
    { org: harvey, name: 'Harvey Norman Auburn', state: 'NSW', suburb: 'Auburn' },
    { org: harvey, name: 'Harvey Norman Maroochydore', state: 'QLD', suburb: 'Maroochydore' },
    { org: jb, name: 'JB Hi-Fi Chadstone', state: 'VIC', suburb: 'Chadstone' },
    { org: jb, name: 'JB Hi-Fi Southland', state: 'VIC', suburb: 'Cheltenham' },
    { org: jb, name: 'JB Hi-Fi Parramatta', state: 'NSW', suburb: 'Parramatta' },
    { org: jb, name: 'JB Hi-Fi Brisbane CBD', state: 'QLD', suburb: 'Brisbane' },
  ];
  const stores: Record<string, any> = {};
  for (const s of storeDefs) {
    stores[s.name] = await upsertOne(
      'stores',
      { name: s.name },
      { org_id: s.org.id, name: s.name, state: s.state, suburb: s.suburb }
    );
  }

  // --- Users ------------------------------------------------------------------
  // Admin + coordinator
  await seedUser({ email: 'mick@example.com', full_name: 'Mick Russell', role: 'admin' });
  await seedUser({
    email: 'jason@example.com',
    full_name: 'Jason (NARTA)',
    role: 'coordinator',
    group_id: narta.id,
  });

  // Managers
  await seedUser({
    email: 'mgr.chadstone@example.com',
    full_name: 'Priya Nair',
    role: 'manager',
    org_id: jb.id,
    store_id: stores['JB Hi-Fi Chadstone'].id,
  });
  await seedUser({
    email: 'mgr.frankston@example.com',
    full_name: 'Dave Kowalski',
    role: 'manager',
    org_id: harvey.id,
    store_id: stores['Harvey Norman Frankston'].id,
  });
  await seedUser({
    email: 'mgr.harvey.org@example.com',
    full_name: 'Sandra Liu', // org-wide manager: store_id null
    role: 'manager',
    org_id: harvey.id,
  });

  // Learners — spread to exercise every rule branch
  const learnerDefs: Array<[string, string, any, string]> = [
    ['liam.hn.frank@example.com', 'Liam Torres', harvey, 'Harvey Norman Frankston'],
    ['emma.hn.frank@example.com', 'Emma Whitfield', harvey, 'Harvey Norman Frankston'],
    ['noah.hn.moor@example.com', 'Noah Pham', harvey, 'Harvey Norman Moorabbin'],
    ['olivia.hn.aub@example.com', 'Olivia Grant', harvey, 'Harvey Norman Auburn'],
    ['jack.hn.aub@example.com', 'Jack Reilly', harvey, 'Harvey Norman Auburn'],
    ['mia.hn.maroo@example.com', 'Mia Chandra', harvey, 'Harvey Norman Maroochydore'],
    ['ethan.jb.chad@example.com', 'Ethan Barlow', jb, 'JB Hi-Fi Chadstone'],
    ['zoe.jb.chad@example.com', 'Zoe Mitchell', jb, 'JB Hi-Fi Chadstone'],
    ['lucas.jb.south@example.com', 'Lucas Nguyen', jb, 'JB Hi-Fi Southland'],
    ['ava.jb.south@example.com', 'Ava Papadopoulos', jb, 'JB Hi-Fi Southland'],
    ['oscar.jb.parra@example.com', 'Oscar Singh', jb, 'JB Hi-Fi Parramatta'],
    ['ruby.jb.parra@example.com', 'Ruby Anderson', jb, 'JB Hi-Fi Parramatta'],
    ['harry.jb.bris@example.com', 'Harry Osei', jb, 'JB Hi-Fi Brisbane CBD'],
    ['grace.jb.bris@example.com', 'Grace Tanaka', jb, 'JB Hi-Fi Brisbane CBD'],
  ];
  const learners: Record<string, string> = {};
  for (const [email, name, org, storeName] of learnerDefs) {
    learners[email] = await seedUser({
      email,
      full_name: name,
      role: 'learner',
      org_id: org.id,
      store_id: stores[storeName].id,
    });
  }

  // Direct-client learners (no store)
  const councilLearners = [
    ['tash@example.com', 'Tash Reid'],
    ['ben.council@example.com', 'Ben Marsh'],
    ['ines.council@example.com', 'Ines Duarte'],
  ];
  for (const [email, name] of councilLearners) {
    learners[email] = await seedUser({
      email,
      full_name: name,
      role: 'learner',
      org_id: council.id,
    });
  }

  // One deactivated user — must drop out of visibility and denominators
  const ghostId = await seedUser({
    email: 'departed@example.com',
    full_name: 'Former Staffer',
    role: 'learner',
    org_id: jb.id,
    store_id: stores['JB Hi-Fi Chadstone'].id,
  });
  await db.from('users').update({ active: false }).eq('id', ghostId);

  // --- Courses / modules / lessons --------------------------------------------
  const oled = await upsertOne(
    'courses',
    { title: 'LG OLED 2026 Range' },
    { title: 'LG OLED 2026 Range', description: 'Selling the 2026 OLED lineup on the floor.', published: true }
  );
  const oledMod = await upsertOne(
    'modules',
    { course_id: oled.id, title: 'Panel technology' },
    { course_id: oled.id, title: 'Panel technology', sort_order: 1 }
  );
  await upsertOne(
    'lessons',
    { module_id: oledMod.id, title: 'Why OLED blacks matter' },
    {
      module_id: oledMod.id,
      title: 'Why OLED blacks matter',
      sort_order: 1,
      bunny_video_id: 'REPLACE_WITH_BUNNY_ID',
      duration_seconds: 150,
      watch_threshold: 0.9,
    }
  );
  await upsertOne(
    'lessons',
    { module_id: oledMod.id, title: 'OLED vs Mini-LED in 60 seconds' },
    {
      module_id: oledMod.id,
      title: 'OLED vs Mini-LED in 60 seconds',
      sort_order: 2,
      bunny_video_id: 'REPLACE_WITH_BUNNY_ID',
      duration_seconds: 130,
      watch_threshold: 0.9,
    }
  );

  const induction = await upsertOne(
    'courses',
    { title: 'Council Venue Induction' },
    { title: 'Council Venue Induction', description: 'Venue and safety basics.', published: true }
  );
  const indMod = await upsertOne(
    'modules',
    { course_id: induction.id, title: 'Getting started' },
    { course_id: induction.id, title: 'Getting started', sort_order: 1 }
  );
  await upsertOne(
    'lessons',
    { module_id: indMod.id, title: 'Site access and safety' },
    {
      module_id: indMod.id,
      title: 'Site access and safety',
      sort_order: 1,
      bunny_video_id: 'REPLACE_WITH_BUNNY_ID',
      duration_seconds: 160,
      watch_threshold: 0.9,
    }
  );

  // --- Assignment rules — chosen to hit every branch of user_matches_rule ------
  // Rule A: JB Hi-Fi, VIC + NSW only. QLD JB staff must NOT see the OLED course.
  await upsertOne(
    'assignments',
    { course_id: oled.id, label: 'JB VIC+NSW' },
    {
      course_id: oled.id,
      label: 'JB VIC+NSW',
      rule: {
        all: false,
        org_ids: [jb.id],
        states: ['VIC', 'NSW'],
        store_ids: [],
        include_user_ids: [],
        exclude_user_ids: [],
      },
    }
  );

  // Rule B: same course, ONE specific Harvey store (Frankston) — store_ids branch,
  // plus an include (Mia in QLD gets it individually) and an exclude
  // (Emma at Frankston is excluded even though her store matches → exclude beats store match).
  await upsertOne(
    'assignments',
    { course_id: oled.id, label: 'HN Frankston + cherry-picks' },
    {
      course_id: oled.id,
      label: 'HN Frankston + cherry-picks',
      rule: {
        all: false,
        org_ids: [harvey.id],
        states: [],
        store_ids: [stores['Harvey Norman Frankston'].id],
        include_user_ids: [learners['mia.hn.maroo@example.com']],
        exclude_user_ids: [learners['emma.hn.frank@example.com']],
      },
    }
  );

  // Rule C: induction course → everyone in the Council org (org filter, empty states/stores).
  await upsertOne(
    'assignments',
    { course_id: induction.id, label: 'Council all staff' },
    {
      course_id: induction.id,
      label: 'Council all staff',
      rule: {
        all: false,
        org_ids: [council.id],
        states: [],
        store_ids: [],
        include_user_ids: [],
        exclude_user_ids: [],
      },
    }
  );

  console.log('\nSeed complete. Expected visibility (use as test assertions):');
  console.log('  OLED course:');
  console.log('    ✓ all JB learners in VIC + NSW (Chadstone, Southland, Parramatta)');
  console.log('    ✗ JB Brisbane CBD (QLD filtered out)');
  console.log('    ✓ Liam @ HN Frankston (store rule)');
  console.log('    ✗ Emma @ HN Frankston (excluded — exclude beats store match)');
  console.log('    ✓ Mia @ HN Maroochydore (included individually, bypasses filters)');
  console.log('    ✗ Noah @ HN Moorabbin, Olivia/Jack @ HN Auburn (no matching rule)');
  console.log('    ✗ departed@example.com (inactive)');
  console.log('  Induction course:');
  console.log('    ✓ all three Council learners; ✗ everyone else');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

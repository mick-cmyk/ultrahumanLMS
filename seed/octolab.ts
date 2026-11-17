// Demo data for the Octolab testing site (and any other demo deployment).
//
//   npm run seed:load            build the made-up supplier, staff, course, progress
//   npm run seed:load -- --mark-demo
//                                same, and flip a brand-new database to 'demo' first
//   npm run seed:purge           delete every row this script created
//
// Everything is tagged demo_tag = 'octolab-demo'. Demo emails end in .invalid
// (the database enforces that), so no real inbox is ever mailed. The database
// also refuses demo rows while app_settings.environment = 'production', and
// the go-live check (npm run golive:check) refuses to finish while any exist.
//
// To test emails, add yourself as a real staff member through the People page.
// Demo staff cannot receive mail by design.

import {
  adminClient,
  die,
  getEnvironment,
  must,
  parseArgs,
  setEnvironment,
} from '../scripts/db';
import {
  COURSE_DESCRIPTION,
  COURSE_TITLE,
  LESSONS,
  MODULE_TITLE,
  posterDataUri,
} from './content/attach-selling';

const TAG = 'octolab-demo';
const DOMAIN = 'octolab-demo.invalid';
const db = adminClient();

type UnitSeed = {
  key: string;
  parent: string | null;
  kind: string;
  name: string;
  state?: string;
  suburb?: string;
  brand_color?: string;
};

// A made-up supplier with two retail brands. Stores carry a state so the
// "by state" reporting and state-targeted assignments have something to chew on.
const UNITS: UnitSeed[] = [
  { key: 'sup', parent: null, kind: 'supplier', name: 'Octolab Demo Supplier', brand_color: '#0f766e' },
  { key: 'harvest', parent: 'sup', kind: 'brand', name: 'Harvest Electronics', brand_color: '#b45309' },
  { key: 'h-vic', parent: 'harvest', kind: 'region', name: 'Harvest Victoria', state: 'VIC' },
  { key: 'h-nsw', parent: 'harvest', kind: 'region', name: 'Harvest New South Wales', state: 'NSW' },
  { key: 'h-mel', parent: 'h-vic', kind: 'store', name: 'Harvest Melbourne CBD', state: 'VIC', suburb: 'Melbourne' },
  { key: 'h-ric', parent: 'h-vic', kind: 'store', name: 'Harvest Richmond', state: 'VIC', suburb: 'Richmond' },
  { key: 'h-syd', parent: 'h-nsw', kind: 'store', name: 'Harvest Sydney CBD', state: 'NSW', suburb: 'Sydney' },
  { key: 'north', parent: 'sup', kind: 'brand', name: 'Northgate Appliances', brand_color: '#1d4ed8' },
  { key: 'n-qld', parent: 'north', kind: 'region', name: 'Northgate Queensland', state: 'QLD' },
  { key: 'n-bne', parent: 'n-qld', kind: 'store', name: 'Northgate Brisbane', state: 'QLD', suburb: 'Brisbane' },
  { key: 'n-gc', parent: 'n-qld', kind: 'store', name: 'Northgate Gold Coast', state: 'QLD', suburb: 'Southport' },
];

type UserSeed = {
  key: string;
  email: string;
  name: string;
  role: 'learner' | 'viewer' | 'manager' | 'admin';
  unit: string;
  scopes?: string[];
};

const USERS: UserSeed[] = [
  { key: 'admin', email: 'admin', name: 'Alex Admin', role: 'admin', unit: 'sup' },
  { key: 'l1', email: 'brand.viewer', name: 'Harriet Harvest (Level 1, read only)', role: 'viewer', unit: 'harvest', scopes: ['harvest'] },
  { key: 'l2', email: 'state.rep', name: 'Vic Rep (Level 2)', role: 'manager', unit: 'h-vic', scopes: ['h-vic'] },
  { key: 'l3', email: 'store.manager', name: 'Sam Storey (Level 3)', role: 'manager', unit: 'h-mel', scopes: ['h-mel'] },
  { key: 'f1', email: 'floor.one', name: 'Jordan Floor', role: 'learner', unit: 'h-mel' },
  { key: 'f2', email: 'floor.two', name: 'Casey Floor', role: 'learner', unit: 'h-mel' },
  { key: 'f3', email: 'floor.three', name: 'Riley Floor', role: 'learner', unit: 'h-ric' },
  { key: 'f4', email: 'floor.four', name: 'Morgan Floor', role: 'learner', unit: 'h-syd' },
  { key: 'f5', email: 'floor.five', name: 'Taylor Floor', role: 'learner', unit: 'n-bne' },
  { key: 'f6', email: 'floor.six', name: 'Quinn Floor', role: 'learner', unit: 'n-gc' },
  // Supplier -> individual, no middle man.
  { key: 'direct', email: 'direct.staff', name: 'Dana Direct', role: 'learner', unit: 'sup' },
];

async function load(flags: Set<string>) {
  const env = await getEnvironment(db);

  const existing = await must(
    db.from('units').select('id').eq('demo_tag', TAG).limit(1),
    'Checking for existing demo data'
  );
  if ((existing as unknown[]).length) {
    die('Demo data is already loaded. Run "npm run seed:purge" first if you want a fresh copy.');
  }

  if (env !== 'demo') {
    if (!flags.has('mark-demo')) {
      die(
        `This database is set to "${env}", and demo rows are refused there.\n` +
          'If it is a testing database, run: npm run seed:load -- --mark-demo'
      );
    }
    // Only flip a database that holds nothing real.
    const [{ count: realUsers }, { count: realUnits }] = await Promise.all([
      db.from('users').select('id', { count: 'exact', head: true }).is('demo_tag', null),
      db.from('units').select('id', { count: 'exact', head: true }).is('demo_tag', null),
    ]);
    if ((realUsers ?? 0) > 0 || (realUnits ?? 0) > 0) {
      die(
        'This database already holds real (untagged) users or units, so it will not be switched ' +
          'to demo mode. Use a separate testing project for demo data.'
      );
    }
    await setEnvironment(db, 'demo');
    console.log('Environment set to demo.');
  }

  const root = await must(db.from('units').select('id').is('parent_id', null).limit(1), 'Checking root');
  if ((root as unknown[]).length) {
    die('A top-level unit already exists, so the demo supplier cannot be added as a second root.');
  }

  // --- Units, parents first -------------------------------------------------
  const unitId: Record<string, string> = {};
  for (const u of UNITS) {
    const row = await must(
      db
        .from('units')
        .insert({
          parent_id: u.parent ? unitId[u.parent] : null,
          kind: u.kind,
          name: u.name,
          state: u.state ?? null,
          suburb: u.suburb ?? null,
          brand_color: u.brand_color ?? null,
          demo_tag: TAG,
        })
        .select('id')
        .single(),
      `Creating unit ${u.name}`
    );
    unitId[u.key] = (row as { id: string }).id;
  }
  console.log(`Units: ${UNITS.length}`);

  // --- People ---------------------------------------------------------------
  const userId: Record<string, string> = {};
  for (const u of USERS) {
    const email = `${u.email}@${DOMAIN}`;
    const { data, error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: u.name, demo_tag: TAG },
    });
    if (error || !data.user) die(`Creating ${email} failed: ${error?.message}`);
    userId[u.key] = data.user.id;
    await must(
      db.from('users').update({ unit_id: unitId[u.unit], role: u.role, full_name: u.name }).eq('id', data.user.id),
      `Setting up ${email}`
    );
    if (u.scopes?.length) {
      await must(
        db.from('user_scopes').insert(u.scopes.map((s) => ({ user_id: data.user!.id, unit_id: unitId[s] }))),
        `Scoping ${email}`
      );
    }
  }
  console.log(`People: ${USERS.length}`);

  // --- Course ---------------------------------------------------------------
  const course = (await must(
    db
      .from('courses')
      .insert({ title: COURSE_TITLE, description: COURSE_DESCRIPTION, published: true, demo_tag: TAG })
      .select('id')
      .single(),
    'Creating course'
  )) as { id: string };
  const mod = (await must(
    db.from('modules').insert({ course_id: course.id, title: MODULE_TITLE, sort_order: 1 }).select('id').single(),
    'Creating module'
  )) as { id: string };

  const lessonIds: { id: string; hasQuiz: boolean }[] = [];
  for (let i = 0; i < LESSONS.length; i++) {
    const def = LESSONS[i];
    const lesson = (await must(
      db
        .from('lessons')
        .insert({
          module_id: mod.id,
          title: def.title,
          sort_order: i + 1,
          bunny_video_id: null,
          sample_video_url: def.video,
          image_url: posterDataUri(`Video ${i + 1}`, def.title),
          script: def.script,
          duration_seconds: 30,
          watch_threshold: 0.9,
        })
        .select('id')
        .single(),
      `Creating lesson ${def.title}`
    )) as { id: string };
    if (def.quiz) {
      await must(
        db.from('quizzes').insert({ lesson_id: lesson.id, pass_mark: 0.8, questions: def.quiz }),
        `Creating quiz for ${def.title}`
      );
    }
    lessonIds.push({ id: lesson.id, hasQuiz: Boolean(def.quiz) });
  }
  console.log(`Course: ${COURSE_TITLE} (${LESSONS.length} lessons)`);

  // --- Assignments: one per branch of the rule matcher ----------------------
  await must(
    db.from('assignments').insert([
      {
        course_id: course.id,
        label: 'Harvest, all stores',
        rule: { all: false, unit_ids: [unitId.harvest], states: [], include_user_ids: [], exclude_user_ids: [] },
        due_days: 14,
        created_by: userId.admin,
        demo_tag: TAG,
      },
      {
        course_id: course.id,
        label: 'Northgate, QLD only (excluding Quinn)',
        rule: {
          all: false,
          unit_ids: [unitId.north],
          states: ['QLD'],
          include_user_ids: [],
          exclude_user_ids: [userId.f6],
        },
        created_by: userId.admin,
        demo_tag: TAG,
      },
      {
        course_id: course.id,
        label: 'Direct staff (no middle man)',
        rule: { all: false, unit_ids: [], states: [], include_user_ids: [userId.direct], exclude_user_ids: [] },
        created_by: userId.admin,
        demo_tag: TAG,
      },
    ]),
    'Creating assignments'
  );

  // --- Progress, so the reports show something -------------------------------
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86400_000).toISOString();
  const finish = async (who: string, daysAgo: number) => {
    await must(
      db.from('lesson_progress').insert(
        lessonIds.map((l) => ({
          user_id: userId[who],
          lesson_id: l.id,
          watch_pct: 1,
          watched_at: ago(daysAgo),
          quiz_score: l.hasQuiz ? 1 : null,
          quiz_attempts: l.hasQuiz ? 1 : 0,
          quiz_passed_at: l.hasQuiz ? ago(daysAgo) : null,
        }))
      ),
      `Progress for ${who}`
    );
  };
  // Jordan: completed and re-test passed (retention-verified).
  await finish('f1', 9);
  await must(
    db.from('retests').insert({
      user_id: userId.f1, module_id: mod.id, due_at: ago(4), attempts: 1,
      last_score: 1, status: 'passed', passed_at: ago(3), sent_at: ago(4),
    }),
    'Re-test for Jordan'
  );
  // Casey: completed, re-test due now (would be emailed at 8am Sydney).
  await finish('f2', 6);
  await must(
    db.from('retests').insert({
      user_id: userId.f2, module_id: mod.id, due_at: ago(1), status: 'pending',
    }),
    'Re-test for Casey'
  );
  // Riley: completed, re-test sent 4 days ago and untouched (reminder due).
  await finish('f3', 9);
  await must(
    db.from('retests').insert({
      user_id: userId.f3, module_id: mod.id, due_at: ago(4), status: 'sent', sent_at: ago(4),
    }),
    'Re-test for Riley'
  );
  // Morgan: watched the first lesson only.
  await must(
    db.from('lesson_progress').insert({
      user_id: userId.f4, lesson_id: lessonIds[0].id, watch_pct: 0.95, watched_at: ago(1),
      quiz_attempts: 0,
    }),
    'Partial progress for Morgan'
  );
  // Taylor and Quinn: not started.

  console.log(
    `\nDone. Sign in with any of these (magic link; demo addresses cannot receive mail, so use\n` +
      `the Supabase dashboard "Generate link" or add yourself as a real staff member):\n` +
      USERS.map((u) => `  ${u.email}@${DOMAIN}  ${u.role}`).join('\n')
  );
}

// Demo data loaded before the Octolab rename carries this tag. Purge clears it
// too, so an existing demo database can be reloaded under the new name.
const LEGACY_TAGS = ['kenshu-demo'];

async function purge() {
  for (const tag of [TAG, ...LEGACY_TAGS]) {
    const result = await must(db.rpc('purge_demo_data', { p_tag: tag }), `Purging demo data (${tag})`);
    console.log(`Purged ${tag}:`, JSON.stringify(result));
  }
  const counts = await must(db.rpc('demo_row_counts'), 'Counting leftovers');
  console.log('Remaining demo rows:', JSON.stringify(counts));
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (command === 'load') await load(flags);
  else if (command === 'purge') await purge();
  else die('Usage: seed/octolab.ts load [--mark-demo] | purge');
}

main().catch((e) => die(String(e)));

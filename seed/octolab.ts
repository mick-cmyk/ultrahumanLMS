// Demo data for the Octolab testing site (and any other demo deployment).
//
//   npm run seed:load            build the made-up transport company, staff, courses, progress
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
import { posterDataUri } from './content/attach-selling';
import { COURSES, type CourseDef } from './content/transport-safety';

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

// A made-up transport and logistics company: head office, three states, four
// depots, and under each depot a warehouse team and a drivers team. Every unit
// below head office carries a state so "by state" reports and state-targeted
// assignments work (the rule uses the state on the person's own unit).
const UNITS: UnitSeed[] = [
  { key: 'hq', parent: null, kind: 'supplier', name: 'Redgum Freight', brand_color: '#9a3412' },
  { key: 'vic', parent: 'hq', kind: 'region', name: 'Victoria', state: 'VIC' },
  { key: 'nsw', parent: 'hq', kind: 'region', name: 'New South Wales', state: 'NSW' },
  { key: 'qld', parent: 'hq', kind: 'region', name: 'Queensland', state: 'QLD' },
  { key: 'dan', parent: 'vic', kind: 'store', name: 'Dandenong depot', state: 'VIC', suburb: 'Dandenong South' },
  { key: 'lav', parent: 'vic', kind: 'store', name: 'Laverton depot', state: 'VIC', suburb: 'Laverton North' },
  { key: 'wet', parent: 'nsw', kind: 'store', name: 'Wetherill Park depot', state: 'NSW', suburb: 'Wetherill Park' },
  { key: 'eag', parent: 'qld', kind: 'store', name: 'Eagle Farm depot', state: 'QLD', suburb: 'Eagle Farm' },
  { key: 'dan-w', parent: 'dan', kind: 'team', name: 'Dandenong warehouse', state: 'VIC', suburb: 'Dandenong South' },
  { key: 'dan-d', parent: 'dan', kind: 'team', name: 'Dandenong drivers', state: 'VIC', suburb: 'Dandenong South' },
  { key: 'lav-w', parent: 'lav', kind: 'team', name: 'Laverton warehouse', state: 'VIC', suburb: 'Laverton North' },
  { key: 'lav-d', parent: 'lav', kind: 'team', name: 'Laverton drivers', state: 'VIC', suburb: 'Laverton North' },
  { key: 'wet-w', parent: 'wet', kind: 'team', name: 'Wetherill Park warehouse', state: 'NSW', suburb: 'Wetherill Park' },
  { key: 'wet-d', parent: 'wet', kind: 'team', name: 'Wetherill Park drivers', state: 'NSW', suburb: 'Wetherill Park' },
  { key: 'eag-w', parent: 'eag', kind: 'team', name: 'Eagle Farm warehouse', state: 'QLD', suburb: 'Eagle Farm' },
  { key: 'eag-d', parent: 'eag', kind: 'team', name: 'Eagle Farm drivers', state: 'QLD', suburb: 'Eagle Farm' },
];

// Progress for one person on one course:
//   proven   finished 9 days ago, later check passed (the number that counts)
//   sent     finished 9 days ago, check emailed 4 days ago, not done yet
//   due      finished 6 days ago, check due now
//   done     finished 2 days ago, check not due yet
//   started  watched the first lesson only
//   (absent) not started
type Status = 'proven' | 'sent' | 'due' | 'done' | 'started';
type CourseKey = keyof typeof COURSES;
type Progress = Partial<Record<CourseKey, Status>>;

type UserSeed = {
  key: string;
  email: string;
  name: string;
  role: 'learner' | 'viewer' | 'manager' | 'admin';
  unit: string;
  scopes?: string[];
  progress?: Progress;
};

// Shorthand: manual handling (everyone) plus fatigue (drivers) or forklift (warehouse).
const pick = (pairs: [CourseKey, Status | undefined][]): Progress =>
  Object.fromEntries(pairs.filter(([, s]) => s)) as Progress;
const P = (mh?: Status) => pick([['manualHandling', mh]]);
const D = (mh?: Status, fat?: Status) => pick([['manualHandling', mh], ['fatigue', fat]]);
const W = (mh?: Status, fk?: Status) => pick([['manualHandling', mh], ['forklift', fk]]);

const USERS: UserSeed[] = [
  // Head office
  { key: 'owner', email: 'owner', name: 'Grace Whitfield (Owner, read only)', role: 'viewer', unit: 'hq', scopes: ['hq'] },
  { key: 'safety', email: 'safety.manager', name: 'Daniel Okafor (Safety Manager)', role: 'admin', unit: 'hq' },
  { key: 'payroll', email: 'payroll', name: 'Jess Lee (Payroll, head office)', role: 'learner', unit: 'hq', progress: P('proven') },
  // State operations managers
  { key: 'ops-vic', email: 'ops.vic', name: 'Priya Nair (Operations Manager, VIC)', role: 'manager', unit: 'vic', scopes: ['vic'], progress: P('proven') },
  { key: 'ops-nsw', email: 'ops.nsw', name: 'Tom Brennan (Operations Manager, NSW)', role: 'manager', unit: 'nsw', scopes: ['nsw'], progress: P('done') },
  { key: 'ops-qld', email: 'ops.qld', name: 'Leilani Fifita (Operations Manager, QLD)', role: 'manager', unit: 'qld', scopes: ['qld'] },
  // Depot managers
  { key: 'dm-dan', email: 'depot.dandenong', name: 'Mel Costa (Depot Manager, Dandenong)', role: 'manager', unit: 'dan', scopes: ['dan'], progress: P('proven') },
  { key: 'dm-lav', email: 'depot.laverton', name: 'Arjun Mehta (Depot Manager, Laverton)', role: 'manager', unit: 'lav', scopes: ['lav'], progress: P('proven') },
  { key: 'dm-wet', email: 'depot.wetherill', name: 'Sophie Tran (Depot Manager, Wetherill Park)', role: 'manager', unit: 'wet', scopes: ['wet'], progress: P('sent') },
  { key: 'dm-eag', email: 'depot.eaglefarm', name: 'Craig Duncan (Depot Manager, Eagle Farm)', role: 'manager', unit: 'eag', scopes: ['eag'], progress: P('started') },
  // Team supervisors
  { key: 'sup-dan-w', email: 'wh.super.dandenong', name: 'Nikos Papadopoulos (Warehouse Supervisor)', role: 'manager', unit: 'dan-w', scopes: ['dan-w'], progress: W('proven', 'proven') },
  { key: 'sup-dan-d', email: 'fleet.super.dandenong', name: 'Kylie Russo (Transport Supervisor)', role: 'manager', unit: 'dan-d', scopes: ['dan-d'], progress: D('proven', 'proven') },
  { key: 'sup-wet-w', email: 'wh.super.wetherill', name: 'Hamid Rahimi (Warehouse Supervisor)', role: 'manager', unit: 'wet-w', scopes: ['wet-w'], progress: W('proven', 'due') },
  { key: 'sup-eag-d', email: 'fleet.super.eaglefarm', name: 'Shane Walker (Transport Supervisor)', role: 'manager', unit: 'eag-d', scopes: ['eag-d'], progress: D('sent') },

  // Dandenong: the depot that has got it
  { key: 'w1', email: 'wh.dandenong.1', name: 'Ella Murphy', role: 'learner', unit: 'dan-w', progress: W('proven', 'proven') },
  { key: 'w2', email: 'wh.dandenong.2', name: 'Lachlan Kelly', role: 'learner', unit: 'dan-w', progress: W('proven', 'proven') },
  { key: 'w3', email: 'wh.dandenong.3', name: 'Mai Nguyen', role: 'learner', unit: 'dan-w', progress: W('proven', 'done') },
  { key: 'd1', email: 'driver.dandenong.1', name: 'Steve Pappas', role: 'learner', unit: 'dan-d', progress: D('proven', 'proven') },
  { key: 'd2', email: 'driver.dandenong.2', name: 'Rhys Evans', role: 'learner', unit: 'dan-d', progress: D('proven', 'proven') },
  { key: 'd3', email: 'driver.dandenong.3', name: 'Gurpreet Singh', role: 'learner', unit: 'dan-d', progress: D('proven', 'sent') },

  // Laverton: mostly there
  { key: 'w4', email: 'wh.laverton.1', name: 'Bianca Rossi', role: 'learner', unit: 'lav-w', progress: W('proven', 'proven') },
  { key: 'w5', email: 'wh.laverton.2', name: 'Josh Taylor', role: 'learner', unit: 'lav-w', progress: W('due', 'done') },
  { key: 'd4', email: 'driver.laverton.1', name: 'Wayne Mitchell', role: 'learner', unit: 'lav-d', progress: D('proven', 'proven') },
  { key: 'd5', email: 'driver.laverton.2', name: 'Fatima Hassan', role: 'learner', unit: 'lav-d', progress: D('proven', 'due') },
  { key: 'd6', email: 'driver.laverton.3', name: 'Ben Carter (on leave)', role: 'learner', unit: 'lav-d' },

  // Wetherill Park: halfway, checks waiting
  { key: 'w6', email: 'wh.wetherill.1', name: 'Tony Haddad', role: 'learner', unit: 'wet-w', progress: W('proven', 'sent') },
  { key: 'w7', email: 'wh.wetherill.2', name: 'Chloe Wilson', role: 'learner', unit: 'wet-w', progress: W('sent', 'started') },
  { key: 'w8', email: 'wh.wetherill.3', name: 'Daniel Kim', role: 'learner', unit: 'wet-w', progress: W('due') },
  { key: 'd7', email: 'driver.wetherill.1', name: 'Mark Sullivan', role: 'learner', unit: 'wet-d', progress: D('proven', 'proven') },
  { key: 'd8', email: 'driver.wetherill.2', name: 'Ali Yilmaz', role: 'learner', unit: 'wet-d', progress: D('sent', 'done') },
  { key: 'd9', email: 'driver.wetherill.3', name: 'Paul Fraser', role: 'learner', unit: 'wet-d', progress: D('started') },

  // Eagle Farm: needs a visit
  { key: 'w9', email: 'wh.eaglefarm.1', name: 'Kiara Thompson', role: 'learner', unit: 'eag-w', progress: W('proven', 'started') },
  { key: 'w10', email: 'wh.eaglefarm.2', name: "Liam O'Brien", role: 'learner', unit: 'eag-w', progress: W('started') },
  { key: 'w11', email: 'wh.eaglefarm.3', name: 'Sione Taufa', role: 'learner', unit: 'eag-w' },
  { key: 'd10', email: 'driver.eaglefarm.1', name: 'Darren Hughes', role: 'learner', unit: 'eag-d', progress: D('sent', 'started') },
  { key: 'd11', email: 'driver.eaglefarm.2', name: 'Emma Clarke', role: 'learner', unit: 'eag-d', progress: D('started') },
  { key: 'd12', email: 'driver.eaglefarm.3', name: 'Jayden Brown', role: 'learner', unit: 'eag-d' },
];

const DRIVER_TEAMS = ['dan-d', 'lav-d', 'wet-d', 'eag-d'];
const WAREHOUSE_TEAMS = ['dan-w', 'lav-w', 'wet-w', 'eag-w'];

type Built = { id: string; moduleId: string; lessons: { id: string; hasQuiz: boolean }[] };

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
    die('A top-level unit already exists, so the demo company cannot be added as a second root.');
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

  // --- Courses --------------------------------------------------------------
  const built = {} as Record<CourseKey, Built>;
  for (const [key, def] of Object.entries(COURSES) as [CourseKey, CourseDef][]) {
    built[key] = await createCourse(def);
    console.log(`Course: ${def.title} (${def.lessons.length} lessons)`);
  }

  // --- Assignments: everyone, drivers only, warehouse only -------------------
  const rule = (r: { all?: boolean; unit_ids?: string[]; exclude_user_ids?: string[] }) => ({
    all: false,
    unit_ids: [] as string[],
    states: [] as string[],
    include_user_ids: [] as string[],
    exclude_user_ids: [] as string[],
    ...r,
  });
  await must(
    db.from('assignments').insert([
      {
        course_id: built.manualHandling.id,
        label: 'Everyone',
        rule: rule({ all: true }),
        due_days: 14,
        created_by: userId.safety,
        demo_tag: TAG,
      },
      {
        course_id: built.fatigue.id,
        label: 'All drivers (Ben excluded while on leave)',
        rule: rule({ unit_ids: DRIVER_TEAMS.map((k) => unitId[k]), exclude_user_ids: [userId.d6] }),
        due_days: 21,
        created_by: userId.safety,
        demo_tag: TAG,
      },
      {
        course_id: built.forklift.id,
        label: 'All warehouse teams',
        rule: rule({ unit_ids: WAREHOUSE_TEAMS.map((k) => unitId[k]) }),
        due_days: 21,
        created_by: userId.safety,
        demo_tag: TAG,
      },
    ]),
    'Creating assignments'
  );

  // --- Progress, so the reports show something -------------------------------
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86400_000).toISOString();

  const finish = async (who: string, c: Built, daysAgo: number) => {
    await must(
      db.from('lesson_progress').insert(
        c.lessons.map((l) => ({
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
  const retest = (who: string, c: Built, row: Record<string, unknown>) =>
    must(db.from('retests').insert({ user_id: userId[who], module_id: c.moduleId, ...row }), `Re-test for ${who}`);

  let records = 0;
  for (const u of USERS) {
    for (const [key, status] of Object.entries(u.progress ?? {}) as [CourseKey, Status][]) {
      const c = built[key];
      records++;
      switch (status) {
        case 'proven':
          await finish(u.key, c, 9);
          await retest(u.key, c, {
            due_at: ago(4), sent_at: ago(4), attempts: 1, last_score: 1, status: 'passed', passed_at: ago(3),
          });
          break;
        case 'sent':
          await finish(u.key, c, 9);
          await retest(u.key, c, { due_at: ago(4), sent_at: ago(4), status: 'sent' });
          break;
        case 'due':
          await finish(u.key, c, 6);
          await retest(u.key, c, { due_at: ago(1), status: 'pending' });
          break;
        case 'done':
          await finish(u.key, c, 2);
          await retest(u.key, c, { due_at: ago(-3), status: 'pending' });
          break;
        case 'started':
          await must(
            db.from('lesson_progress').insert({
              user_id: userId[u.key], lesson_id: c.lessons[0].id, watch_pct: 0.95, watched_at: ago(1), quiz_attempts: 0,
            }),
            `Partial progress for ${u.key}`
          );
          break;
      }
    }
  }
  console.log(`Progress records: ${records}`);

  console.log(
    `\nDone. Demo addresses cannot receive mail. Get a sign-in link with\n` +
      `  npm run login:link -- --email <address>\n` +
      USERS.map((u) => `  ${u.email}@${DOMAIN}  ${u.role}`).join('\n')
  );
}

async function createCourse(def: CourseDef): Promise<Built> {
  const course = (await must(
    db
      .from('courses')
      .insert({ title: def.title, description: def.description, published: true, demo_tag: TAG })
      .select('id')
      .single(),
    `Creating course ${def.title}`
  )) as { id: string };
  const mod = (await must(
    db.from('modules').insert({ course_id: course.id, title: def.module, sort_order: 1 }).select('id').single(),
    `Creating module for ${def.title}`
  )) as { id: string };

  const lessons: Built['lessons'] = [];
  for (let i = 0; i < def.lessons.length; i++) {
    const l = def.lessons[i];
    const lesson = (await must(
      db
        .from('lessons')
        .insert({
          module_id: mod.id,
          title: l.title,
          sort_order: i + 1,
          bunny_video_id: null,
          sample_video_url: l.video,
          image_url: posterDataUri(`Video ${i + 1}`, l.title),
          script: l.script,
          duration_seconds: 30,
          watch_threshold: 0.9,
        })
        .select('id')
        .single(),
      `Creating lesson ${l.title}`
    )) as { id: string };
    if (l.quiz) {
      await must(
        db.from('quizzes').insert({ lesson_id: lesson.id, pass_mark: 0.8, questions: l.quiz }),
        `Creating quiz for ${l.title}`
      );
      // Demo content counts as reviewed, so the check page doesn't flag it.
      await must(
        db.from('lessons').update({ reviewed_at: new Date().toISOString() }).eq('id', lesson.id),
        `Marking ${l.title} reviewed`
      );
    }
    lessons.push({ id: lesson.id, hasQuiz: Boolean(l.quiz) });
  }
  return { id: course.id, moduleId: mod.id, lessons };
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

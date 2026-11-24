// Go-live gate. Run before a deployment takes real users.
//
//   npm run golive:check             report only
//   npm run golive:check -- --finish also switch the database to 'production'
//
// Fails (exit 1) while any demo row exists, while there is no admin, while
// there is no top-level unit, or while no developer is marked. With --finish and a clean result it sets
// app_settings.environment = 'production', after which the database refuses
// demo rows for good.

import { adminClient, getEnvironment, must, parseArgs, setEnvironment } from './db';

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const db = adminClient();

  const problems: string[] = [];
  const env = await getEnvironment(db);
  console.log(`Environment: ${env}`);

  const counts = (await must(db.rpc('demo_row_counts'), 'Counting demo rows')) as Record<string, number>;
  const leftovers = Object.entries(counts).filter(([, n]) => Number(n) > 0);
  for (const [table, n] of leftovers) problems.push(`${n} demo ${table} still present`);
  if (leftovers.length) problems.push('Run: npm run seed:purge');

  const [{ count: admins }, { count: roots }] = await Promise.all([
    db.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true).is('demo_tag', null),
    db.from('units').select('id', { count: 'exact', head: true }).is('parent_id', null).is('demo_tag', null),
  ]);
  if (!admins) problems.push('No real admin exists. Run: npm run admin:bootstrap -- --email ... --name ... --supplier ...');
  if (!roots) problems.push('No real top-level unit exists.');
  // The platform developer keeps the highest access on every deployment.
  const { count: developers } = await db
    .from('users').select('id', { count: 'exact', head: true }).eq('is_developer', true).eq('active', true);
  if (!developers) problems.push('No developer is marked. Run: npm run developer:set -- --email ...');

  if (problems.length) {
    console.error('\nNot ready to go live:\n' + problems.map((p) => `  - ${p}`).join('\n') + '\n');
    process.exit(1);
  }

  console.log('Clean: no demo rows, a real admin, a developer, a real top-level unit.');
  if (flags.has('finish')) {
    await setEnvironment(db, 'production');
    console.log('Environment is now production. Demo rows will be refused from here on.');
  } else if (env !== 'production') {
    console.log('Run again with --finish to switch the environment to production.');
  }
}

main();

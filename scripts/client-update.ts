// Move a client site to a marked version. Run in the CLIENT's folder (for
// example C:\Users\mick\UltraHuman LMS), never in the development folder:
//
//   npm run client:update -- --version v2.3
//   npm run client:update -- --version v2.3 --yes     (no questions asked)
//
// It: checks this is a client folder, fetches the version from GitHub, switches
// the folder to it, installs packages if they changed, runs the checks, shows
// and applies any database changes to THIS client's database, redeploys the
// email functions and sign-in email if they changed, deploys the site to this
// client's Vercel project, checks the site answers, and logs it in releases.log.
// Going back to an older version works the same way (database changes are
// never undone, and old versions keep working with newer databases).

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { die, parseArgs } from './db';

const sh = (cmd: string) => spawnSync(cmd, { shell: true, encoding: 'utf8' });
const run = (cmd: string, what: string, input?: string) => {
  console.log(`\n> ${what}`);
  const r = spawnSync(cmd, { shell: true, stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], input });
  if (r.status !== 0) die(`Stopped: ${what} failed.`);
};

async function main() {
  const { opts, flags } = parseArgs(process.argv.slice(2));
  const version = opts.version ?? '';
  const yes = flags.has('yes');
  if (!/^v\d+(\.\d+){0,2}$/.test(version)) die('Usage: npm run client:update -- --version v2.3 [--yes]');

  // ---------------------------------------------------------- is this a client folder?
  const brand = process.env.NEXT_PUBLIC_BRAND ?? 'octolab';
  if (brand === 'octolab') {
    die('This looks like the development / demo folder (brand octolab). Run client:update in a client folder.');
  }
  if (!existsSync('.vercel/project.json')) die('This folder is not linked to Vercel. Run: npx vercel link');
  const vercel = JSON.parse(readFileSync('.vercel/project.json', 'utf8')) as { projectName?: string };
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
  if (!ref || !appUrl) die('NEXT_PUBLIC_SUPABASE_URL and APP_URL must be set in .env.local.');
  if (!process.env.SUPABASE_ACCESS_TOKEN) die('Add SUPABASE_ACCESS_TOKEN to .env.local so database changes can be applied.');

  // The brand build rewrites these tracked files; they are regenerated anyway.
  sh('git checkout -- supabase/templates');
  const dirty = sh('git status --porcelain --untracked-files=no').stdout.trim();
  if (dirty) die(`This folder has changes that would be lost. Code changes belong in the development folder:\n${dirty}`);

  run('git fetch -q --tags --force origin', 'Fetch versions from GitHub');
  if (!sh(`git rev-parse -q --verify refs/tags/${version}`).stdout.trim()) {
    die(`${version} isn't on GitHub. Mark it first in the development folder: npm run release:mark -- --version ${version}`);
  }
  const from = sh('git describe --tags --always').stdout.trim();
  const fromSha = sh('git rev-parse HEAD').stdout.trim();
  const changed = (path: string) => sh(`git diff --name-only ${fromSha} ${version} -- ${path}`).stdout.trim() !== '';

  console.log(`\nClient:   ${brand}\nSite:     ${appUrl}\nVercel:   ${vercel.projectName}\nDatabase: ${ref}\nFrom:     ${from}\nTo:       ${version}`);
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('\nType "yes" to update this site: ')).trim().toLowerCase();
    rl.close();
    if (answer !== 'yes') die('Nothing changed.');
  }

  // ---------------------------------------------------------- code
  const lockChanged = changed('package-lock.json');
  const functionsChanged = changed('supabase/functions');
  const emailLookChanged = changed(`brands scripts/brand-build.ts`);
  run(`git -c advice.detachedHead=false checkout -q ${version}`, `Switch this folder to ${version}`);
  if (lockChanged) run('npm ci', 'Install packages (they changed in this version)');
  run('npm run -s typecheck', 'Type check');
  run('npm test --silent', 'Unit tests');

  // ---------------------------------------------------------- database
  run(`npx supabase link --project-ref ${ref}`, `Point the database tools at ${ref}`, '');
  const list = sh('npx supabase migration list');
  const pending = (list.stdout.match(/"local":"(\d+)","remote":""/g) ?? []).map((m) => m.match(/\d+/)![0]);
  if (pending.length) {
    console.log(`\nDatabase changes to apply: ${pending.join(', ')}`);
    run('npx supabase db push', 'Apply database changes', yes ? 'y\n' : undefined);
  } else {
    console.log('\nNo database changes in this version.');
  }

  // ---------------------------------------------------------- emails
  if (functionsChanged) {
    run(`npx supabase functions deploy retest-dispatch weekly-digest course-notify --no-verify-jwt --use-api --project-ref ${ref}`,
      'Redeploy the email functions (they changed)');
  }
  if (emailLookChanged) run('npm run -s auth:setup -- --apply', 'Update the sign-in email (brand or template changed)');

  // ---------------------------------------------------------- site
  run('npx vercel deploy --prod --yes', `Deploy ${appUrl}`);
  const res = await fetch(`${appUrl}/login`).catch(() => null);
  if (!res || res.status !== 200) die(`Deployed, but ${appUrl}/login answered ${res?.status ?? 'nothing'}. Check it now.`);

  appendFileSync('releases.log', `${new Date().toISOString()}  ${from} -> ${version}  ${appUrl}\n`);
  console.log(`\nDone. ${appUrl} is on ${version}.\n`);
}

main().catch((e) => die(String(e)));

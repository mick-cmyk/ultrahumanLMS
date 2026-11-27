// Mark a tested version that client sites may take. Run in the development
// folder (LMS Build OUt), on main, with everything committed:
//
//   npm run release:mark -- --version v2.3
//   npm run release:mark -- --version v2.3 --note "Next button, login countdown"
//
// It runs every check (type check, unit tests, every migration and database
// test in PGlite), then tags the commit "Version 2.3 (date)" and pushes main
// and the tag to every GitHub copy (origin and each client remote). Clients
// then take it with `npm run client:update -- --version v2.3` in their folder.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { die, parseArgs } from './db';

const sh = (cmd: string) => spawnSync(cmd, { shell: true, encoding: 'utf8' });
const run = (cmd: string, what: string) => {
  console.log(`\n> ${what}`);
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  if (r.status !== 0) die(`Stopped: ${what} failed. Nothing has been marked.`);
};

const { opts } = parseArgs(process.argv.slice(2));
const version = opts.version ?? '';
if (!/^v\d+(\.\d+){0,2}$/.test(version)) die('Usage: npm run release:mark -- --version v2.3 [--note "what changed"]');

// Client folders have a CLAUDE.local.md and their own brand; releases are only
// marked in the development folder.
const brandId = process.env.NEXT_PUBLIC_BRAND ?? 'octolab';
if (brandId !== 'octolab' || existsSync('CLAUDE.local.md')) {
  die('This is a client folder. Mark releases in the development folder:\n  cd "C:\\Users\\mick\\LMS Build OUt"');
}
if (sh('git rev-parse --abbrev-ref HEAD').stdout.trim() !== 'main') die('Switch to main first.');
const dirty = sh('git status --porcelain --untracked-files=no').stdout.trim();
if (dirty) die(`Commit or put away these changes first:\n${dirty}`);
if (sh(`git rev-parse -q --verify refs/tags/${version}`).stdout.trim()) die(`${version} already exists. Pick the next number.`);

run('npm run -s typecheck', 'Type check');
run('npm test --silent', 'Unit tests');
run('npm run -s test:db:local', 'Migrations and database tests (PGlite)');

const date = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
const label = `Version ${version.slice(1)} (${date})${opts.note ? `: ${opts.note}` : ''}`;
run(`git tag -a ${version} -m ${JSON.stringify(label)}`, `Tag ${label}`);

const remotes = sh('git remote').stdout.split(/\s+/).filter(Boolean);
for (const remote of remotes) {
  run(`git push -q ${remote} main ${version}`, `Push main and ${version} to ${remote}`);
}
console.log(`\n${label} is marked and on GitHub (${remotes.join(', ')}).`);

// Every client site that takes these releases: folders next to this one with a
// CLAUDE.local.md, cloned from one of this folder's GitHub copies.
const clean = (url: string) => url.trim().replace(/\.git$/, '').toLowerCase();
const urls = new Set(remotes.map((r) => clean(sh(`git remote get-url ${r}`).stdout)));
const here = resolve('.');
const clients: { folder: string; site: string; on: string }[] = [];
for (const name of readdirSync(dirname(here))) {
  const folder = join(dirname(here), name);
  if (folder === here || !existsSync(join(folder, 'CLAUDE.local.md')) || !existsSync(join(folder, '.git'))) continue;
  if (!urls.has(clean(sh(`git -C "${folder}" remote get-url origin`).stdout))) continue;
  // The last line of releases.log: "<when>  <from> -> <to>  <site>".
  const log = join(folder, 'releases.log');
  const last = existsSync(log) ? (readFileSync(log, 'utf8').trim().split(/\r?\n/).pop() ?? '') : '';
  const m = last.match(/->\s+(\S+)\s+(\S+)/);
  clients.push({ folder, site: m?.[2] ?? '(not deployed yet)', on: m?.[1] ?? '?' });
}

if (clients.length === 0) {
  console.log(`To put it on a client site, in that client's folder run:\n  npm run client:update -- --version ${version}\n`);
} else {
  console.log('\nNow update each client site, one at a time, in its own folder:');
  for (const c of clients) {
    console.log(`\n  ${c.site}  (now on ${c.on})`);
    console.log(`    cd "${c.folder}"`);
    console.log(`    npm run client:update -- --version ${version}`);
  }
  console.log(`\nThen come back here:\n    cd "${here}"\n`);
}

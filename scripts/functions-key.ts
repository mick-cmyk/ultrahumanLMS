// Give the email functions (retest-dispatch, weekly-digest, course-notify) this
// site's new-style secret key, then redeploy them.
//
//   npm run functions:key
//
// Reads SUPABASE_SERVICE_ROLE_KEY from .env.local. When it is a new-style key
// (sb_secret_...), it is saved as the function secret SB_SECRET_KEY through a
// temporary file, so it never appears on screen or in the command line. With an
// old-style key it only redeploys, and the functions keep using the old key
// Supabase injects (which stops working when Supabase retires old keys).
//
// The project comes from NEXT_PUBLIC_SUPABASE_URL. Uses SUPABASE_ACCESS_TOKEN
// from .env.local if there is one, otherwise your `npx supabase login`.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { die } from './db';

function run(cmd: string) {
  console.log(`\n> ${cmd}`);
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
  if (r.status !== 0) die(`That command failed (exit ${r.status}). Fix it and run again.`);
}

const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) die('NEXT_PUBLIC_SUPABASE_URL in .env.local must look like https://<ref>.supabase.co');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (key.startsWith('sb_secret_')) {
  const dir = mkdtempSync(join(tmpdir(), 'fnkey-'));
  const file = join(dir, 'secret.env');
  try {
    writeFileSync(file, `SB_SECRET_KEY=${key}\n`, { mode: 0o600 });
    run(`npx supabase secrets set --env-file "${file}" --project-ref ${ref}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('Saved the new-style secret key for the email functions (SB_SECRET_KEY).');
} else {
  console.log(
    '\nNote: SUPABASE_SERVICE_ROLE_KEY in .env.local is an old-style key, so the email functions keep\n' +
      'using the old key. Before 2027, create a secret key in Supabase (Project Settings, API Keys),\n' +
      'put it in .env.local as SUPABASE_SERVICE_ROLE_KEY, run `npm run vercel:env`, then run this again.'
  );
}

run(`npx supabase functions deploy retest-dispatch weekly-digest course-notify --no-verify-jwt --use-api --project-ref ${ref}`);
console.log(`\nDone. The email functions on ${ref} are redeployed.\n`);

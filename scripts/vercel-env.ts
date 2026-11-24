// Copy this deployment's settings from .env.local into its linked Vercel
// project (production). Run from the deployment's own folder after
// `npx vercel link`:
//
//   npm run vercel:env
//
// Public values go in as plain variables; keys and addresses as sensitive
// ones. Values are passed to the Vercel CLI on stdin and never printed.
// Re-running replaces them. Redeploy afterwards for them to take effect.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { die } from './db';

const PLAIN = ['NEXT_PUBLIC_BRAND', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'APP_URL',
  'NEXT_PUBLIC_APP_URL'];
const SENSITIVE = ['SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'EMAIL_FROM', 'BUNNY_STREAM_LIBRARY_ID',
  'BUNNY_STREAM_API_KEY', 'BUNNY_STREAM_EMBED_TOKEN_KEY'];

if (!existsSync('.vercel/project.json')) die('This folder is not linked to Vercel yet. Run: npx vercel link');

let failed = 0;
for (const key of [...PLAIN, ...SENSITIVE]) {
  const value = process.env[key];
  if (!value) {
    console.log(`${key}: not in .env.local, skipped`);
    continue;
  }
  const args = ['vercel', 'env', 'add', key, 'production', '--force', ...(SENSITIVE.includes(key) ? ['--sensitive'] : [])];
  const r = spawnSync('npx', args, { input: value, encoding: 'utf8', shell: true });
  if (r.status === 0) console.log(`${key}: set${SENSITIVE.includes(key) ? ' (sensitive)' : ''}`);
  else {
    failed++;
    console.log(`${key}: FAILED\n${`${r.stdout ?? ''}${r.stderr ?? ''}`.split(value).join('<hidden>').split('\n').slice(-5).join('\n')}`);
  }
}
console.log(failed ? `\n${failed} failed. Fix and run again.` : '\nDone. Redeploy for the settings to take effect: npx vercel deploy --prod');

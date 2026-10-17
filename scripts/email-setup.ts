// One command to switch on the scheduled emails for a deployment.
//
//   npm run email:setup                 dry run: functions log emails, nothing is sent
//   npm run email:setup -- --live       real sending (needs RESEND_API_KEY and EMAIL_FROM in .env.local)
//   npm run email:setup -- --brand ultrahuman --app-url https://lms.example.com
//
// It (1) makes a fresh random CRON_SECRET, (2) sets the edge function secrets
// from the brand file, (3) deploys retest-dispatch and weekly-digest, and
// (4) schedules the two hourly jobs against the new secret. Safe to re-run;
// each run replaces the secret everywhere at once.
//
// One-time prerequisite on this machine:  npx supabase login
// The project is taken from NEXT_PUBLIC_SUPABASE_URL, so no linking is needed.

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getBrand } from '../brands';
import { adminClient, die, must, parseArgs } from './db';

function run(cmd: string) {
  const shown = cmd.replace(/(CRON_SECRET|RESEND_API_KEY)=\S+/g, '$1=<hidden>');
  console.log(`\n> ${shown}`);
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true });
  if (r.status !== 0) die(`That command failed (exit ${r.status}). Fix it and run again.`);
}

const q = (v: string) => `"${v.replace(/(["\\$`])/g, '\\$1')}"`;

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const live = flags.has('live');
  const brand = getBrand(opts.brand);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ref = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!ref) die('NEXT_PUBLIC_SUPABASE_URL in .env.local must look like https://<ref>.supabase.co');

  const appUrl = (opts['app-url'] ?? process.env.APP_URL ?? '').replace(/\/$/, '');
  if (!appUrl || appUrl.startsWith('http://localhost')) {
    die('Pass --app-url with the real site address, for example --app-url https://lms.kenshu.com.au');
  }

  if (live && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)) {
    die('--live needs RESEND_API_KEY and EMAIL_FROM in .env.local (see docs/EMAIL-SETUP.md).');
  }

  const secret = randomBytes(24).toString('hex');
  const pairs: [string, string | null][] = [
    ['CRON_SECRET', secret],
    ['APP_URL', appUrl],
    ['BRAND_NAME', brand.name],
    ['BRAND_COLOR', brand.primaryColor],
    ['BRAND_LOGO_URL', brand.logoUrl],
    ['BRAND_CHECK_NAME', brand.voice.checkName],
    ['BRAND_SIGNOFF', brand.voice.emailSignoff],
    ['BRAND_SUPPORT_EMAIL', brand.supportEmail],
    ['EMAIL_DRY_RUN', live ? '0' : '1'],
  ];
  if (live) {
    pairs.push(['RESEND_API_KEY', process.env.RESEND_API_KEY as string]);
    pairs.push(['EMAIL_FROM', process.env.EMAIL_FROM as string]);
  }
  const args = pairs.filter(([, v]) => v).map(([k, v]) => `${k}=${q(v as string)}`);

  console.log(`Project ${ref}, brand ${brand.id}, ${live ? 'LIVE sending' : 'DRY RUN (nothing is emailed)'}`);
  run(`npx supabase secrets set ${args.join(' ')} --project-ref ${ref}`);
  run(`npx supabase functions deploy retest-dispatch weekly-digest --no-verify-jwt --use-api --project-ref ${ref}`);

  const db = adminClient();
  const result = await must(
    db.rpc('schedule_edge_jobs', { p_functions_base_url: `https://${ref}.supabase.co/functions/v1`, p_secret: secret }),
    'Scheduling the hourly jobs'
  );
  console.log('\nScheduled:', JSON.stringify(result));
  console.log(
    live
      ? '\nLive. Re-tests send from 8am Sydney time and the digest goes out Monday mornings.'
      : '\nDry run. The jobs fire hourly and log what they would send. Run again with --live when Resend is ready.'
  );
}

main().catch((e) => die(String(e)));

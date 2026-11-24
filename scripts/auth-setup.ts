// Set a hosted Supabase project's sign-in settings for this deployment, through
// the Management API. Run from the deployment's own folder:
//
//   npm run auth:setup            show the current settings
//   npm run auth:setup -- --apply set them
//
// --apply sets: site URL and redirect allow list (APP_URL), sign-ups off
// (accounts are only made by admins, managers or approved requests), Resend as
// the mail server, the brand's magic-link email and subject, and 100 login
// emails an hour.
//
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, APP_URL, NEXT_PUBLIC_BRAND,
// RESEND_API_KEY, EMAIL_FROM and SUPABASE_ACCESS_TOKEN (a personal access
// token with Project Settings read-write). Secrets are never printed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getBrand } from '../brands';
import { die, parseArgs } from './db';

const env = process.env;
const ref = env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) die('NEXT_PUBLIC_SUPABASE_URL in .env.local must look like https://<ref>.supabase.co');
if (!env.SUPABASE_ACCESS_TOKEN) die('Add SUPABASE_ACCESS_TOKEN to .env.local (see docs/NEW-CLIENT.md).');
const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
const hide = (s: string) => (env.RESEND_API_KEY ? s.split(env.RESEND_API_KEY).join('<hidden>') : s);

const SHOW = ['site_url', 'uri_allow_list', 'disable_signup', 'smtp_host', 'smtp_port', 'smtp_user',
  'smtp_admin_email', 'smtp_sender_name', 'mailer_subjects_magic_link', 'rate_limit_email_sent'];

async function show() {
  const res = await fetch(api, { headers });
  if (!res.ok) die(`Could not read the settings (${res.status}): ${hide(await res.text())}`);
  const cfg = await res.json();
  const out: Record<string, unknown> = {};
  for (const k of SHOW) out[k] = cfg[k];
  out.smtp_password_set = Boolean(cfg.smtp_pass);
  console.log(JSON.stringify(out, null, 2));
}

async function apply() {
  const brand = getBrand();
  const appUrl = (env.APP_URL ?? '').replace(/\/$/, '');
  if (!appUrl.startsWith('https://')) die('APP_URL in .env.local must be the real https:// site address.');
  const from = (env.EMAIL_FROM ?? '').match(/^(.*?)\s*<([^>]+)>$/);
  if (!from) die('EMAIL_FROM in .env.local must look like: Name <address@your-domain>');
  if (!env.RESEND_API_KEY) die('Add RESEND_API_KEY to .env.local.');

  // The brand's email template, generated fresh, then the tracked files put
  // back so this folder stays clean for updates.
  const build = spawnSync(`npx tsx scripts/brand-build.ts --brand ${brand.id}`, { shell: true, encoding: 'utf8' });
  if (build.status !== 0) die(`brand-build failed:\n${build.stderr}`);
  const template = readFileSync(join(process.cwd(), 'supabase', 'templates', 'magic_link_hosted.html'), 'utf8');
  spawnSync('git checkout -- supabase/templates', { shell: true });

  const body = {
    site_url: appUrl,
    uri_allow_list: `${appUrl}/**`,
    disable_signup: true,
    smtp_host: 'smtp.resend.com',
    smtp_port: '465',
    smtp_user: 'resend',
    smtp_pass: env.RESEND_API_KEY,
    smtp_admin_email: from[2],
    smtp_sender_name: from[1],
    rate_limit_email_sent: 100,
    mailer_subjects_magic_link: `Your ${brand.name} login link`,
    mailer_templates_magic_link_content: template,
  };
  const res = await fetch(api, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!res.ok) die(`Could not save the settings (${res.status}): ${hide(await res.text())}`);
  console.log(`Sign-in settings saved for ${brand.name} (${ref}).`);
  await show();
}

const { flags } = parseArgs(process.argv.slice(2));
(flags.has('apply') ? apply() : show()).catch((e) => die(hide(String(e))));

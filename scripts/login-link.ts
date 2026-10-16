// Print a one-off sign-in link for any existing user, without sending email.
// For testing demo accounts, whose .invalid addresses cannot receive mail.
//
//   npm run login:link -- --email admin@kenshu-demo.invalid
//   npm run login:link -- --email store.manager@kenshu-demo.invalid --base https://lms.kenshu.com.au
//
// Open the printed link in a browser (a private window is best, so you do not
// replace your own session). It uses the app's /auth/confirm route. Needs the
// service role key, so it only works on a machine that has .env.local.

import { adminClient, die, parseArgs } from './db';

async function main() {
  const { opts } = parseArgs(process.argv.slice(2));
  const email = opts.email?.trim().toLowerCase();
  const base = (opts.base ?? 'http://localhost:3000').replace(/\/$/, '');
  if (!email) die('Usage: login:link -- --email someone@example.com [--base https://your-site]');

  const db = adminClient();
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !data?.properties?.hashed_token) {
    die(`Could not create a link for ${email}: ${error?.message ?? 'no token returned'}`);
  }
  const url = `${base}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink`;
  console.log(`\nSign-in link for ${email} (single use, expires soon):\n\n${url}\n`);
}

main().catch((e) => die(String(e)));

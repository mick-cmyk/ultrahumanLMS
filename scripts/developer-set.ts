// Mark the platform developer on this deployment: the highest access, which
// only the developer can agree to give up (20261126000200_developer.sql).
//
//   npm run developer:set -- --email you@example.com
//
// The person must already have a login (run admin:bootstrap first on a new
// deployment). They are made an active admin and marked as developer. Run it
// on every deployment, for every client; golive:check fails without one.

import { adminClient, die, must, parseArgs } from './db';

async function main() {
  const { opts } = parseArgs(process.argv.slice(2));
  const email = opts.email?.trim().toLowerCase();
  if (!email || !email.includes('@')) die('Usage: developer:set -- --email you@example.com');
  if (email.endsWith('.invalid')) die('.invalid addresses are reserved for demo data.');

  const db = adminClient();
  const user = (await must(
    db.from('users').select('id, full_name, role, active, is_developer').eq('email', email).maybeSingle(),
    'Looking up the person'
  )) as { id: string; full_name: string | null; role: string; active: boolean; is_developer: boolean } | null;
  if (!user) die(`No login for ${email} yet. Run admin:bootstrap for them first.`);
  if (user.is_developer) {
    console.log(`${email} is already the developer. Nothing to do.`);
    return;
  }

  await must(
    db.from('users').update({ role: 'admin', active: true, is_developer: true }).eq('id', user.id).select('id'),
    'Marking the developer'
  );
  console.log(`${user.full_name ?? email} (${email}) is now the developer on this deployment.`);
  console.log('Nobody can change their role, deactivate them or remove the access unless they approve it.');
}

main();

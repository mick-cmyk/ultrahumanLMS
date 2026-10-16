// Create the first real admin (and the top-level supplier unit if there is none).
//
//   npm run admin:bootstrap -- --email you@example.com --name "Your Name" --supplier "Supplier Name"
//
// Safe to run again: an existing user is made admin and moved to the supplier
// unit, nothing else changes. Login is by magic link, so no password is set.

import { adminClient, die, must, parseArgs } from './db';

async function main() {
  const { opts } = parseArgs(process.argv.slice(2));
  const email = opts.email?.trim().toLowerCase();
  const name = opts.name?.trim();
  const supplier = opts.supplier?.trim();
  
  if (!email || !email.includes('@')) {
    die('Usage: admin:bootstrap -- --email you@example.com --name "Your Name" --supplier "Supplier Name"');
  }
  if (email.endsWith('.invalid')) die('.invalid addresses are reserved for demo data.');
  
  const db = adminClient();
  
  const roots = (await must(
    db.from('units').select('id, name').is('parent_id', null),
    'Looking for the top-level unit'
  )) as { id: string; name: string }[];
  
  let rootId: string;
  if (roots.length) {
    rootId = roots[0].id;
    console.log(`Using existing top-level unit: ${roots[0].name}`);
  } else {
    if (!supplier) die('No top-level unit yet. Pass --supplier "Supplier Name" to create it.');
    const row = (await must(
      db.from('units').insert({ parent_id: null, kind: 'supplier', name: supplier }).select('id').single(),
      'Creating the supplier unit'
    )) as { id: string };
    rootId = row.id;
    console.log(`Created top-level unit: ${supplier}`);
  }
  
  let userId: string | undefined;
  const found = (await must(
    db.from('users').select('id').ilike('email', email).maybeSingle(),
    'Looking up the user'
  )) as { id: string } | null;
  
  if (found) {
    userId = found.id;
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: name ? { full_name: name } : {},
    });
    if (error || !data.user) die(`Creating the user failed: ${error?.message}`);
    userId = data.user.id;
  }
  
  await must(
    db
      .from('users')
      .update({ role: 'admin', unit_id: rootId, active: true, ...(name ? { full_name: name } : {}) })
      .eq('id', userId),
    'Making the user an admin'
  );
  await must(db.from('user_scopes').delete().eq('user_id', userId), 'Clearing scopes');
  
  console.log(`${email} is an admin. They can sign in with a magic link from the login page.`);
}

main().catch((e) => die(String(e)));

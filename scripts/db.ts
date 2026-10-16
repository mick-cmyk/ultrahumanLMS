// Shared bits for the command-line tools (seed, bootstrap, go-live check).
// These run with the service role key from .env.local, on your own machine.
// They are never part of the deployed app.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set both in .env.local.'
    );
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function die(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

export async function must<T>(
  p: PromiseLike<{ data: T; error: { message: string } | null }>,
  what: string
): Promise<T> {
  const { data, error } = await p;
  if (error) die(`${what} failed: ${error.message}`);
  return data;
}

export async function getEnvironment(db: SupabaseClient): Promise<string> {
  const row = await must(
    db.from('app_settings').select('value').eq('key', 'environment').maybeSingle(),
    'Reading app_settings'
  );
  return (row as { value: string } | null)?.value ?? 'production';
}

export async function setEnvironment(db: SupabaseClient, value: 'demo' | 'production') {
  await must(
    db.from('app_settings').upsert({ key: 'environment', value }),
    `Setting environment to ${value}`
  );
}

/** Tiny argv parser: --flag, --key value, --key=value. */
export function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > -1) {
      opts[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      opts[a.slice(2)] = argv[++i];
    } else {
      flags.add(a.slice(2));
    }
  }
  return { flags, opts, positional };
}

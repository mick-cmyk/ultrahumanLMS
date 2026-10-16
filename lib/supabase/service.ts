import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Service-role client — bypasses RLS. Use ONLY in server code that has already
// established its own authorisation (here: a valid single-use re-test token).
// The `server-only` import makes bundling this into client code a build error.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

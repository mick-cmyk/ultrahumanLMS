// The key the email functions use to reach the database.
//
// SB_SECRET_KEY is a new-style secret key (sb_secret_...), set by
// `npm run functions:key`. Until it is set we fall back to the old-style
// service role key that Supabase injects automatically. Supabase is switching
// the old keys off (expected early 2027), so every deployment should have
// SB_SECRET_KEY set before then. (Names starting SUPABASE_ are reserved, so the
// new key cannot use one.)
export const SERVICE_KEY =
  Deno.env.get('SB_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

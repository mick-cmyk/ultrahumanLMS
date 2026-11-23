# CLAUDE.md: Retail training LMS

Staff watch short videos, pass a quiz, then prove they still know it with a re-test a few days later. Brand-agnostic: each brand gets its own Supabase project and Vercel project, with colours, name, links and email voice set by configuration. First deployment is the Octolab demo (`lms.octolab.com.au`; brand site octolab.com.au, renamed from Kenshu on 17 Nov 2026); UltraHuman follows.

`docs/DESIGN-v2.md` describes the model. `docs/HANDOVER.md` is the current status. `lms-build-spec.md` is the original spec; where it disagrees with DESIGN-v2 (groups layer, org/store tables, ltree), DESIGN-v2 wins. The path column is `uuid[]`, not ltree.

## The model in one paragraph

One `units` tree per deployment: supplier (root) > Level 1 retail brand > Level 2 training manager or state rep > Level 3 store manager, with floor staff attached to exactly one unit. Staff can also hang directly off the supplier with no middle man. Roles: learner, viewer (read-only reporting), manager (manages staff in their branch), admin (supplier staff; the only role that assigns courses). Viewers and managers are scoped by `user_scopes(user_id, unit_id)` and see their unit plus everything below it.

## Rules that must not be broken

- **Assignment rules** are `{all, unit_ids[], states[], include_user_ids[], exclude_user_ids[]}` and are evaluated only by the Postgres function `user_matches_rule`. Never reimplement it in TypeScript. Rules match by unit, not role, so managers inside a targeted unit are assigned too. The states filter uses the state on the user's own unit, so stores need `state` set.
- **Authorisation lives in the database.** Security-definer functions use `auth.uid()` and run as the caller. The service role key is used only to create logins (`lib/provision.ts`, including approved self sign-ups via `/api/register`), validate re-test tokens and run CLI scripts. Never change an existing user's role when re-provisioning them.
- **Privileges are an allowlist** (`20261017001000_lockdown.sql`). New tables and functions get no grants by default. Internal functions are service-role only. No write grants on `lesson_progress`, `retests`, `retest_tokens`.
- **Self sign-up** (`/register`, `/register/<code>`) records requests through `submit_registration`; approval is a database decision (`can_decide_registration`). An existing login is never changed by signing up, and the public answer never reveals whether an email has an account.
- **Magic links only.** No password UI. Re-test emails open a landing page with a Start button; only the POST to `/api/retest/start` issues a session (mail scanners prefetch GETs).
- **Courses are built in the app** (`/build`, admins) through `/api/courses` under the admin's session. Quiz question shape is enforced in the database (`quizzes_check_questions`); `lib/quiz-csv.ts` and `lib/course-check.ts` are the shared parse and publish rules. Never delete content that has learner progress.
- **Watch tracking** counts unique seconds seen, at least 90% of duration. The server keeps `greatest(existing, incoming)`, so scrubbing to the end never counts.
- **No em dashes** in UI copy or email. Australian English, plain language. The readers are retail staff.
- Schema changes are migration files in `supabase/migrations/`. Never instruct dashboard changes.

## Brands

Each deployment is one brand, chosen by `NEXT_PUBLIC_BRAND` (default `octolab`). A brand is one file in `brands/` (name, primary colour, logo, support email, links, voice, level labels) registered in `brands/index.ts`. The UI uses the Tailwind tokens `bg-brand`, `text-brand-fg`, `text-brand-ink`, `bg-brand-soft`, derived and contrast-checked from the primary colour in `brands/colour.ts`. Never hardcode a brand colour or name in a component. Status colours (green, amber, red) are fixed on purpose. Per-retailer logos and colours are data on units in the database, not brand files.

After editing a brand file run `npm run brand:build` (regenerates the magic-link templates) and `npm run brand:secrets -- --app-url https://...` (prints the edge function secrets so emails match the app).

## Demo data

Demo rows carry `demo_tag` and `.invalid` emails (the database enforces both). `app_settings.environment` is `demo` or `production` (default production) and the database refuses demo rows in production.

- `npm run seed:load -- --mark-demo` builds the Octolab demo tree, staff, course, assignments and progress (flips a brand-new database to demo mode).
- `npm run seed:purge` deletes everything the seed created.
- `npm run admin:bootstrap -- --email x --name "Y" --supplier "Z"` creates the first real admin.
- `npm run golive:check [-- --finish]` fails while any demo row exists; `--finish` switches the database to production.

Scripts read `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, publishable key, `SUPABASE_SERVICE_ROLE_KEY`). Never paste the service role key into chat. `npm run login:link -- --email x@octolab-demo.invalid` prints a sign-in link for a demo user.

## Scheduled jobs

Hourly pg_cron calls two edge functions; they act only in the Sydney send window (8am for four hours, `SEND_START_HOUR` and `SEND_WINDOW_HOURS`). `retest-dispatch` sends due re-tests (7-day token) and one reminder after 3 days. `weekly-digest` acts Mondays and claims the ISO week via `claim_job_run`, so it sends once a week. Both fail closed without `CRON_SECRET`.

## Testing

- Database tests: `supabase/tests/*.test.sql`, run inside `begin; ... rollback;`. Old tests are in `supabase/tests_archive/`, old migrations in `supabase/migrations_archive/`.
- `npm run test:db:local` runs every migration and database test in PGlite (in-memory Postgres, no Docker, no project). Use it before applying a migration anywhere; it stands in for Supabase's auth and storage, so still run `supabase test db` on a real project before go-live.
- `npm test` runs the TypeScript unit tests (Vitest, `tests/*.test.ts`).
- `npm run typecheck` before every commit.
- Verify features as a real role (learner, viewer, manager, admin), not as the service role.

## Conventions

Next.js 16 App Router, TypeScript, Tailwind v4. Middleware is `proxy.ts`. Server components and route handlers by default. Supabase clients via `@supabase/ssr`. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

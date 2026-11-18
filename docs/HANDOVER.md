# Handover (updated 19 Nov 2026)

Status of the v2 rebuild: brand-agnostic training LMS on a single unit tree. Older notes (NARTA, JB Hi-Fi, groups and orgs, the no-login token page) are superseded and live in git history.

## Database status (19 Nov 2026)

- **LMS Demo V1** (`nfghpuwtdokoleobjekq`) sits in the Pro org of Supabase login **test@mickrussell.com**. Reconnect the claude.ai Supabase connector with that login for database work.
- **Migration drift repaired.** The live schema was compared object by object against PGlite running the repo's 13 migrations (all 47 functions, policies, columns, constraints, triggers and grants match), then `supabase_migrations.schema_migrations` was renumbered to the repo file versions. Re-check with `scripts/schema-fingerprint.sql` if in doubt.
- **Applied:** `20261118000100_scorm` and `20261118000200_rate_limit`, recorded under those versions. All 15 records match `supabase/migrations/`.
- **Tests on the live project**, each in a transaction rolled back by a final raised error: core 69/69, learning 84/84, reporting 58/58, rate limit 12/12, SCORM 49/50. The one SCORM miss was the error code for a refused delete (23503 on Supabase, 23001 in PGlite); the test now checks the refusal, not the code.
- **Demo data purged.** The Kenshu demo (11 units, 11 staff, 1 course, 4 assignments) is gone. Only Mick's real admin login (mick@mickrussell.com) remains, detached from any unit (it pointed at the demo supplier). Database is still in `demo` mode. When new demo data is loaded, attach that login to the new supplier unit.

## To do (as of 19 Nov 2026)

**Mick (account access):**
1. ~~Find the Supabase account~~ Done 19 Nov: test@mickrussell.com.
2. **New demo data** (Mick to decide content). The old seed still works if wanted: `npm run seed:load -- --mark-demo`. Then put Mick's admin login back under the supplier unit.
3. **Domain `lms.octolab.com.au` (confirmed).** Vercel domain; Supabase Site URL, redirect URLs and hosted magic-link template (paste the regenerated `supabase/templates/magic_link_hosted.html`); then `npm run email:setup -- --app-url https://lms.octolab.com.au`.
4. **Email sender** (park until we do email work in the app): verify an `octolab.com.au` sending domain in Resend (DNS records, then wait), then change `EMAIL_FROM` in `.env.local` (still `Kenshu Training <training@mail.kenshu.com.au>`) and in the edge-function secrets.
5. Confirm whether the orange brand (`a93cfa2`) was ever deployed with `npx vercel deploy --prod`, and whether the hosted magic-link template was pasted into Supabase.

**Code:**
6. **Octolab logo** is saved at `public/brand/octolab-logo.png` (square octopus mark). Set `logoUrl` in `brands/octolab.ts` to `https://lms.octolab.com.au/brand/octolab-logo.png` once that site is live, then `npm run brand:build`.
7. **Colour**: keeping the orange `#ED4E05` for now; check it against octolab.com.au and swap if the site uses a different primary.
8. Brand-file fields still to confirm with Mick (don't invent addresses): `supportEmail`, `emailFromName`, `voice.emailSignoff`.
9. **SCORM 1.2: on the live database since 19 Nov** (migrations applied, tests pass there). Still to do by hand: import a package on `/import` as an admin, preview it, assign it, take it as a learner, and run an exported zip (`npm run scorm:export -- --seed attach-selling`) through SCORM Cloud or Moodle before any customer gets one. See "SCORM" below.
10. ~~Migration version drift~~ Repaired 19 Nov (see Database status). Note for next time: the MCP `apply_migration` stamps its own version; renumber the record to the file's version straight after.
11. Captions: the sample clips have no `<track>`, and Bunny captions need turning on per video when real videos arrive.

## SCORM (built 18 Nov 2026)

- **Import** (`/import`, admins): zip unpacked and checked in the browser (manifest, zip-slip, 50 MB per file, launch file present), files go straight to the private `scorm` bucket under the admin's session, then a package row and a `scorm` lesson. New course option publishes by default (there's no other publish control in the app). Admins can preview any SCORM lesson; preview saves nothing.
- **Player**: the app's own SCORM 1.2 runtime (`lib/scorm/runtime.ts`) as `window.API`; package files served same-origin from `/scorm-files/<package>/...` with byte ranges; access decided by storage RLS from the learner's assignments, no service role. `passed`/`completed` stamps `lesson_progress`, so reports need no change. Never steps back from complete. SCORM-only modules get no re-test.
- **Export**: `npm run scorm:export -- --course <id>` (or `--seed attach-selling`). Self-contained zip, vanilla player with the app's rules. Answers are inside the package by necessity; no week-later check. Bunny videos need MP4 fallback on and `BUNNY_STREAM_CDN_HOST`.
- **Trust**: package files run same-origin, so a package can do what an app page can. Only admins upload; treat packages like code.
- **Verified**: 50 database checks (`v2_scorm.test.sql`, in PGlite), unit tests for manifest/runtime/unpack/export, and the exported demo course run in a browser against the real runtime (scrubbing doesn't count, full play unlocks the quiz, all lessons report passed/100, finish sends session time, resume works). On the live project (19 Nov) the database side also passed against Supabase's real storage policies and auth. **Not yet verified**: the import page and player end to end in a browser against the live project.

## Done

- v2 schema applied to Supabase project **LMS Demo V1** (free plan, ap-south-1). Migrations `20261017000100` to `20261017001100` in `supabase/migrations/`. 69 database checks pass (`supabase/tests/v2_core.test.sql`, run inside a rolled-back transaction).
- Privilege allowlist, scoped RLS, delayed re-tests, demo-data guard and purge.
- App: provisioning that never changes an existing role; People, Structure, Assign, Team, Reporting pages for the unit tree; session-based re-test link (landing page, Start button, POST issues the session).
- Edge functions: `retest-dispatch` and `weekly-digest` act only in the Sydney send window; digest once per ISO week.
- Brand config: `brands/*.ts`, one per deployment via `NEXT_PUBLIC_BRAND`; app, emails and magic-link template all follow it.
- Demo tooling: `seed/octolab.ts`, `scripts/bootstrap-admin.ts`, `scripts/go-live-check.ts`.

## To get the Octolab demo running

1. In `.env.local` set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key) and `SUPABASE_SERVICE_ROLE_KEY` for LMS Demo V1 (Supabase dashboard, Project Settings, API). Optionally `NEXT_PUBLIC_BRAND=octolab` (the default). To sign in as a demo user: `npm run login:link -- --email admin@octolab-demo.invalid`.
2. `npm run seed:load -- --mark-demo`
3. Scheduled emails: `npx supabase login` once, then `npm run email:setup -- --app-url https://lms.octolab.com.au`. It makes a fresh `CRON_SECRET`, sets the edge function secrets from the brand file, deploys both functions and schedules the two hourly jobs. It starts in dry-run (emails are logged, not sent). When Resend is ready (`docs/EMAIL-SETUP.md`), put `RESEND_API_KEY` and `EMAIL_FROM` in `.env.local` and run it again with `--live`.
4. (Folded into step 3: no database settings or SQL pasting needed.)
5. Vercel: new project for the Octolab brand, same env vars, domain `lms.octolab.com.au`.
6. To test real emails, add yourself as a real staff member on the People page (demo addresses end in `.invalid` and cannot receive mail).

## Before any brand goes live

`npm run seed:purge`, `npm run admin:bootstrap -- --email ... --name ... --supplier ...`, then `npm run golive:check -- --finish`.

## Known gaps

- Migration version drift: LMS Demo V1 stamped its own versions rather than the repo file names. Reconcile before applying to another project (UltraHuman should be created in a Sydney region).
- Brand files hold placeholder values: confirm the real Octolab colour and logo, and everything for UltraHuman (`brands/*.ts`).
- Accessibility and wording (S5, S6, S8) done 18 Nov: iframe titles, quiz and check results announced and focused, progress bars with roles, 44px answer rows, "answer every question" hint, gray-400 text replaced, brand-band initial picks a readable colour, reporting leads with "of those who completed, how many still knew it", no em dashes in UI copy or emails, re-test email no longer states a question count. The `&apos;` bug was already fixed in v2. Not checked in a browser (needs a database); typecheck and build pass.
- Database tests: `v2_core` (69 checks), `v2_learning` (84 checks) and `v2_reporting` all pass on the live project. `v2_learning` was re-run whole on 17 Oct after migration `20261017001300`: 84 passed, 0 failed. `v2_reporting` was run as two rolled-back transactions (58 checks, 0 failures) because the tool cancels runs containing `delete from`; the one delete-based check was moved to the end, so the unmodified file has not been run. Run each inside `begin; ... rollback;`; the live project holds demo data, so purge it first inside the transaction (the tests build their own root unit).
- Tests: `npm test` (Vitest, 59 unit tests) and `npm run test:db:local` (all migrations + 273 database checks in PGlite). No end-to-end browser tests against a real project yet.
- Rate limit on `/api/retest/start` is now shared through the database (`hit_rate_limit`), falling back to the in-memory limit if that call fails. Needs migration `20261118000200` applied.

## Decisions on record

Separate Supabase and Vercel project per brand. Level 1 read-only. Levels 2 and 3 manage staff in their branch. Only supplier admins assign courses. Floor staff belong to exactly one store. Re-test email at 8am Sydney. The "groups layer stays" decision in the original spec is superseded by the unit tree (`docs/DESIGN-v2.md`).

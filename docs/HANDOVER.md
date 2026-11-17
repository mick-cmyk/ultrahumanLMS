# Handover (updated 18 Nov 2026)

Status of the v2 rebuild: brand-agnostic training LMS on a single unit tree. Older notes (NARTA, JB Hi-Fi, groups and orgs, the no-login token page) are superseded and live in git history.

## To do (as of 18 Nov 2026)

Merged from Mick's chat handover (`docs/HANDOVER-CHAT-2026-11-18.md`) and the Octolab rename. Code rename is done (uncommitted at time of writing).

**Mick (account access):**
1. **Find the Supabase account that now owns LMS Demo V1** (`nfghpuwtdokoleobjekq`, transferred 24 Oct) and reconnect the Supabase connector with that login. Until then nothing can be checked or run against the database.
2. Then: `npm run seed:purge` (also clears data still tagged `kenshu-demo`) and `npm run seed:load -- --mark-demo` to reload the demo as Octolab. Purge deletes demo staff, course and progress; it can't be undone.
3. **Domain `lms.octolab.com.au` (confirmed).** Vercel domain; Supabase Site URL, redirect URLs and hosted magic-link template (paste the regenerated `supabase/templates/magic_link_hosted.html`); then `npm run email:setup -- --app-url https://lms.octolab.com.au`.
4. **Email sender** (park until we do email work in the app): verify an `octolab.com.au` sending domain in Resend (DNS records, then wait), then change `EMAIL_FROM` in `.env.local` (still `Kenshu Training <training@mail.kenshu.com.au>`) and in the edge-function secrets.
5. Confirm whether the orange brand (`a93cfa2`) was ever deployed with `npx vercel deploy --prod`, and whether the hosted magic-link template was pasted into Supabase.

**Code:**
6. **Octolab logo** is saved at `public/brand/octolab-logo.png` (square octopus mark). Set `logoUrl` in `brands/octolab.ts` to `https://lms.octolab.com.au/brand/octolab-logo.png` once that site is live, then `npm run brand:build`.
7. **Colour**: keeping the orange `#ED4E05` for now; check it against octolab.com.au and swap if the site uses a different primary.
8. Brand-file fields still to confirm with Mick (don't invent addresses): `supportEmail`, `emailFromName`, `voice.emailSignoff`.
9. **SCORM 1.2: built 18 Nov, not yet on a real database.** Apply migrations `20261118000100_scorm.sql` and `20261118000200_rate_limit.sql` once the Supabase account is back (item 1). Then: import a package on `/import` as an admin, preview it, assign it, take it as a learner, and run an exported zip (`npm run scorm:export -- --seed attach-selling`) through SCORM Cloud or Moodle before any customer gets one. See "SCORM" below.
10. **Migration version drift** (still open, needs database access): LMS Demo V1 stamped its own migration versions. Compare `supabase migration list` against `supabase/migrations/` and repair before applying the two new migrations.
11. Captions: the sample clips have no `<track>`, and Bunny captions need turning on per video when real videos arrive.

## SCORM (built 18 Nov 2026)

- **Import** (`/import`, admins): zip unpacked and checked in the browser (manifest, zip-slip, 50 MB per file, launch file present), files go straight to the private `scorm` bucket under the admin's session, then a package row and a `scorm` lesson. New course option publishes by default (there's no other publish control in the app). Admins can preview any SCORM lesson; preview saves nothing.
- **Player**: the app's own SCORM 1.2 runtime (`lib/scorm/runtime.ts`) as `window.API`; package files served same-origin from `/scorm-files/<package>/...` with byte ranges; access decided by storage RLS from the learner's assignments, no service role. `passed`/`completed` stamps `lesson_progress`, so reports need no change. Never steps back from complete. SCORM-only modules get no re-test.
- **Export**: `npm run scorm:export -- --course <id>` (or `--seed attach-selling`). Self-contained zip, vanilla player with the app's rules. Answers are inside the package by necessity; no week-later check. Bunny videos need MP4 fallback on and `BUNNY_STREAM_CDN_HOST`.
- **Trust**: package files run same-origin, so a package can do what an app page can. Only admins upload; treat packages like code.
- **Verified**: 50 database checks (`v2_scorm.test.sql`, in PGlite), unit tests for manifest/runtime/unpack/export, and the exported demo course run in a browser against the real runtime (scrubbing doesn't count, full play unlocks the quiz, all lessons report passed/100, finish sends session time, resume works). **Not yet verified**: anything against Supabase's real storage and auth, and the import page end to end.

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

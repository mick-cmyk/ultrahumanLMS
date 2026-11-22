# Handover (updated 21 Nov 2026)

Status of the v2 rebuild: brand-agnostic training LMS on a single unit tree. Older notes (NARTA, JB Hi-Fi, groups and orgs, the no-login token page, the Kenshu demo) are superseded and live in git history.

## Where things stand

- **Live app:** https://lms.octolab.com.au (Vercel project `kenshu-lms`, Next.js 16.4.6). Public landing page at `/` with a login card; logged-out pages redirect to `/login`. The old `lms.kenshu.com.au` alias still points at the same deployment.
- **Database:** LMS Demo V1 (`nfghpuwtdokoleobjekq`), Pro org of Supabase login **test@mickrussell.com**. In `demo` mode. All 16 migration records match `supabase/migrations/` (drift repaired 19 Nov; re-check with `scripts/schema-fingerprint.sql`). The MCP `apply_migration` stamps its own version, so renumber the record to the file's version straight after.
- **Brand:** `brands/octolab.ts`. Orange `#ED4E05`, octopus logo at `public/brand/octolab-logo.png` (emails use the absolute `https://lms.octolab.com.au/brand/octolab-logo.png`), support email `support@octolab.com.au` (Mick setting up the mailbox or a catch-all), sender name `LMS Demo by Octolab`. Level labels are general: Head office, Division, State or region, Site or depot, Team.
- **Email is live.** Resend domain `mail.octolab.com.au`, sender `training@mail.octolab.com.au`. Supabase Auth sends magic links through Resend SMTP with the regenerated hosted template (subject "Your LMS Demo by Octolab"). Edge function secrets and both hourly cron jobs set by `npm run email:setup -- --live`. Details in `docs/EMAIL-SETUP.md`.
- **Demo addresses are never emailed.** Anything ending `.invalid` is skipped by the edge functions and refused by the login form.
- **Marketing:** `docs/marketing/octolab-one-pager.html` (plus PDF and PNG), general training wording. Same page published privately on claude.ai: https://claude.ai/artifact/9ihTqxm292VV9Y31zfEVfJ

## Demo data: Redgum Freight (made-up transport company)

Loaded with `npm run seed:load -- --mark-demo` (`seed/octolab.ts`, courses in `seed/content/transport-safety.ts`). 37 demo people, all `@octolab-demo.invalid`.

- **Head office:** Grace Whitfield, Owner (viewer, sees everything, read only); Daniel Okafor, Safety Manager (admin, assigns courses); Jess Lee, payroll (learner). Mick's real admin login is attached here too.
- **States:** Victoria, New South Wales, Queensland, each with an Operations Manager (manager).
- **Depots:** Dandenong, Laverton, Wetherill Park, Eagle Farm, each with a Depot Manager (manager).
- **Teams:** a warehouse team and a drivers team under each depot, each with a supervisor (manager); warehouse staff and drivers are learners.
- **Courses:** Manual handling refresher (everyone, 38 incl. Mick), Fatigue management for drivers (driver teams, Ben Carter left out as "on leave"), Forklift and pedestrian safety (warehouse teams).
- **Manual handling proven by depot:** Dandenong 9/9, Laverton 4/6, Wetherill Park 3/8, Eagle Farm 1/8. Verified as the Owner and as the Eagle Farm depot manager.
- Sign in as anyone: `npm run login:link -- --email depot.eaglefarm@octolab-demo.invalid --base https://lms.octolab.com.au`. Remove it all with `npm run seed:purge`.

## Course builder (built 21 Nov 2026)

Admins build video courses in the app at **Courses** (`/build`). Guide for content people: `docs/ADDING-COURSES.md`.

- **Editor** (`/build/[id]`): course title and description; modules with title and intro text (new column `modules.intro`, shown to staff on the course page); lessons with Bunny link (embed link, play link, dashboard link, iframe snippet or bare ID all accepted, `lib/bunny.ts parseBunnyVideo`), length, notes; reorder and delete.
- **Questions** by CSV template: download, fill in, upload, preview, save (`lib/quiz-csv.ts`). Errors are listed by spreadsheet row and nothing saves until they're fixed. "Download these questions" gives the same format back for editing. Re-uploading keeps question ids when the text is unchanged, so open re-tests still line up.
- **Check page** (`/build/[id]/check`): problems (block publishing) and warnings (`lib/course-check.ts`), then the whole course as staff see it with answers marked. Publishing re-runs the check on the server.
- **Safety:** all writes go through `/api/courses` under the admin's own session (existing content RLS). Migration `20261121000100_course_builder` adds a database check on quiz question shape, so a bad upload can't reach grading. Deleting a lesson, module or course that staff have started is refused.
- **Verified 21 Nov** as the demo Safety Manager on dev against the live database: create course, module with intro, lesson, bad and good Bunny links, bad and good CSV uploads, check page, publish refused while Bunny is off (in the UI and by a direct API call), delete draft. As a learner: `/build` redirects and the API returns 403. 31 database checks (`v2_course_builder.test.sql`) and 31 unit tests. **Not exercised live:** the refusal to delete a lesson with progress (would have risked demo data), the Bunny length lookup (no `BUNNY_STREAM_API_KEY` yet), and the course builder database test on the real project.
- **Bunny is connected locally (23 Nov), not yet on Vercel.** Library "LMS Demo Site" (`816501`), 12 videos listed in `docs/BUNNY-VIDEOS.md`. `.env.local` has all three settings and they were tested: API lookup, length fill and a signed embed all work. Vercel still needs `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_EMBED_TOKEN_KEY` and `BUNNY_STREAM_API_KEY` (see `docs/ADDING-COURSES.md`); until then live blocks publishing any course with a Bunny video. "Embed view token authentication" is still off on the library, so links play outside the LMS until it is switched on.

## Light and dark mode (22 Nov 2026)

Sun and moon switch in the header on every page, logged in or out. With no choice made the app follows the device setting (pure CSS, no script); a choice is saved in a `theme` cookie for a year and the server renders it, so there's no flash. Dark mode swaps Tailwind's grey and status colour variables in `app/globals.css` rather than adding `dark:` classes everywhere; use `bg-surface` for page and input backgrounds, not `bg-white`. Brand ink and tint have dark versions derived and contrast-checked in `brands/colour.ts`. Checked by screenshot on the landing page, staff pages (phone) and every admin page.

## To do

0. **Bunny settings** in Vercel and `.env.local`, then build one real course end to end with the builder and take it as a learner.
1. **Videos.** The demo lessons reuse the four old sample clips (narration is about retail add-on selling). Needs real safety footage on Bunny, or neutral placeholders, before showing anyone. Bunny captions need turning on per video; the sample clips have no `<track>`.
2. **Mick:** send a magic link to his own address on the live site and check it arrives, looks right and isn't in spam.
3. **Mick:** make sure `support@octolab.com.au` actually receives mail.
4. **Retire `lms.kenshu.com.au`:** redirect it to `lms.octolab.com.au`, then remove it from Supabase redirect URLs.
5. **SCORM by hand:** import a package on `/import` as an admin, preview, assign, take it as a learner, and run an exported zip (`npm run scorm:export -- --seed attach-selling`) through SCORM Cloud or Moodle before any customer gets one.
6. Brand field still to confirm with Mick: `voice.emailSignoff`.
7. UltraHuman: new Supabase project (Sydney region) and Vercel project, plus a real `brands/ultrahuman.ts`.

## SCORM (built 18 Nov 2026)

- **Import** (`/import`, admins): zip unpacked and checked in the browser (manifest, zip-slip, 50 MB per file, launch file present), files go straight to the private `scorm` bucket under the admin's session, then a package row and a `scorm` lesson. New course option publishes by default. Admins can preview any SCORM lesson; preview saves nothing.
- **Player**: the app's own SCORM 1.2 runtime (`lib/scorm/runtime.ts`) as `window.API`; package files served same-origin from `/scorm-files/<package>/...` with byte ranges; access decided by storage RLS from the learner's assignments, no service role. `passed`/`completed` stamps `lesson_progress`, so reports need no change. Never steps back from complete. SCORM-only modules get no re-test.
- **Export**: `npm run scorm:export -- --course <id>` (or `--seed attach-selling`; that seed file is kept for this). Self-contained zip, vanilla player with the app's rules. Answers are inside the package by necessity; no week-later check. Bunny videos need MP4 fallback on and `BUNNY_STREAM_CDN_HOST`.
- **Trust**: package files run same-origin, so a package can do what an app page can. Only admins upload; treat packages like code.
- **Verified**: database checks in PGlite and on the live project, unit tests for manifest/runtime/unpack/export, and the exported demo course run in a browser. **Not yet verified**: the import page and player end to end in a browser against the live project.

## Tests

- `npm test` (Vitest unit tests) and `npm run test:db:local` (all migrations plus every database test in PGlite).
- On the live project (19 Nov), each in a rolled-back transaction: core 69/69, learning 84/84, reporting 58/58, rate limit 12/12, SCORM 50/50 (after making the refused-delete test check the refusal, not the error code).
- No end-to-end browser tests against a real project yet; features have been checked by hand as real roles.

## Deploying

- App: `npx vercel deploy --prod --yes` (only with Mick's OK).
- After editing a brand file: `npm run brand:build`, paste `supabase/templates/magic_link_hosted.html` into Supabase (Authentication, Emails, Magic link or OTP), then `npm run email:setup -- --live`.

## Before any brand goes live

`npm run seed:purge`, `npm run admin:bootstrap -- --email ... --name ... --supplier ...`, then `npm run golive:check -- --finish`.

## Decisions on record

Separate Supabase and Vercel project per brand. Level 1 read-only. Levels 2 and 3 manage staff in their branch. Only supplier admins assign courses. Floor staff belong to exactly one unit. Re-test email at 8am Sydney. The "groups layer stays" decision in the original spec is superseded by the unit tree (`docs/DESIGN-v2.md`). Product wording is general training, not retail only.

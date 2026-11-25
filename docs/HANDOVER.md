# Handover (updated 21 Nov 2026)

Status of the v2 rebuild: brand-agnostic training LMS on a single unit tree. Older notes (NARTA, JB Hi-Fi, groups and orgs, the no-login token page, the Kenshu demo) are superseded and live in git history.

## Where things stand

- **Live app:** https://lms.octolab.com.au (Vercel project `kenshu-lms`, Next.js 16.4.6). Public landing page at `/` with a login card; logged-out pages redirect to `/login`. The old `lms.kenshu.com.au` and `kenshu-lms.vercel.app` addresses redirect (308) to it since 25 Nov 2026.
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
- **Bunny connected (23 Nov).** Library "LMS Demo Site" (`816501`), 12 videos listed in `docs/BUNNY-VIDEOS.md`. All three settings are in `.env.local` and in Vercel (production and preview), checked against the dashboard by fingerprint. "Embed view token authentication" is on: unsigned player links get Bunny's 403 page, the app's signed links play. Live redeployed 23 Nov with the corrected token key; signed Bunny videos play on lms.octolab.com.au. Bunny dashboard bug: opening Security > General by URL sticks on "Loading"; go in through the library menu.
- **Three draft courses from the Bunny videos (23 Nov):** Ethical Upselling (4 lessons), Feedback (5), Growth Mindset (3). One module each, lengths filled from Bunny, no questions or intro text yet, not published or assigned.

## Light and dark mode (22 Nov 2026)

Sun and moon switch in the header on every page, logged in or out. With no choice made the app follows the device setting (pure CSS, no script); a choice is saved in a `theme` cookie for a year and the server renders it, so there's no flash. Dark mode swaps Tailwind's grey and status colour variables in `app/globals.css` rather than adding `dark:` classes everywhere; use `bg-surface` for page and input backgrounds, not `bg-white`. Brand ink and tint have dark versions derived and contrast-checked in `brands/colour.ts`. Checked by screenshot on the landing page, staff pages (phone) and every admin page.

## Adding people and self sign-up (24 Nov 2026)

- **Add a person** (People page, admins): name, email, place, role, through `/api/staff` (the database decides who may be placed where). A role other than learner applies only to a brand new login; re-adding someone never changes their role.
- **Self sign-up** (`20261124000100_self_registration.sql`). Two ways in: a sign-up link for one place, `/register/<code>` (made on the People page under "Self sign-up", with a QR code to download for a poster; "New link" kills the old one), and the general page `/register` where people pick their place from a list of every active place (off by default; when on, the login page links to it). "Approve automatically" is one switch: on, everyone gets a login straight away and a "you're in" email; off, the request waits.
- **Approvers**: an "Approver" tick on managers and admins (People list). Each approver is emailed about requests for places they can see (admins: all) and decides them on `/approvals` (banner on People and Team when any are waiting). Approving creates the login and sends the "you're in" email. With nobody ticked, requests wait unseen; the panel warns about that.
- **Safety**: requests live in `registration_requests`, unreachable through the API. The public route (`/api/register`) rate-limits per address and per email, has a hidden trap field for bots, refuses `.invalid` addresses, and gives an existing account exactly the same answer as a new person, without touching it. `registration_options` is the only function anon can execute (the core test allows exactly that one).
- **Round two (`20261124000200_registration_notes_roles.sql`)**: logging in with an email that has no account offers "Ask for access" (when the general page is on), carrying the email over in session storage, not the URL. Sign-up takes an optional note (500 characters) shown on /approvals and in the approver email. Approvers choose the role as they approve: admins any role; a manager-approver learner, or viewer/manager for places strictly below their own scope (no peer managers). A viewer or manager gets the request's place as their scope. The role is applied only to a login created for that request. The general page is switched on in the demo (24 Nov).
- **Emails from the app** go through `lib/email.ts` (Resend API, same sender as the edge functions). Needs `RESEND_API_KEY` and `EMAIL_FROM` in Vercel; without a key it logs instead of sending.
- **Verified** on dev against the live database as the demo admin: link and QR made, sign-up page logged out, request appeared on Approvals and was declined, approver tick saves. 50 database checks. **Not yet verified**: approving into a real login, the auto-approve path and the emails arriving (needs a real address; see To do).

## "New course" emails (24 Nov 2026)

- **Assign page**: when saving an assignment, choose "Straight away", "On a day and time" (the admin's own time zone) or "Don't send an email". The course shows in training as soon as it's saved either way.
- **Queue** (`20261124000300_course_email_queue.sql`): `queue_course_emails` adds one row per active person the rule reaches (via `user_matches_rule`), never `.invalid` addresses, and never twice for the same person and course. The `course-notify` edge function runs every 10 minutes (cron `course-notify-10min`, scheduled on the demo with `schedule_course_notify_like_retest()`, which copies the re-test job's URL and secret), sends what's due up to the hourly limit (`app_settings.email_hourly_limit`, default 100, changeable on the Assign page), and records each result. At send time it skips anyone who has left, is no longer assigned, or whose course is unpublished. Failures retry after 10 minutes, up to three tries.
- **Assign page list**: the last 30 days of course emails per assignment (waiting, sent, not sent), with Cancel for what hasn't gone.
- **Not covered**: people who join or move into a unit after the assignment was saved don't get the email (they still see the course).
- **Deploy**: `npm run email:deploy` now includes `course-notify`. On a new project, `schedule_edge_jobs` schedules all three.

## Lesson player tweaks (25 Nov 2026)

- **Video shape**: `lessons.video_aspect` (width / height) is filled from Bunny when a video is set in the builder; the player takes that shape, up to 80% of the screen height. The 12 Bunny videos are portrait (1080x1920) and were backfilled.
- **Watched amount** shows in 10% steps.
- **"Staff must watch each video before its quiz"** tick on the course details (`courses.require_watch`, `20261125000100_watch_options_and_aspect.sql`). Unticked, the course's video lessons get a watch threshold of 0 (triggers keep it in step, new lessons follow); opening the lesson records a 0% watch, which counts, so the quiz opens straight away and every existing completion and re-test rule works unchanged. Ticking it again restores 90%; progress already earned stays.

## Messages (26 Nov 2026)

Migration `20261126000100_messages.sql`, test `v2_messages.test.sql` (69 checks). Everyone gets a **Messages** link with an unread badge (`message_counts`). Three separate things:

- **Updates (announcements).** Admins and managers, from `/messages/announce`. The audience is the assignment rule shape, matched only by `user_matches_rule`; a manager's audience is also cut to their scope (`_announcement_audience`). Recipients are fixed when it's posted. Staff tap "Got it"; `/messages/sent` shows counts and who hasn't. "Important" also emails.
- **Conversations (questions).** Staff ask their managers (`start_thread` with no `p_about`); managers and admins message someone in their area (`p_about`). A conversation is about one person and is seen by that person, every manager whose scope covers their unit, and admins. **No private messages between staff, by decision.** New questions email the nearest managers (`_nearest_managers`, admins if there are none); replies email the other side. Lessons have an "Ask your manager about this lesson" link (`/messages?lesson=<id>`).
- **Lesson discussions.** Off until an admin ticks it on `/messages` (`app_settings.discussions`: `off` or `unit`). `unit` means each store or branch only sees its own posts; managers above see their stores' posts labelled, pin and take down; anyone can report, and reports show on the moderators' Messages page. A wider setting (whole retail brand) can be added later as another value.
- **Emails** go through `message_email_queue`, sent by the `course-notify` edge function after course emails, sharing the hourly limit (`_email_room`). They are only sent 8am to 8pm Sydney time (`_next_send_time`, right to disconnect); anything later waits until 8am. One waiting email per person per thread, and it's skipped if they read it first.
- **Demo state:** discussions are ON in the demo so they can be seen. Test data left in: an update "Test update: new roster" from the Eagle Farm depot manager, Kiara's "Swapping a Saturday shift" conversation, and her tip on "Exclusion zones and walkways".

## Versions

Save points are git tags, pushed to the private GitHub copy (github.com/mick-cmyk/lmsdemopartytime, Tags). Numbering: `v2`, then `v2.1`, `v2.2` and so on for each save point, until Mick decides something is Version 3 (`v3`, then `v3.1`...).

- **Version 2.1** (git tag `v2.1`, 24 Nov 2026). Database at migration `20261126000200_developer`. Developer access (the platform developer can't be demoted, deactivated or removed without their approval; `npm run developer:set` on every deployment, enforced by `golive:check`), a Download SCORM button at the top of each course page, and `golive:check` running again.
- **Version 2** (git tag `v2`, 24 Nov 2026). Live on lms.octolab.com.au; database at migration `20261126000100_messages`. Since the first demo: Bunny videos and the course builder, add a person and self sign-up with approvers, "new course" emails on a send list, portrait video and optional watching, Next-lesson button, People list with Edit panels, SCORM download from the builder, Messages (updates, conversations, store-only lesson discussions), and editing, reordering and adding quiz questions. To look at it again: `git checkout v2` (then `git checkout main` to come back).

## Developer access (24 Nov 2026)

Mick keeps the highest access on every deployment. `users.is_developer` (migration `20261126000200_developer.sql`, test `v2_developer.test.sql`, 19 checks): a database trigger refuses any change to a developer's role, active flag or developer mark, and any delete of their account, from the app, the service role or the auth admin API, unless the developer approved it. Admins see a "Developer" badge on People, the controls are locked, and they can only "Ask the developer to give up developer access" (emails the developer). The developer sees the request at the top of People and approves or declines. Marked on the demo: mick@mickrussell.com. Also: a "Download SCORM" button at the top of each course page jumps to the export box; `golive:check` and the new `developer:set` script were fixed to run (top-level await isn't supported by the tsx setup here, so scripts wrap their work in `main()`).

Limits: anyone with the Supabase project's own dashboard or database password can still do anything. Keep each client's Supabase, Vercel and GitHub under Mick's accounts (client staff get app logins, not dashboard access).

## To do

0. **Self sign-up, first real run:** tick yourself as Approver, make a link, sign up on your phone with a second address of your own, check the approver email arrives, approve, check the "you're in" email and log in. Then try once with "Approve automatically" on.
0. **Bunny settings** in Vercel and `.env.local`, then build one real course end to end with the builder and take it as a learner.
1. **Videos.** The demo lessons reuse the four old sample clips (narration is about retail add-on selling). Needs real safety footage on Bunny, or neutral placeholders, before showing anyone. Bunny captions need turning on per video; the sample clips have no `<track>`.
2. **Mick:** send a magic link to his own address on the live site and check it arrives, looks right and isn't in spam.
3. **Mick:** make sure `support@octolab.com.au` actually receives mail.
4. **Retire `lms.kenshu.com.au`:** done 25 Nov 2026 (308 redirect to `lms.octolab.com.au`, removed from Supabase redirect URLs). Later, remove the domain from Vercel and its DNS record once nobody uses it.
5. **SCORM by hand:** (export checked by Mick in an online SCORM viewer, 24 Nov 2026: works. Still to do: the import side.) import a package on `/import` as an admin, preview, assign, take it as a learner, and run an exported zip (`npm run scorm:export -- --seed attach-selling`) through SCORM Cloud or Moodle before any customer gets one.
6. Brand field still to confirm with Mick: `voice.emailSignoff`.
6a. **Before 2027, old-style keys:** the demo's `.env.local` still has the old-style service role key. Create a secret key (Project Settings, API Keys), put it in `.env.local` as `SUPABASE_SERVICE_ROLE_KEY`, run `npm run vercel:env`, redeploy, then `npm run functions:key`. The email functions use `SB_SECRET_KEY` when set and fall back to the old key until then (`supabase/functions/_shared/key.ts`).
7. UltraHuman: new Supabase project (Sydney region) and Vercel project, plus a real `brands/ultrahuman.ts`.

## SCORM (built 18 Nov 2026)

- **Import** (`/import`, admins): zip unpacked and checked in the browser (manifest, zip-slip, 50 MB per file, launch file present), files go straight to the private `scorm` bucket under the admin's session, then a package row and a `scorm` lesson. New course option publishes by default. Admins can preview any SCORM lesson; preview saves nothing.
- **Player**: the app's own SCORM 1.2 runtime (`lib/scorm/runtime.ts`) as `window.API`; package files served same-origin from `/scorm-files/<package>/...` with byte ranges; access decided by storage RLS from the learner's assignments, no service role. `passed`/`completed` stamps `lesson_progress`, so reports need no change. Never steps back from complete. SCORM-only modules get no re-test.
- **Export**: admins click **Download SCORM file** at the bottom of a course in `/build` (`app/build/[id]/scorm-export.tsx`). `/api/courses/[id]/scorm` returns the course and video addresses (`lib/scorm/export-plan.ts`); the browser downloads the MP4s and zips them with `lib/scorm/export.ts`, so Vercel's response size limit doesn't apply. The CLI still works: `npm run scorm:export -- --course <id>` (or `--seed attach-selling`). Self-contained zip, vanilla player with the app's rules (the course's must-watch tick carries over). Answers are inside the package by necessity; no week-later check. Bunny videos need MP4 fallback on (it is, 25 Nov); the pull zone host is found from the embed page, or set `BUNNY_STREAM_CDN_HOST`. The pull zone only serves the app's own site as referrer, so the CLI sends `APP_URL` as the referrer. Ethical Upselling exports at 56 MB (4 lessons, 720p).
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

`npm run seed:purge`, `npm run admin:bootstrap -- --email ... --name ... --supplier ...`, `npm run developer:set -- --email <Mick's address>`, then `npm run golive:check -- --finish` (it refuses without a developer).

## Decisions on record

Separate Supabase and Vercel project per brand. Level 1 read-only. Levels 2 and 3 manage staff in their branch. Only supplier admins assign courses. Floor staff belong to exactly one unit. Re-test email at 8am Sydney. The "groups layer stays" decision in the original spec is superseded by the unit tree (`docs/DESIGN-v2.md`). Product wording is general training, not retail only.

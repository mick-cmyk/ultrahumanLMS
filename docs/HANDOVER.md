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
9. **SCORM 1.2 import and export** (agreed 29 Oct, nothing built). Full plan and build order in `docs/HANDOVER-CHAT-2026-11-18.md` section 2. Lifts the "No SCORM" exclusion; update `lms-build-spec.md` when it lands.
10. Existing gaps below (migration drift, a11y and wording S5/S6/S8, `&apos;` bug, rate limit, tests).

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
- Accessibility and wording fixes (S5, S6, S8), the literal `&apos;` bug.
- Database tests: `v2_core` (69 checks), `v2_learning` (84 checks) and `v2_reporting` all pass on the live project. `v2_learning` was re-run whole on 17 Oct after migration `20261017001300`: 84 passed, 0 failed. `v2_reporting` was run as two rolled-back transactions (58 checks, 0 failures) because the tool cancels runs containing `delete from`; the one delete-based check was moved to the end, so the unmodified file has not been run. Run each inside `begin; ... rollback;`; the live project holds demo data, so purge it first inside the transaction (the tests build their own root unit).
- No TypeScript or end-to-end tests yet.
- Rate limiting on `/api/retest/start` is in-memory and best effort.

## Decisions on record

Separate Supabase and Vercel project per brand. Level 1 read-only. Levels 2 and 3 manage staff in their branch. Only supplier admins assign courses. Floor staff belong to exactly one store. Re-test email at 8am Sydney. The "groups layer stays" decision in the original spec is superseded by the unit tree (`docs/DESIGN-v2.md`).

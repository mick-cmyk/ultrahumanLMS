# Handover (updated 17 Oct 2026)

Status of the v2 rebuild: brand-agnostic training LMS on a single unit tree. Older notes (NARTA, JB Hi-Fi, groups and orgs, the no-login token page) are superseded and live in git history.

## Done

- v2 schema applied to Supabase project **LMS Demo V1** (free plan, ap-south-1). Migrations `20261017000100` to `20261017001100` in `supabase/migrations/`. 69 database checks pass (`supabase/tests/v2_core.test.sql`, run inside a rolled-back transaction).
- Privilege allowlist, scoped RLS, delayed re-tests, demo-data guard and purge.
- App: provisioning that never changes an existing role; People, Structure, Assign, Team, Reporting pages for the unit tree; session-based re-test link (landing page, Start button, POST issues the session).
- Edge functions: `retest-dispatch` and `weekly-digest` act only in the Sydney send window; digest once per ISO week.
- Brand config: `brands/*.ts`, one per deployment via `NEXT_PUBLIC_BRAND`; app, emails and magic-link template all follow it.
- Demo tooling: `seed/kenshu.ts`, `scripts/bootstrap-admin.ts`, `scripts/go-live-check.ts`.

## To get the Kenshu demo running

1. In `.env.local` set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key) and `SUPABASE_SERVICE_ROLE_KEY` for LMS Demo V1 (Supabase dashboard, Project Settings, API). Optionally `NEXT_PUBLIC_BRAND=kenshu` (the default). To sign in as a demo user: `npm run login:link -- --email admin@kenshu-demo.invalid`.
2. `npm run seed:load -- --mark-demo`
3. Scheduled emails: `npx supabase login` once, then `npm run email:setup -- --app-url https://lms.kenshu.com.au`. It makes a fresh `CRON_SECRET`, sets the edge function secrets from the brand file, deploys both functions and schedules the two hourly jobs. It starts in dry-run (emails are logged, not sent). When Resend is ready (`docs/EMAIL-SETUP.md`), put `RESEND_API_KEY` and `EMAIL_FROM` in `.env.local` and run it again with `--live`.
4. (Folded into step 3: no database settings or SQL pasting needed.)
5. Vercel: new project for the Kenshu brand, same env vars, domain `lms.kenshu.com.au`.
6. To test real emails, add yourself as a real staff member on the People page (demo addresses end in `.invalid` and cannot receive mail).

## Before any brand goes live

`npm run seed:purge`, `npm run admin:bootstrap -- --email ... --name ... --supplier ...`, then `npm run golive:check -- --finish`.

## Known gaps

- Migration version drift: LMS Demo V1 stamped its own versions rather than the repo file names. Reconcile before applying to another project (UltraHuman should be created in a Sydney region).
- Brand files hold placeholder values: confirm the real Kenshu colour and logo, and everything for UltraHuman (`brands/*.ts`).
- Accessibility and wording fixes (S5, S6, S8), the literal `&apos;` bug.
- Database tests: `v2_core` (69 checks) and `v2_learning` (84 checks) are done: 83 passed on the first run, the one failure (re-test not scheduled when the last lesson is watch-only) was fixed by migration `20261017001300` and that scenario re-checked on its own, but the whole file has not been re-run since. `v2_reporting` is written but has not been run against the database yet. Run each inside `begin; ... rollback;`; the live project holds demo data, so purge it first inside the transaction (the tests build their own root unit).
- No TypeScript or end-to-end tests yet.
- Rate limiting on `/api/retest/start` is in-memory and best effort.

## Decisions on record

Separate Supabase and Vercel project per brand. Level 1 read-only. Levels 2 and 3 manage staff in their branch. Only supplier admins assign courses. Floor staff belong to exactly one store. Re-test email at 8am Sydney. The "groups layer stays" decision in the original spec is superseded by the unit tree (`docs/DESIGN-v2.md`).

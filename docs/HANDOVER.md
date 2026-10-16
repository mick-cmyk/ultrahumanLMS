# Handover (updated 17 Oct 2026)

Status of the v2 rebuild: brand-agnostic training LMS on a single unit tree. Older notes (NARTA, JB Hi-Fi, groups and orgs, the no-login token page) are superseded and live in git history.

## Done

- v2 schema applied to Supabase project **LMS Demo V1** (free plan, ap-south-1). Migrations `20261017000100` to `20261017001100` in `supabase/migrations/`. 69 database checks pass (`supabase/tests/v2_core.test.sql`, run inside a rolled-back transaction).
- Privilege allowlist, scoped RLS, delayed re-tests, demo-data guard and purge.
- App: provisioning that never changes an existing role; People, Structure, Assign, Team, Reporting pages for the unit tree; session-based re-test link (landing page, Start button, POST issues the session).
- Edge functions: `retest-dispatch` and `weekly-digest` act only in the Sydney send window; digest once per ISO week.
- Demo tooling: `seed/kenshu.ts`, `scripts/bootstrap-admin.ts`, `scripts/go-live-check.ts`.

## To get the Kenshu demo running

1. In `.env.local` set `NEXT_PUBLIC_SUPABASE_URL`, the publishable key and `SUPABASE_SERVICE_ROLE_KEY` for LMS Demo V1 (Supabase dashboard, Project Settings, API). Also set `NEXT_PUBLIC_APP_NAME=Kenshu` and `APP_URL`.
2. `npm run seed:load -- --mark-demo`
3. Edge function secrets: `CRON_SECRET`, `APP_URL`, `BRAND_NAME`, `RESEND_API_KEY` (optional while testing; without it links are logged). Deploy with `npm run email:deploy`.
4. Database settings used by cron: `app.settings.retest_dispatch_url` and `_secret`, `app.settings.weekly_digest_url` and `_secret` (the secret is the same value as `CRON_SECRET`; see the comment at the top of `20261017000800_cron.sql`); then `select public.schedule_retest_dispatch(); select public.schedule_weekly_digest();`.
5. Vercel: new project for the Kenshu brand, same env vars, domain `lms.kenshu.com.au`.
6. To test real emails, add yourself as a real staff member on the People page (demo addresses end in `.invalid` and cannot receive mail).

## Before any brand goes live

`npm run seed:purge`, `npm run admin:bootstrap -- --email ... --name ... --supplier ...`, then `npm run golive:check -- --finish`.

## Known gaps

- Migration version drift: LMS Demo V1 stamped its own versions rather than the repo file names. Reconcile before applying to another project (UltraHuman should be created in a Sydney region).
- Brand configuration (`brands/<brand>.ts`, `getBrand()`), colour tokens sweep and the generated magic-link email template are not done; the app still uses default grey/blue Tailwind colours.
- Accessibility and wording fixes (S5, S6, S8), the literal `&apos;` bug.
- pgTAP tests for quiz, reporting and token functions still to be rewritten for v2 (core RLS/scope tests are done).
- No TypeScript or end-to-end tests yet.
- Rate limiting on `/api/retest/start` is in-memory and best effort.

## Decisions on record

Separate Supabase and Vercel project per brand. Level 1 read-only. Levels 2 and 3 manage staff in their branch. Only supplier admins assign courses. Floor staff belong to exactly one store. Re-test email at 8am Sydney. The "groups layer stays" decision in the original spec is superseded by the unit tree (`docs/DESIGN-v2.md`).

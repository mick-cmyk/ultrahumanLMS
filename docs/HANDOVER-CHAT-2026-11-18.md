# Handover from chat (18 Nov 2026)

Decisions and changes from Mick's chat sessions (23 Oct to 17 Nov) that are not in the code yet. Repo HEAD is still a93cfa2. Read with `docs/HANDOVER.md` and `CLAUDE.md`. Where this file disagrees with `lms-build-spec.md` or `docs/COWORK-BRIEF.md`, this file wins.

## 1. Rename the brand: Kenshu to Octolab (decided 17 Nov)

Mick renamed the demo brand from Kenshu to Octolab. Nothing in the repo says Octolab yet.

**Blocker: the new domain is not decided.** Ask Mick before touching Vercel, Supabase URLs or email setup. `lms.octolab.com.au` is the likely guess, not a decision.

Code changes (safe to do now):
- `brands/kenshu.ts` becomes `brands/octolab.ts` (`id: 'octolab'`, name Octolab). Keep `primaryColor: '#ED4E05'`; the orange "Kenshu LMS" design system carries over unless Mick says otherwise. Register it in `brands/index.ts` and make it the default `NEXT_PUBLIC_BRAND`. Fix the awkward comment line above `primaryColor` while there.
- `links.website`, `supportEmail`, `emailFromName`, `voice.emailSignoff`: ask Mick for real values; do not invent addresses.
- `seed/kenshu.ts` and the `seed:*` scripts in `package.json`; Kenshu references in `scripts/brand-build.ts`, `scripts/email-setup.ts`, `scripts/login-link.ts`. Demo emails (`@kenshu-demo.invalid`) may stay or change; the DB only requires `.invalid`.
- Run `npm run brand:build` to regenerate `supabase/templates/magic_link*.html`, then `npm run typecheck`.
- Update `CLAUDE.md`, `docs/HANDOVER.md`, and the new-brand guide wording.

Mick's jobs once the domain is known (account access, not code): Vercel domain; Supabase Site URL, redirect URLs and the hosted magic-link template (Authentication > Emails > Templates); Resend domain and DNS; then `npm run email:setup -- --app-url https://<new domain>`.

## 2. SCORM import and export (agreed 29 Oct, nothing built)

This lifts the "No SCORM" v1 exclusion in `lms-build-spec.md` and `docs/COWORK-BRIEF.md`. Update both when the work lands.

Decisions:
- SCORM 1.2 first. SCORM 2004 only if a supplier asks.
- **Import:** a new lesson type `scorm`. An imported package's `passed` or `completed` counts as the lesson's pass. SCORM lessons skip the delayed re-test (re-test questions live in the LMS, not the package).
- **Export:** self-contained package (MP4s plus a built-in player and quiz in the zip), so a client's retail customer (e.g. JB Hi-Fi) can load it into their own LMS. No calls back to Octolab, so no launch tokens. Exported courses drop the re-test (a package cannot send email days later). Hosted-wrapper export can come later if needed.

Build order:
1. Migration: `scorm_packages`, `scorm_attempts`, lesson type field. Same privilege allowlist and function lockdown as `20261017001000_lockdown.sql`; new pgTAP tests.
2. Import runtime: signed direct upload to storage (Vercel request bodies cap near 4.5MB; Supabase free plan caps a file at 50MB), parse `imsmanifest.xml`, serve package files through a same-origin route (the SCORM API is found via `window.parent`, which fails cross-origin), SCORM 1.2 API shim, map status and score onto `lesson_progress` so reporting needs no change.
3. Export as a CLI, not a web route (zips with video are too big for a Vercel function): `npm run scorm:export -- --course <id>` writes a zip locally. Needs MP4 renditions enabled in the Bunny library (confirm).
4. Test the exported zip in a reference SCORM host (SCORM Cloud or Moodle) before it goes to a customer.

Related: ANVIL (Mick's SCORM 1.2 game harness) has an open "launch token design" item. Only relevant if games run hosted inside the LMS, not for the self-contained export.

## 3. Supabase project and access (24 Oct)

- LMS Demo V1 (ref `nfghpuwtdokoleobjekq`) was transferred to another Supabase account. The ref did not change, so env vars are unchanged.
- The old Learning-Map and default test projects were deleted.
- Since the move, the Supabase MCP connector gets "You do not have permission" on this project. DB tests cannot run through it until Mick restores access (add the connector's login to the new org, or reconnect it). Do not work around this.

## 4. Unconfirmed since 23 Oct (check, do not assume)

- Whether the orange brand (a93cfa2) was deployed with `npx vercel deploy --prod`.
- Whether the regenerated hosted magic-link template was pasted into Supabase.

## 5. Unchanged known gaps

See `docs/HANDOVER.md`: migration version drift (reconcile before UltraHuman's Sydney project), placeholder UltraHuman brand values, a11y and wording fixes S5, S6, S8 and the literal `&apos;` bug, in-memory rate limit on `/api/retest/start`, stale `docs/EMAIL-SETUP.md`, no TypeScript or end-to-end tests.

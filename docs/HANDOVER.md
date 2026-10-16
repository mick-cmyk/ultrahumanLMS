# P1xel Forge LMS — Handover

*Written 17 October 2026 for whoever picks this up next (human or agent).*

Read this first, then `CLAUDE.md` (rules) and `lms-build-spec.md` (source of truth).
If code and spec disagree, the spec wins.

---

## 1. What it is

A training platform for retail staff (first client context: JB Hi-Fi stores, via the
NARTA buying group). Staff log in with a magic link, watch short videos, pass a
quiz, and **a week later get a re-test** to prove they retained it. Fail it, and
they go round again.

That retention check is the whole product. Every other LMS stops at "completed".

**Out of scope for v1** (do not add without Mick saying so): SCORM, certificates,
forums, native app, billing, AI features, live sessions. An AI tutor idea is
parked for after v1.

## 2. Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 App Router, TypeScript, Tailwind v4 |
| Data + auth | Supabase (Postgres, RLS, magic links only) |
| Scheduled jobs | pg_cron + pg_net calling Deno edge functions |
| Video | Bunny Stream (falls back to local sample clips until keys are added) |
| Email | Resend (code done, account not yet set up) |
| Hosting | Vercel (not yet deployed) |

**Next 16 gotcha:** middleware lives in `proxy.ts` and exports `proxy`, not `middleware`.

## 3. Map of the repo

```
lms-build-spec.md          source of truth
CLAUDE.md                  working rules for agents
proxy.ts                   auth gate + PKCE ?code= forwarding; excludes media from auth
app/
  page.tsx                 learner: "My training"
  courses/[id]             course → modules → lessons
  lessons/[id]             video player (Bunny | sample | none) + quiz
  retest/[token]           no-login re-test player
  team, people             manager screens
  structure, assign        admin: orgs/stores/groups, course targeting
  reports                  completion vs retention, CSV export
  api/*                    progress, quiz, retest, assign, people, staff, structure
  auth/callback|confirm    magic-link landing (hosted = callback, local = confirm)
lib/
  supabase/{server,client,service}.ts   the three clients; service is server-only
  constants.ts             all tunable numbers (thresholds, delays, caps)
  bunny.ts, csv.ts, provision.ts, auth.ts
supabase/
  migrations/              15 files, applied in order — the schema
  functions/
    _shared/email.ts       Resend sender + HTML template (used by both crons)
    retest-dispatch/       daily: send re-tests + one reminder
    weekly-digest/         Monday: manager summary
  tests/                   pgTAP, 62 assertions
  templates/               magic-link emails (local + hosted)
LMS Build Out/
  seed.ts                  demo data: 24 users, 3 courses, Attach-Selling module
  email-preview.ts         render / test-send the emails
public/sample-videos/      four 30s placeholder clips
docs/
  HANDOVER.md              this file
  EMAIL-SETUP.md           Resend steps for Mick
P1xel-Forge-LMS-Overview.pdf   8-page client sales overview
P1xel-Forge-LMS-Rundown.pdf    internal visual rundown of the build
```

## 4. The two things that must stay right

**Rule resolution.** `user_matches_rule(user_id, rule)` in Postgres decides who
sees what. Course lists, RLS, reports and the re-test cron all call it. Order:
exclude → include → all → org/state/store → no match. Empty arrays mean "no
filter". **Never reimplement this in TypeScript.**

**Watch tracking.** "Watched" = unique seconds seen ≥ 90% of duration. The client
keeps a Set of second-indices and posts every 10s and on pause/unload; the server
keeps `GREATEST(old, new)`. Scrubbing to the end must not count.

## 5. Status

All four build phases are complete and were verified end to end as seed users:
login → see only own courses → watch to 90% → quiz unlocks → wrong answers explain
→ pass → re-test link → retention verified / requeued with a cap. Reporting,
weekly digest, CSV import, org branding and the polish pass are in.

**Environment:** hosted Supabase project `wkbsafznaxegkkdnplip` (Pro plan, region
Tokyo). Local Docker was abandoned. Production should be a fresh project in
**Sydney** — region can't be changed after creation.

## 6. Open items (in priority order)

1. **Supabase connector permission.** In the last session the claude.ai Supabase
   connector refused every query, so nothing could be run against the database.
   Mick needs to reconnect it.
2. **Leftover test password.** A temporary password was put on
   `ava.jb.south@example.com` to test the UI. It may still be there. Fix:
   `update auth.users set encrypted_password = '' where email = 'ava.jb.south@example.com';`
3. **`SUPABASE_SERVICE_ROLE_KEY` blank** in `.env.local`. Needed by re-test grading,
   CSV import and staff management.
4. **Resend setup** — follow `docs/EMAIL-SETUP.md`. Code, templates and preview
   scripts are done; needs an account, verified domain, key, then deploy + cron.
5. **Bunny Stream keys** once real videos exist.
6. **Vercel deploy**, then set `APP_URL` and Supabase Auth redirect URLs to it.
7. Housekeeping: rename the Supabase project, retire the old free project
   `mmtaqhznxctcthpawrtk`. Git is local only — push to GitHub for an off-machine
   backup.

## 6b. Domain and brand — Kenshu (added 17 Oct 2026)

The LMS will trade as **Kenshu** (研修, Japanese for "training"). Mick owns
**kenshu.com.au**, and there is already a marketing site live on it.

**Pilot / demo URL: `lms.kenshu.com.au`.** Set it up in this order, and lock
steps 2 and 3 **before any magic link goes out** (links built against the wrong
URL are painful to unwind):

1. **Vercel** — add `lms.kenshu.com.au` to the LMS project; CNAME `lms` → the
   target Vercel gives.
2. **Supabase Auth** — Site URL `https://lms.kenshu.com.au`; add
   `https://lms.kenshu.com.au/**` to redirect URLs.
3. **Resend** — verify `lms.kenshu.com.au` as the sending domain (SPF + DKIM),
   send from e.g. `login@lms.kenshu.com.au`. Keeps deliverability problems off the
   root domain and off Mick's personal addresses. (`docs/EMAIL-SETUP.md` uses this.)
4. Set `APP_URL=https://lms.kenshu.com.au` in the edge-function secrets.

**Proposed, not yet decided — white-label by hostname.** The kenshu.com.au site
sells a white-labelled LMS "carrying your name, not ours", but every client's staff
would log in at `lms.kenshu.com.au` and get emails from it. A client brand team may
balk. Proposal: keep `lms.kenshu.com.au` for the pilot, but design the app to
resolve the tenant (org) from the hostname, so a client can later point their own
domain at it (e.g. `learn.narta.com.au`). Cost per client: a Vercel domain,
Supabase redirect URLs and a verified Resend sending domain. Much cheaper to design
in now than retrofit. **This is beyond the current spec — needs Mick's decision
before anyone builds it.** Today, per-org branding only covers colour and logo
(`orgs.brand_color`, `orgs.logo_url`).

**Brand naming still inside the app:** UI copy, emails and the client PDF say
"P1xel Forge Training" / "P1xel Forge LMS". Switching to Kenshu is a copy change
across `app/`, `supabase/functions/_shared/email.ts`, `supabase/templates/` and the
PDF — confirm with Mick first.

**Fixes noted for the kenshu.com.au website** (separate from this repo, recorded
here so they aren't lost; only the page text was reviewed — design, mobile and
speed weren't checked):

- **"Single sign-on ready"** — the LMS is magic links only. An IT reader will
  take SSO to mean SAML/OIDC, which we can't back. Change to "magic-link sign-in"
  or cut it.
- **"Book a 20-minute call"** scrolls to a section that's only a mailto link.
  Add a real booking link, or rename the button "Email me".
- **Contact email** is `mick@mickrussell.com`; P1xel Forge uses
  `mick@p1xelforge.com` — three identities across three brands. Set up
  `hello@kenshu.com.au` so contact matches the domain. (The client PDF also uses
  `mick@mickrussell.com` — update it to match.)
- **Platform section heading** is a run-on sentence doing an H2's job, and
  "12 years planning" reads as puffery unless it says what the twelve years were.
  Pick one tight line.
- **Root domain** — make sure `kenshu.com.au` itself always resolves to the site
  (it does now); never let it go bare once `lms.` is live.

## 6a. Version control

Git repo on branch `main`. Baseline save point: **`182e764`**
("Save point: Phases 1-4 complete…"). `.env.local` is ignored — never commit it.
Binary files (PDF, MP4, ZIP, images) are marked in `.gitattributes`.

Roll everything back to the baseline: `git reset --hard 182e764`.
Commit after each self-contained improvement so changes can be undone one at a time.

## 7. Gotchas that cost real time

- New Supabase projects grant **no** table access to API roles by default — the
  first migration has an explicit grants block. Keep it.
- Postgres lets `anon` execute new functions by default. Migration
  `20260713101400_restrict_function_execute.sql` locks that down — **re-run its
  logic for any new function**.
- Seeding `auth.users` by SQL: token columns must be `''`, not NULL, or every
  auth call returns 500.
- You can't forge a magic link. To test the UI as a learner: set a temporary
  password, get a session via the password grant, set the `sb-<ref>-auth-token`
  cookie — **then remove the password**.
- `proxy.ts` must exclude `.mp4` etc. or videos redirect to /login.
- Turbopack occasionally serves stale chunks ("module factory is not
  available"): stop the dev server and delete `.next`.

## 8. Conventions

- Schema changes = new migration file. Never hand-edit the hosted schema.
- Server components and route handlers by default; client components only where
  interaction needs it.
- The service role key never reaches the browser.
- **Australian English, plain language** in all UI copy and emails. The users are
  retail staff, not developers.
- Don't relitigate the spec's "Decisions already made": magic links only, live
  rules not snapshots, soft deletes, jsonb questions, Bunny, groups layer in v1.

## 9. Where a fresh pair of eyes could help

Suggestions, not mandates — check with Mick before scope grows.

- **UI/UX pass** on the learner flow on a phone: the lesson page, quiz feedback,
  and the no-login re-test page are what staff actually touch.
- **Accessibility audit** (contrast, keyboard, screen-reader labels on the video
  and quiz).
- **Manager reporting** — make the completed-vs-retained gap jump out more.
- **Email copy review** against the house voice (templates in
  `supabase/functions/_shared/email.ts` and `supabase/templates/`).
- **Code review / security review** of `app/api/*` route handlers, especially the
  ones that use the service role.
- **Test coverage** outside SQL — there are no TypeScript or end-to-end tests yet.
- **Deploy checklist** for the Vercel + Sydney production move.

## 10. Running it

```bash
npm install
npm run dev            # http://localhost:3000
npm run seed           # reload demo data (needs service role key)
npm run email:preview  # render emails to LMS Build Out/email-previews/
```

Seed users (e.g. `ava.jb.south@example.com`, learner) have `example.com`
addresses, so their magic links can't be received — use the test-session method
in section 7, or add a user with a real address. Supabase's built-in mailer
only sends a few emails an hour until Resend SMTP is set up.

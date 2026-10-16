# Design v2: supplier hierarchy, re-test sessions, purgeable demo data

Written 17 October 2026 after Mick's answers. Design only, nothing built. Read with `docs/REVIEW-2026-10-17.md`.

## Decisions made (Mick, 17 Oct)

1. One deployment per brand: separate Vercel project, Supabase project, Resend domain.
2. UltraHuman is retail. Reporting chain: supplier, then Level 1 (retail brand), then Level 2 (training manager or state rep), then Level 3 (store manager), then floor staff. Some staff sit directly under the supplier with no middle layers.
3. Re-test email goes out at 8am Sydney.
4. Re-test link starts a real session, so staff go straight in with no friction.
5. `LMS Build OUt` is the only real copy (checked, see end of file).
6. Sample data may stay, but it must be tagged, purgeable, and unable to appear in a production deployment. Tests must not depend on it.

## 1. The hierarchy

### Why the current schema cannot do it

`groups`, `orgs`, `stores` is a fixed three-level chain, and "direct staff with no middle layer" does not fit it (`users.org_id` null means "no org", which the rule function treats as matching nothing). Levels are also baked into RLS, the rule function, the reporting functions, seven pages, the seed and the tests.

### Proposal: one tree of units

```
units
  id, parent_id (null = the supplier root, one per deployment)
  kind        text   -- brand-defined label key, e.g. supplier | retail_brand | region | store
  name, state (only meaningful on stores), suburb
  path        uuid[] -- ancestor ids root-first, maintained by trigger
  active, demo_tag
```

- Supplier is the root unit. Level 1 is a retail brand under it, Level 2 is a region (state rep territory) under the brand, Level 3 is a store under the region.
- Direct staff are attached to the root unit, or to a "Direct" unit under it. Depth is not fixed, so skipping layers needs no special case.
- `users.unit_id` is where a person sits. Floor staff sit in a store. Direct staff sit at the root.
- `user_scopes (user_id, unit_id)` is what a person can see and manage: the union of the subtrees under each listed unit. A store manager has one scope (their store). A state rep covering VIC and TAS has two. A buying-group coordinator across several brands has several. This replaces the `groups` layer and answers "Jason sees every NARTA brand" without a special table.
- Level names ("Retail brand", "Training manager / state rep", "Store") come from the brand config, not the schema. Another brand can call them something else.

### Roles stay four, scope comes from the tree

| Role | Can do | Scope |
|---|---|---|
| learner | own training | self |
| viewer | read reports | subtree of each scope unit |
| manager | viewer + add, deactivate, move staff | subtree of each scope unit |
| admin | everything, content, assignments | whole tree |

Default mapping for UltraHuman (to confirm, section 6): supplier admin is `admin`; Level 1 is `viewer`; Level 2 and Level 3 are `manager`. Only admins assign courses, as in the spec.

Hard rule that fixes the M2 class of bug: a manager can only act on users who sit strictly below one of their scope units, can only create `learner` rows, and can never change the role, scope or unit of an existing user outside their subtree.

### Rule function change

`user_matches_rule` keeps its resolution order and its safety property (empty target list with `all: false` matches nobody). Only step 4 changes:

```
rule: { all, unit_ids[], states[], include_user_ids[], exclude_user_ids[] }

4. user's unit is inside the subtree of any unit in unit_ids
   AND (states empty OR the user's store has a state in states)
```

Old rules convert cleanly: `org_ids: [JB]` becomes `unit_ids: [JB]`; `org JB + store_ids [X]` becomes `unit_ids: [X]`; `states` is unchanged. Still one Postgres function, still no TypeScript copy. The existing 32 pgTAP cases are rewritten against the new shape before any other code moves.

### What this touches

Schema and migrations, RLS (subtree checks via `path <@`), `user_matches_rule`, `users_in_reporting_scope` and the other report functions, `lib/provision.ts`, `/api/staff`, `/api/people/*`, `/api/structure`, `/api/assign`, the Structure, Assign, People, Team and Reports pages, the seed, and the tests. It is the largest change since Phase 1.

It also supersedes a decision in the spec ("groups layer stays"). Record that in `lms-build-spec.md` when this lands, so the next agent does not "fix" it back.

## 2. Clean restart of the schema

Nothing real is in the database: 24 demo users, 0 progress rows, no cron jobs. The live project already differs from the repo (review item M6). So:

- Replace the 15 migration files with one clean v2 set. Archive the old ones under `supabase/migrations_archive/`. Pre-launch squash is safe because no production database exists to migrate. After v2 is applied to the Sydney project, the spec rule applies again: every change is a new migration file.
- Build in the security fixes from the start, not as patches: `lesson_progress` writable only through the two `security definer` functions; `anon` has no table privileges; function execute rights are an explicit allowlist; viewer-taking functions use `auth.uid()`.
- Create the Sydney project fresh from the repo alone. Do not promote the Tokyo one. Retire it after the Sydney smoke test passes.

## 3. Re-test link starts a session

Today `/retest/<token>` is public and `/api/retest` grades with the service role. New flow:

1. Email link opens `/retest/<token>`. The page only shows a "Start your check" button. Rendering it must not consume the token, because corporate mail scanners (for example Microsoft Safe Links) pre-open links. [Likely] this would otherwise burn the token before the person taps it.
2. The button posts to `/api/retest/start`. Server side, with the service role: validate the token (exists, unused, not expired), load the user, refuse if inactive, refuse if the role is not `learner`.
3. Create the session: `auth.admin.generateLink({ type: 'magiclink', email })`, then `verifyOtp({ token_hash, type: 'magiclink' })` with the server client, which sets the normal session cookies. No email is sent. Mark the token used.
4. Redirect to `/retest/play`, now logged in. Questions come from a function that uses `auth.uid()`; grading is a second function that does the same. Both are executable by `authenticated` only for the caller's own re-test.

Results:

- The public service-role endpoint and the token-based grading functions go away (smaller attack surface, review item M5 mostly disappears).
- "Topics to refresh" links work, because the person is logged in (review item S3).
- If they close the tab mid-test they are still logged in and My training shows "Re-test waiting".

Trade-off, stated plainly: a forwarded re-test email now logs the recipient in as that learner until the session ends. Mitigations: learner role only (managers and admins use a normal login link), tokens expire after 7 days instead of 14, the start endpoint is rate limited, and sessions use the normal Supabase lifetime. For floor staff the exposure is their own training record. [Guessing] that is acceptable; if a client's security team objects, switch to short-lived sessions.

## 4. Demo data that cannot come back

Why it keeps coming back today: the pgTAP tests call `raise exception 'Seed data missing'` unless the seed is loaded, so the seed is load-bearing.

Changes:

- Every demo row carries `demo_tag` (units, users, courses, assignments; children cascade). All demo emails end in `.invalid`, which can never receive mail, enforced by a check: demo rows must use `.invalid`, and `.invalid` addresses must be demo rows.
- `app_settings.environment` is `demo` or `production`, set once per deployment. Kenshu's `lms.kenshu.com.au` is `demo`. UltraHuman is `production` from day one. A trigger refuses to insert a demo row when the environment is `production`.
- `npm run seed:load -- --brand <name>` creates demo data for one brand, tagged. It refuses to run against a `production` environment.
- `npm run seed:purge` removes every tagged row, including the matching `auth.users`, and prints counts. It can run any time.
- The go-live script fails if `select count(*) from users where demo_tag is not null` is above zero in a production environment. This is also a line in the deploy checklist.
- pgTAP tests build their own fixtures inside the test transaction and roll back. They never read the seed. Playwright tests create `e2e`-tagged users in setup and purge them in teardown.
- Demo data per brand is separate (`seed/kenshu.ts`, `seed/ultrahuman.ts`), so UltraHuman's demo tree matches its own levels.

## 5. Build order

1. Housekeeping: commit the docs. Decide the level names and role mapping (section 6).
2. v2 schema, RLS, rule function and report functions, with the pgTAP suite rewritten first and including negative tests that fail on today's database (direct `lesson_progress` write, `digest_recipients`, `users_in_scope_of`, anon privileges).
3. Fresh Sydney project from the repo. Run the suite there.
4. App changes for the tree: provisioning, staff, people, structure, assign, reports. M2 is fixed here by the scope rule in section 1.
5. M3 (redirect) and M4 (cron secret): small, independent, can go in at any point, so they go in first as separate commits.
6. Token-to-session re-test, 8am Sydney send, tokens at 7 days.
7. Demo data mechanism and `seed:load` / `seed:purge`.
8. Brand config, then the colour token sweep. Do these after the tree work, not alongside it: both touch the same 21 files, and doing them together guarantees merge pain.
9. Second deployment for UltraHuman as the "nothing is hardcoded" test.

## 6. Defaults I have assumed, please correct

1. Level 1 (retail brand) is read-only. Level 2 and Level 3 can add, deactivate and move staff within their subtree. Only the supplier admin assigns courses.
2. Floor staff sit in exactly one store. Managers can have several scope units.
3. The supplier root is one per deployment. The Kenshu demo site models a made-up supplier so it never shows a real client's name.
4. In the Kenshu demo, "Jason / NARTA" becomes a viewer with several brand scopes, only if you want to demo that.
5. Level names for UltraHuman: "Retail brand", "Training manager / state rep", "Store manager", "Floor staff". Supplier-side admins are "Admin".

## Folder check

- `C:\Users\mick\LMS Build OUt`: the real project, git history from the baseline `182e764`, 104 files.
- `C:\Users\mick\LMS-build-out`: empty folder.
- `C:\Users\mick\p1xelforge-lms`: an untouched Create Next App scaffold with one commit and an empty `LMS Build Out` subfolder. No seed, no code.

Nothing to merge. Both can be deleted once Mick is happy.

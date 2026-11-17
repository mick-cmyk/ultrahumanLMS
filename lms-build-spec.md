# P1xel Forge LMS — Build Spec

> **Superseded in part (17 Oct 2026).** The groups/orgs/stores layers and the "groups layer stays" decision are replaced by the single unit tree in `docs/DESIGN-v2.md`. Where this spec and DESIGN-v2 disagree, DESIGN-v2 wins. Do not reintroduce groups.

**v1 — July 2026**

## What this is

A training delivery platform for retail staff and client teams. People log in with zero friction, watch assigned videos, prove they learned it with a quiz, and prove they *retained* it with a delayed re-test. Admins target content by retailer, state, store, or individual, and get reporting that tells them who actually knows the material — not who clicked play.

The differentiator is the retention layer. Every other LMS stops at "completed". This one verifies knowledge a week later.

## What this is not (v1)

~~No SCORM.~~ SCORM 1.2 import and export added 18 Nov 2026 (decided 29 Oct; see `docs/HANDOVER-CHAT-2026-11-18.md` section 2). No certificates. No discussion forums. No mobile app (responsive web only). No payment/billing layer. No AI features. No live sessions. If it's not in this spec, it's not in v1.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + API | Next.js (App Router) on Vercel | Existing stack, zero new learning |
| Database + Auth | Supabase (Postgres, Auth, RLS) | Existing stack; magic links built in |
| Scheduled jobs | Supabase cron (`pg_cron`) + Edge Functions | Re-test engine, digest emails |
| Video | Bunny Stream | Cheap at scale, playback API, per-video embed tokens |
| Transactional email | Resend | Magic links via Supabase; re-test and digest emails via Resend |

Estimated running cost at 500 users: under $30/month, dominated by nothing in particular. Bunny is a few dollars unless videos are enormous.

---

## Data model

### Core hierarchy

```
groups                  -- coordinator layer: NARTA. Direct clients have no group.
  id, name

orgs                    -- a retailer (JB Hi-Fi) or a direct client
  id, name, type ('retailer' | 'client'), group_id (nullable), created_at

stores                  -- only for retailer orgs; direct clients skip this
  id, org_id, name, state ('VIC','NSW','QLD','SA','WA','TAS','NT','ACT'), suburb

users                   -- mirrors Supabase auth.users via trigger
  id (= auth.users.id), email, full_name,
  org_id (nullable), store_id (nullable), group_id (nullable),
  role ('learner' | 'manager' | 'coordinator' | 'admin'),
  active (bool),        -- soft delete; never hard-delete, history matters
  created_at
```

Roles:
- **learner** — sees assigned courses, watches, quizzes, re-tests.
- **manager** — everything a learner has, plus staff management and reporting *scoped to their store* (or their whole org if `store_id` is null).
- **coordinator** — read-only reporting across **every org in their group**. Jason. No staff management, no content editing — visibility is the product for this role. Sits on `group_id`, not `org_id`.
- **admin** — you. Everything.

### Content

```
courses
  id, title, description, thumbnail_url, published (bool), created_at

modules                 -- ordered sections within a course
  id, course_id, title, sort_order

lessons
  id, module_id, title, sort_order,
  bunny_video_id, duration_seconds,
  watch_threshold (default 0.90)

quizzes                 -- one per lesson (nullable — some lessons are watch-only)
  id, lesson_id, pass_mark (default 0.80), questions jsonb

-- questions jsonb shape:
-- [{ id, text, options: [..], correct_index, explanation }]
-- explanation shows after answering — right or wrong. Errors cue plasticity;
-- the explanation is the re-teach moment.
```

Keep questions as jsonb in v1. A normalised question bank is a v2 problem; jsonb ships faster and quizzes are small.

### Assignment rules (the important table)

Assignments are **living rules, not user snapshots**. A rule is evaluated at read time, so new starters inherit everything relevant to their store automatically.

```
assignments
  id, course_id,
  rule jsonb,
  due_days (nullable int),   -- days from first exposure to due date
  created_by, created_at

-- rule jsonb shape:
{
  "all": false,
  "org_ids": ["..."],        -- empty = no org filter
  "states": ["VIC","NSW"],   -- filters stores within matched orgs
  "store_ids": ["..."],      -- specific stores, additive with states
  "include_user_ids": [],    -- cherry-picked individuals, bypass all filters
  "exclude_user_ids": []     -- always wins over everything
}
```

**Resolution logic** (implement once as a Postgres function `user_matches_rule(user_id, rule)` and reuse everywhere — learner course list, reporting, re-test cron):

1. If user is in `exclude_user_ids` → no match. Stop.
2. If user is in `include_user_ids` → match. Stop.
3. If `all` → match.
4. If user's `org_id` in `org_ids` AND (`states` empty OR user's store state in `states`) AND (`store_ids` empty OR user's `store_id` in `store_ids`) → match.
5. Otherwise no match.

A user sees a course if **any** assignment rule for that course matches them.

### Progress and retention

```
lesson_progress
  user_id, lesson_id,
  watch_pct (float), watched_at (timestamp when threshold crossed),
  quiz_score (float), quiz_attempts (int), quiz_passed_at,
  PRIMARY KEY (user_id, lesson_id)

retests                  -- one row per user per module, created when module quizzes all passed
  id, user_id, module_id,
  due_at,                -- passed_at + 5 days (configurable)
  attempts, last_score,
  status ('pending' | 'sent' | 'passed' | 'requeued'),
  passed_at

retest_tokens            -- single-use magic tokens for email deep links
  token, retest_id, expires_at, used_at
```

**Completion definition (per lesson):** `watch_pct >= threshold` AND `quiz_passed_at` set (or no quiz exists).
**Retention-verified (per module):** all lessons complete AND retest `status = 'passed'`.
Reporting shows both numbers side by side. The gap between them is the story you sell.

### Row Level Security

RLS on everything. Learners read their own progress and matched courses only. Managers read within their store/org scope. Rule resolution runs through the Postgres function so RLS policies can call it. Do RLS from day one — retrofitting it onto a multi-tenant app is misery.

---

## Auth and provisioning

- **Magic links only.** No passwords anywhere in the product. Supabase Auth email OTP/magic link.
- **CSV import** (admin + manager): columns `email, full_name, store`. Creates auth users + profile rows, marks them active. Re-importing updates rather than duplicates (upsert on email).
- **Manager self-serve staff page**: add a person (email + name), deactivate a person. Scoped to their store. This is the churn defence — if store lists route through you, they'll rot within a quarter and the reporting becomes fiction.
- Deactivated users can't log in and drop out of denominators in reporting from their deactivation date forward. History is kept.

---

## Video: Bunny Stream integration

- One Bunny Stream library. Upload via admin UI (direct-to-Bunny using their upload API, don't proxy video through Vercel).
- Embed with **signed token authentication** so videos aren't shareable outside the app.
- Watch tracking: listen to the Bunny player's `timeupdate`/progress events client-side. Post `watch_pct` to the API, throttled (every 10s and on pause/unload). Server stores the **max** watch percentage — never let it go down.
- Threshold crossing (default 90%) stamps `watched_at`. Scrubbing to the end doesn't count: track *cumulative unique seconds watched* client-side (a simple seen-seconds set), not just playhead position. This is a small thing that makes "completed" mean something.

---

## The learning engine

This is the Huberman layer. Three mechanisms, all cheap to build:

### 1. Retrieval practice (immediate quiz)
- Quiz unlocks when watch threshold is crossed.
- 3–6 questions per lesson. Multiple choice, one correct answer.
- Answer → immediate feedback + explanation, **whether right or wrong**. The error moment is the learning moment; the explanation is the re-teach.
- Fail below pass mark → can retry immediately, questions shuffled. Attempts are counted but unlimited. The goal is learning, not gatekeeping.

### 2. Spaced re-test (the differentiator)
- When every lesson quiz in a module is passed, create a `retests` row with `due_at = now() + 5 days`.
- **Daily cron (Edge Function)**: find retests where `due_at <= now()` and `status = 'pending'`. For each, generate a single-use token, email the user (Resend): *"Quick 2-minute check on [module] — no login needed."* Link lands them directly in the re-test. Mark `status = 'sent'`.
- Re-test = 3–4 questions sampled from the module's question pool, shuffled.
- **Pass** → `status = 'passed'`, module is retention-verified. Congratulate them, tell them why this matters (people like knowing the system is doing spaced repetition on purpose).
- **Fail** → show which topics were missed with links back to the specific lessons, requeue with `due_at = now() + 4 days`, `status = 'requeued'` → back to pending. Cap at 3 cycles, then flag to their manager in reporting rather than nagging forever.
- Reminder: one follow-up email 3 days after `sent` if untouched, then stop. Two emails max per cycle.

### 3. Interleaving
- When building any re-test, if the user has other passed modules in the same course, replace one question with a random question from an older module. One line of sampling logic, real retention benefit.

---

## Admin screens

1. **Courses** — CRUD for courses/modules/lessons, video upload, quiz editor. Single author (you), but build it friendly: one screen per quiz, questions as cards, add/duplicate/reorder, click the correct answer to mark it, explanation field under each. No modal-inside-modal nonsense — you'll be writing hundreds of these and friction compounds. Natural fit with the script tool later: scripts in, draft questions out, paste into the editor.
2. **Assign** — pick course → cascading multi-select (org → state → store, "select all" at each level) → search box to include/exclude individuals → **live preview: "This will reach 214 people"** → save rule. The preview line is what makes admins trust the system; build it.
3. **People** — full user list, filter by org/state/store, CSV import, activate/deactivate, role changes.
4. **Structure** — create/rename groups, orgs, and stores; move orgs between groups. Groups are arbitrary coordinator entities (buying group, franchise HQ, agency) — NARTA is just the first one, not a special case. Onboarding a new coordinator company is: create group → create/assign its orgs → invite a coordinator user. No code changes, no migrations.
5. **Reporting** — see below.

## Manager screens

1. **My team** — staff list for their store, add/deactivate.
2. **Team progress** — per-person: assigned / in progress / completed / retention-verified. Per-course rollups.

## Learner screens

1. **My training** — assigned courses, progress bars, "re-test due" flags.
2. **Lesson view** — video, then quiz, then done-state.
3. **Re-test view** — reachable from email token, no login required (token authenticates the single re-test session only).

---

## Reporting

Two headline numbers everywhere, always side by side:

- **Completed** — watched + passed quiz.
- **Retention-verified** — passed the delayed re-test.

Views: by course → by org → by state → by store → by person. Coordinators see this whole tree across their group's orgs — the NARTA dashboard is the same reporting UI with a wider scope, not a separate build. Every view exports to CSV (Jason will want to forward these). A weekly digest email to managers/admins is a fast follow, not v1 — but design the queries so it's trivial.

Denominators come from rule resolution against **active** users, so numbers stay honest as staff churn.

---

## Build order

Each phase is shippable. Don't start the next until the previous works end to end.

**Phase 1 — Skeleton (the boring 60%)**
Schema + RLS + rule-resolution function with tests. Magic link auth. CSV import. Admin course CRUD. Bunny upload + playback + watch tracking. Learner course list via rule resolution.
*Done when: a real user can log in, see an assigned video, watch it, and the watch is recorded.*

**Phase 2 — Learning engine**
Quiz editor + quiz player with feedback/explanations. Completion logic. Re-test creation, cron, token emails, re-test player, requeue logic. Interleaving.
*Done when: the full loop runs on a real module — watch → quiz → 5 days → email → re-test → verified.*

**Phase 3 — Targeting + reporting**
Assignment UI with cascading picker and live reach preview. Manager role, self-serve staff page. Reporting views + CSV export.
*Done when: Jason could assign a course to "JB Hi-Fi, VIC+NSW" himself and pull the completion report a fortnight later without asking you anything.*

**Phase 4 — Polish**
Reminder cadence tuning, weekly digest email, empty states, mobile pass, branding per org (logo on their dashboard — cheap, looks premium).

---

## Decisions already made (don't relitigate mid-build)

- Magic links only, no passwords.
- Rules, not snapshots, for assignments.
- Soft-delete users, never hard-delete.
- jsonb questions in v1.
- Bunny over Mux.
- Re-test at +5 days, requeue at +4, cap 3 cycles, pass mark 80%, watch threshold 90%. All configurable constants in one file, but these are the defaults.

## Resolved (July 2026)

1. **Quiz authorship**: Mick writes all questions. Editor is single-user but low-friction (see Courses screen spec). Future: script tool drafts questions from the video script.
2. **NARTA visibility**: groups layer is in v1. NARTA = a group; Jason = coordinator role with read-only reporting across the group's orgs.
3. **Video length**: 2–3 minutes max, always. No chapter tracking ever needed; the seen-seconds approach covers it completely. Short videos also mean the whole loop (watch + quiz) fits inside 5 minutes, which is the right ask for retail staff on the floor.

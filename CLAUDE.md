# CLAUDE.md — P1xel Forge LMS

## Source of truth

`lms-build-spec.md` in the repo root. Read it before doing anything. If code and spec disagree, the spec wins. If the spec is genuinely ambiguous, ask — don't invent.

Do **not** relitigate anything in the spec's "Decisions already made" or "Resolved" sections. Magic links only. Rules not snapshots. Soft deletes. jsonb questions. Bunny Stream. Groups layer is in v1.

## Current phase

**Phase 1 only.** Do not build quiz players, re-test logic, cron jobs, assignment UI, or reporting dashboards — those are Phases 2–3. If a task seems to need them, stop and flag it.

Phase 1 scope, in order:
1. Full schema as Supabase migration files (all tables from the spec, including Phase 2 tables — schema is cheap, build it once)
2. `auth.users` → `public.users` mirror trigger
3. `user_matches_rule(user_id uuid, rule jsonb)` Postgres function
4. Tests for the rule function against seed data (see `LMS Build Out/seed.ts`)
5. RLS policies on every table, calling the rule function where relevant
6. Magic link login page
7. "My training" page (courses via rule resolution)
8. Lesson page: Bunny embed with signed token + seen-seconds watch tracking → API route → `lesson_progress`

Phase 1 is done when a seed user can log in on a phone, see only their courses, watch a video, and `lesson_progress.watched_at` gets stamped when they cross 90% unique seconds watched.

## Stack and conventions

- Next.js App Router, TypeScript, deployed on Vercel
- Supabase: Postgres, Auth (magic link only — never build password UI), RLS on from the first migration
- All schema changes via migration files in `supabase/migrations/`. Never instruct dashboard changes.
- Server components + route handlers by default; client components only where interaction demands it
- Supabase clients: `@supabase/ssr` pattern — server client in server contexts, browser client in client components. Service role key only in `LMS Build Out/` scripts and route handlers that verify admin role first — never shipped to the browser.
- Australian English in all UI copy. Plain language — the users are retail staff, not developers.
- Keep UI unstyled-but-tidy in Phase 1. Tailwind, no component libraries yet. Polish is Phase 4.

## Rule resolution — the one thing to get right

`user_matches_rule` is called by course visibility, RLS, reporting, and (later) the re-test cron. Build it once as a Postgres function, test it hard, and never reimplement the logic in TypeScript. Resolution order (from the spec):

1. `exclude_user_ids` → no match, stop
2. `include_user_ids` → match, stop
3. `all: true` → match
4. org_id ∈ org_ids AND (states empty OR store's state ∈ states) AND (store_ids empty OR store_id ∈ store_ids) → match
5. otherwise no match

Empty arrays mean "no filter at that level", not "match nothing". A user matches a course if **any** assignment rule for it matches.

## Watch tracking — the other thing to get right

"Watched" = cumulative **unique seconds** seen ≥ 90% of duration. Client keeps a Set of seen second-indices from player timeupdate events; posts `watch_pct` throttled (every 10s + on pause/unload). Server stores `GREATEST(existing, incoming)` — watch_pct never decreases. Scrubbing to the end must not count.

## Testing

- Rule function: pgTAP or plain SQL assertions run against seeded local db — every case in the spec, especially exclude-beats-include and empty-array semantics
- Run `supabase db reset` (migrations + seed) as the standard way to get a clean local state
- Before claiming any Phase 1 task done, verify it as a seed user, not as service role

## Commands

- `npm run dev` — Next.js locally
- `supabase start` / `supabase db reset` — local db with migrations + seed
- `npm run seed` — runs `"LMS Build Out/seed.ts"` against the local instance (needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`). Note: the folder name has a space, so the package.json script must quote the path, e.g. `tsx "LMS Build Out/seed.ts"`.

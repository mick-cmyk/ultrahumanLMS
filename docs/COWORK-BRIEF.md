# Brief for CoWork — P1xel Forge LMS

*Paste this into CoWork, with the project folder `C:\Users\mick\LMS Build OUt` attached.*

---

Hi CoWork. This is a working training platform for retail staff that I've built
with Claude Code. I'd like a fresh set of eyes and your skills to find and make
improvements.

## Read these first, in this order

1. `docs/HANDOVER.md` — what it is, how it's built, status, open items, gotchas
2. `CLAUDE.md` — the working rules
3. `lms-build-spec.md` — the source of truth. If the code and spec disagree, the spec wins.

## What it does, in one line

Staff tap a login link, watch short videos, pass a quiz, and **a week later get a
re-test that proves they still know it**. That retention check is the product.

## What I'd like from you

Review first, then propose. Please report findings before changing anything, and
group them as *must fix*, *should fix*, *nice to have*. Areas I care about:

1. **The learner experience on a phone** — lesson page, video, quiz feedback, and
   the no-login re-test page (`app/lessons/[id]`, `app/retest/[token]`). These are
   what retail staff actually touch, often on a break.
2. **Accessibility** — contrast, keyboard use, screen-reader labels.
3. **Manager reporting** (`app/reports`, `app/team`) — the gap between "completed"
   and "still knows it" should jump out.
4. **Wording** — UI copy and emails (`supabase/functions/_shared/email.ts`,
   `supabase/templates/`). Australian English, plain language, friendly, short.
5. **Code and security review** — especially `app/api/*` routes that use the
   service role key, and the RLS policies in `supabase/migrations/`.
6. **Testing gaps** — there are SQL tests (pgTAP) but no TypeScript or end-to-end
   tests yet. Suggest what's worth adding.
7. **Go-live checklist** — for moving to Vercel and a Sydney Supabase project.

The client-facing PDF (`P1xel-Forge-LMS-Overview.pdf`) is also open for
design and copy feedback.

## New: the brand is Kenshu

The LMS will trade as **Kenshu** — I own **kenshu.com.au** and there's a website
live on it. The pilot will run at **`lms.kenshu.com.au`**. Full detail in
`docs/HANDOVER.md` section 6b. In short:

- **Domain setup order** (Vercel → Supabase Auth URLs → Resend sending domain)
  is written down. Supabase and Resend must be locked *before* any login link
  goes out.
- **Please review a proposal, don't build it yet:** let the app work out which
  client it is from the web address, so clients can later use their own domain
  (e.g. `learn.narta.com.au`). The website promises white-labelling, and a
  `kenshu` login URL undercuts that. This is beyond the current spec, so tell me
  what it would take and what it would touch.
- **Renaming "P1xel Forge" → "Kenshu"** across the app, emails and PDF: list
  every place it appears, but check with me before changing them.
- **Website fixes** are listed in 6b (the "Single sign-on ready" claim, the
  booking button, a `hello@kenshu.com.au` contact address, the platform heading).
  The website isn't in this repo, but your feedback on it is welcome.

## Ground rules

- **Don't relitigate the spec's "Decisions already made"**: magic links only (no
  passwords, ever), live targeting rules not snapshots, soft deletes, Bunny Stream
  for video, the groups layer stays.
- **Nothing from the "not in v1" list** (AI features, certificates, SCORM, forums,
  native app, billing) unless I say so.
- **Two things must not break**: the `user_matches_rule` Postgres function (never
  reimplement it in TypeScript) and unique-seconds watch tracking (90%; scrubbing
  to the end must not count). Details in the handover, section 4.
- **Schema changes = new migration files** in `supabase/migrations/`. Any new
  Postgres function needs the execute-permission lockdown described in the handover.
- **Never commit `.env.local`** or put keys in code. The service role key never
  reaches the browser.
- **Use git.** Baseline is commit `182e764`. Commit after each separate
  improvement with a clear message, so I can undo one change without losing the rest.

## Things you can't do yet (blocked on me)

- The live database connection is currently refused — I need to reconnect it.
- Resend email isn't set up yet (steps in `docs/EMAIL-SETUP.md`).
- Bunny video keys and the service role key aren't filled in.

So focus on the code, design and copy; anything needing the live database, flag
it for me rather than working around it.

Thanks!

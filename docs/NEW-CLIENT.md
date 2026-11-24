# Setting up a new client

How to give a new client their own training site, from nothing to live. Based
on the Ultrahuman set-up (24 Nov 2026). Allow about an hour, plus waiting for
DNS.

Every client gets their **own** of everything: database (Supabase), hosting
(Vercel), GitHub copy, email domain (Resend), video library (Bunny) and folder
on this computer. The code is shared: the only per-client code is one brand
file. Changes are built and tested in the development folder (`LMS Build
OUt`, which also runs the Octolab demo) and reach a client only when you move
them to a marked version (see "Updating a client" at the end).

Throughout, `<id>` is the client's short name (for example `ultrahuman`) and
`<domain>` their training domain (for example `ultrahumantraining.com`).

## 0. Decide

- Short name `<id>`, display name ("Ultrahuman Training"), main colour (from
  their website; check it shows on both light and dark backgrounds).
- Domain: the site at `lms.<domain>`, email from `training@mail.<domain>`.
- Who the first admin is (their email), and that Mick is the developer.

## 1. Brand file (development folder)

1. Copy `brands/ultrahuman.ts` to `brands/<id>.ts` and change the name,
   colour, website link, sign-off, level labels and the `welcome` wording.
2. Save their wide logo as `public/brand/<id>-logo.svg` (dark logo on a
   transparent background; the site turns it white in dark mode) and point
   `welcome.logoUrl` at it.
3. Register it in `brands/index.ts`.
4. `npm run typecheck`, commit, and mark a version:
   `npm run release:mark -- --version v2.x`.

## 2. GitHub copy

1. Create a private repo on GitHub, for example `mick-cmyk/<id>LMS`.
2. In the development folder: `git remote add <id> https://github.com/mick-cmyk/<id>LMS.git`
   then `git push <id> main --tags`. From now on `release:mark` pushes to it too.

## 3. Client folder

```powershell
git clone https://github.com/mick-cmyk/<id>LMS.git "C:\Users\mick\<Id> LMS"
```

Then `npm install` in that folder, create `.env.local` (below) and copy
`CLAUDE.local.md` from the Ultrahuman folder, changing the details. Open a
**separate Claude Code session in this folder** to run this client.

`.env.local` (never committed, never pasted into chat):

| Setting | Where it comes from |
|---|---|
| `NEXT_PUBLIC_BRAND` | `<id>` |
| `APP_URL`, `NEXT_PUBLIC_APP_URL` | `https://lms.<domain>` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase, step 4 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key (`sb_publishable_...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key (`sb_secret_...`) |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token, step 4 |
| `RESEND_API_KEY` | Resend, step 6 |
| `EMAIL_FROM` | `<Display name> <training@mail.<domain>>` |
| `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_EMBED_TOKEN_KEY` | Bunny, step 7 |

## 4. Database (Supabase)

1. New Supabase account or organisation for the client, new project in
   **Sydney (ap-southeast-2)**. Check the region before you create it.
2. Project Settings, API keys: copy the publishable and secret keys into
   `.env.local`.
3. Account, Access tokens: make a token limited to this project with **Project
   Settings: read-write**, **Application services: read-write** and **Database:
   read-write** (without Database, `client:update` can't reach the database on
   an IPv4-only network and stops with "IPv6 is not supported"). Put it in
   `.env.local` as `SUPABASE_ACCESS_TOKEN`. Keep it while you look after the
   site (updates need it); replace it if it leaks.
4. In the client folder:
   ```powershell
   npx supabase link --project-ref <ref>
   ```
   ```powershell
   npx supabase db push
   ```
   This applies every migration. The database starts in production mode.
5. First admin and developer:
   ```powershell
   npm run admin:bootstrap -- --email first.admin@client.com --name "First Admin" --supplier "<Client name>"
   ```
   ```powershell
   npm run developer:set -- --email mick@mickrussell.com
   ```

## 5. Hosting (Vercel)

1. Once per computer, log the Vercel tool in: `npx vercel login`, then
   `npx vercel whoami` to check (a newer Vercel tool version can need logging
   in again; "Error: Not authorized" on deploy means this step).
   In the client folder: `npx vercel link` and create a new project (name
   like `<id>training`). In its settings set Functions region to **Sydney
   (syd1)**.
2. `npm run vercel:env` copies the settings from `.env.local` (keys go in as
   sensitive). Run it again after adding the Resend and Bunny keys.
3. `npx vercel deploy --prod`.
4. Vercel, Domains: add `lms.<domain>`. At the domain registrar add the
   CNAME it shows. Check with the registrar's own name servers, not your
   computer's cache. VentraIP gotcha: if their panel shows the record but it
   won't resolve after 15 minutes, delete it and add it again.

## 6. Email (Resend)

1. New Resend account (or team) for the client. Add the domain
   `mail.<domain>` and add its DNS records at the registrar. Wait for
   "Verified".
2. Make an API key (sending access, this domain only) and put it in
   `.env.local` with `EMAIL_FROM`.
3. Sign-in settings (site address, sign-ups off, Resend, branded login email):
   ```powershell
   npm run auth:setup -- --apply
   ```
4. Scheduled emails (quick checks, Monday digest, course and message emails),
   first in test mode:
   ```powershell
   npm run email:setup
   ```
5. Send yourself a login link from the live site. When it arrives and works,
   switch the scheduled emails on:
   ```powershell
   npm run email:setup -- --live
   ```
6. `npm run vercel:env` again, then `npx vercel deploy --prod`.

## 7. Videos (Bunny Stream)

1. New Stream library for the client. Upload the videos.
2. Security: turn on embed token authentication, add `lms.<domain>` as an
   allowed domain, turn on the MP4 fallback.
3. Copy the library ID, API key and token key into `.env.local`, then
   `npm run vercel:env` and redeploy. Videos play only on the real site
   address (a 403 on your own computer is expected).

## 8. Before handing over

- Log in as the admin. Add the structure and a test person of each role, and
  click through as learner, viewer, manager and admin.
- Build or import the first course, check it, publish and assign it, then use
  **Take the course** on its Check page.
- `npm run golive:check` must pass (no demo rows, developer set). Then
  `npm run golive:check -- --finish`.
- Give the client's admin `docs/handouts/Ultrahuman Training - Admin guide.pdf`
  (or a copy made for them).

## Updating a client

In the development folder, once a change has been tested on the demo:

```powershell
npm run release:mark -- --version v2.3 --note "what changed"
```

That runs every check and puts the version on every GitHub copy. Then, in the
client's folder (or its own Claude Code session):

```powershell
npm run client:update -- --version v2.3
```

It shows the client, site, database and version, asks you to type yes, then
switches the folder, applies any database changes to that client's database
only, redeploys emails if they changed, deploys the site and checks it
answers. Each update is logged in `releases.log` in the client folder. To go
back, run it with the older version.

Never deploy a client from the development folder, and never make code
changes in a client folder.

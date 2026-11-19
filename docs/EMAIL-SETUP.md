# Email setup (Resend)

Three kinds of email leave this platform:

| Email | Sent by | Through |
|---|---|---|
| Magic login link | Supabase Auth | Resend **SMTP** |
| Re-test + one reminder | `retest-dispatch` edge function (hourly cron, Sydney send window) | Resend **API** |
| Weekly manager digest | `weekly-digest` edge function (hourly cron, acts Mondays) | Resend **API** |

The brand file (`brands/<brand>.ts`) decides the sender name, logo, colours
and sign-off. Each deployment has its own Supabase project, Vercel project and
sending subdomain.

## Current setup: Octolab demo

| Setting | Value |
|---|---|
| App | `https://lms.octolab.com.au` (Vercel project `kenshu-lms`) |
| Supabase project | LMS Demo V1, `nfghpuwtdokoleobjekq` |
| Resend domain | `mail.octolab.com.au` (region Tokyo, verified 19 Nov 2026) |
| Sender | `LMS Demo by Octolab <training@mail.octolab.com.au>` |
| Magic-link subject | `Your LMS Demo by Octolab` |

## 1. Resend account and domain (~15 min + DNS wait)

1. Sign up at resend.com.
2. **Domains, Add domain.** Use a sending subdomain, e.g. `mail.octolab.com.au`
   (a subdomain keeps this traffic off the main domain's reputation).
3. Resend shows the DNS records (DKIM TXT, plus MX/SPF for the bounce
   subdomain). Add them at the DNS host and click **Verify**. Usually minutes,
   can be a few hours.
4. **API Keys, Create.** Permission: *Sending access*, restricted to that
   domain. Copy it; Resend only shows it once.

Until the domain verifies, Resend only lets you send to your own signup
address.

## 2. Prove it works from your machine

In `.env.local` set `RESEND_API_KEY`, `EMAIL_FROM` (e.g.
`LMS Demo by Octolab <training@mail.octolab.com.au>`) and `APP_URL`, then:

```bash
npm run email:preview
```

Writes `LMS Build Out/email-previews/*.html` to look at.

```bash
npm run email:send -- you@yourdomain.com
```

Two emails marked `[TEST]` should land. Check them on your phone and check
they're not in spam.

## 3. Turn on the scheduled emails

One-time on this machine:

```bash
npx supabase login
```

Then one command does the rest:

```bash
npm run email:setup -- --live
```

It makes a fresh `CRON_SECRET`, sets the edge function secrets from the brand
file and `.env.local`, deploys `retest-dispatch` and `weekly-digest`, and
schedules the two hourly jobs. The project comes from
`NEXT_PUBLIC_SUPABASE_URL`, so there is nothing to link. Safe to re-run; run
it again after changing the brand file or `EMAIL_FROM`. Without `--live` the
functions only log what they would send.

## 4. Magic links through Resend

Supabase's built-in mailer is capped at a few emails an hour. Point Auth at
Resend's SMTP:

Authentication, Emails, SMTP Settings, enable custom SMTP:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key |
| Sender email | `training@mail.octolab.com.au` |
| Sender name | `LMS Demo by Octolab` (the brand's `emailFromName`) |

Then raise **Rate Limits, emails per hour** (e.g. 100).

Templates: run `npm run brand:build`, then paste
`supabase/templates/magic_link_hosted.html` into Authentication, Emails,
**Magic link or OTP**, and set the subject it prints (taken from
`supabase/config.toml`). The hosted project uses the `{{ .ConfirmationURL }}`
flow, not the local `token_hash` one.

Also set Authentication, URL Configuration: Site URL to the app URL and add
`https://<app domain>/**` to the redirect URLs.

## Safety rails already built in

- **No key = dry run.** Every send is logged, nothing goes out. `EMAIL_DRY_RUN=1`
  forces that even with a key.
- **Demo addresses are never emailed.** Anything ending `.invalid` is skipped
  by the edge functions, and the login form refuses it before asking Supabase.
- **Idempotency keys** on every send, so a cron that fires twice can't email a
  learner twice.
- **Retries** on Resend rate limits and outages; bad addresses fail fast.
- Each unit's `brand_color` and `logo_url` style its staff's re-test emails,
  with automatic dark or light button text.

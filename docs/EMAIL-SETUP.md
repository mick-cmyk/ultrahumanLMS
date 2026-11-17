# Email setup (Resend)

Three kinds of email leave this platform:

| Email | Sent by | Through |
|---|---|---|
| Magic login link | Supabase Auth | Resend **SMTP** |
| Re-test + one reminder | `retest-dispatch` edge function (daily cron) | Resend **API** |
| Weekly manager digest | `weekly-digest` edge function (Monday cron) | Resend **API** |

The code is done. Everything below is account setup only you can do, then
three commands.

## 1. Resend account and domain (~15 min + DNS wait)

1. Sign up at resend.com.
2. **Domains → Add domain.** Use a subdomain you own, e.g. `lms.octolab.com.au`
   (a subdomain keeps this traffic off your main domain's reputation).
3. Resend shows 3–4 DNS records (SPF, DKIM, optionally DMARC). Add them at your
   DNS host. Click **Verify** — usually minutes, can be a few hours.
4. **API Keys → Create.** Permission: *Sending access*, restricted to that
   domain. Copy it — Resend only shows it once.

Until the domain verifies, Resend only lets you send to your own signup
address. That's enough for step 2.

## 2. Prove it works from your machine

In `.env.local` fill in `RESEND_API_KEY` and `EMAIL_FROM`
(e.g. `P1xel Forge Training <login@lms.octolab.com.au>`), then:

```bash
npm run email:preview
```

Opens nothing, just writes `LMS Build Out/email-previews/*.html` — look at them.

```bash
npm run email:send -- you@yourdomain.com
```

Two emails marked `[TEST]` should land. Check them on your phone, and check
they're not in spam.

## 3. Turn on the crons' email

```bash
supabase login
```

```bash
supabase link --project-ref wkbsafznaxegkkdnplip
```

```bash
supabase secrets set RESEND_API_KEY=re_xxx "EMAIL_FROM=P1xel Forge Training <login@lms.octolab.com.au>" APP_URL=https://lms.octolab.com.au CRON_SECRET=pick-a-long-random-string
```

```bash
npm run email:deploy
```

Then point the crons at the deployed functions (run in the SQL editor, or ask
Claude to run it):

```sql
alter database postgres set app.settings.retest_dispatch_url = 'https://wkbsafznaxegkkdnplip.functions.supabase.co/retest-dispatch';
alter database postgres set app.settings.retest_dispatch_secret = '<same CRON_SECRET>';
alter database postgres set app.settings.weekly_digest_url = 'https://wkbsafznaxegkkdnplip.functions.supabase.co/weekly-digest';
alter database postgres set app.settings.weekly_digest_secret = '<same CRON_SECRET>';
select public.schedule_retest_dispatch();
select public.schedule_weekly_digest();
```

## 4. Magic links through Resend

Supabase's built-in mailer is capped at a few emails an hour — fine for you,
useless for a store of 15. Point Auth at Resend's SMTP:

Project Settings → Authentication → SMTP Settings → enable custom SMTP:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key |
| Sender email | `login@lms.octolab.com.au` |
| Sender name | `P1xel Forge Training` |

Then raise **Rate Limits → emails per hour** (e.g. 100).

Also set the **Magic Link** template body to the contents of
`supabase/templates/magic_link_hosted.html` (the hosted project uses the
`{{ .ConfirmationURL }}` flow, not the local `token_hash` one).

## Safety rails already built in

- **No key = dry run.** Every send is logged, nothing goes out. `EMAIL_DRY_RUN=1`
  forces that even with a key.
- **Idempotency keys** on every send — a cron that fires twice can't email a
  learner twice.
- **Retries** on Resend rate-limits and outages; bad addresses fail fast.
- Each org's `brand_color` and `logo_url` style its staff's re-test emails, with
  automatic dark/light button text.

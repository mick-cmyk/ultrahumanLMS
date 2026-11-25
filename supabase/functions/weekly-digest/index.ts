// weekly-digest: Monday-morning summary to managers and admins.
//
// For each active manager or admin, emails their own scope's course numbers:
// assigned / completed / retention-verified. The heavy lifting is in
// report_summary_for(viewer), so this function is fan-out and formatting.
//
// The cron fires every hour. The function acts only on Monday inside the send
// window (8am to noon Sydney time), and claims the ISO week in job_runs first,
// so the digest goes out once per week no matter how many hourly pings land
// inside the window, or how many times the cron is retried.
//
// Guarded by the CRON_SECRET header. Resend when RESEND_API_KEY is set, else logs.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SERVICE_KEY } from '../_shared/key.ts';
import {
  APP_URL,
  type EmailBlock,
  fromAddress,
  inSendWindow,
  localTime,
  renderEmail,
  renderText,
  send,
} from '../_shared/email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const EMAIL_FROM = fromAddress('DIGEST_EMAIL_FROM');
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type SummaryRow = {
  course_id: string;
  title: string;
  assigned: number;
  completed: number;
  retention_verified: number;
};

function composeBlocks(name: string | null, rows: SummaryRow[]): EmailBlock[] {
  const first = name?.split(' ')[0] ?? 'there';
  const totalGap = rows.reduce(
    (n, r) => n + Math.max(0, r.completed - r.retention_verified),
    0
  );

  return [
    { kind: 'p', text: `Hi ${first}, here is this week's training snapshot.` },
    {
      kind: 'rows',
      heading: 'Course',
      rows: rows.map((r) => [
        r.title,
        `${r.completed}/${r.assigned}`,
        `${r.retention_verified}/${r.assigned}`,
      ]),
    },
    {
      kind: 'p',
      text:
        totalGap > 0
          ? `${totalGap} ${totalGap === 1 ? 'person has' : 'people have'} completed training ` +
            `but not yet proven they retained it. That gap is the number worth acting on.`
          : 'Everyone who has completed their training has also proven they retained it. ' +
            'That is the result you want.',
    },
    { kind: 'cta', label: 'Open full reporting', href: `${APP_URL}/reports` },
    {
      kind: 'note',
      text:
        '"Completed" means watched and passed the quiz. "Still knows it" means they also ' +
        'passed the check a week later.',
    },
  ];
}

Deno.serve(async (req) => {
  // Fail closed (see retest-dispatch): no secret configured means no access.
  if (!CRON_SECRET) {
    console.error('[weekly-digest] CRON_SECRET is not set; refusing to run');
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  const now = localTime();
  const force = new URL(req.url).searchParams.get('force') === '1';
  if (!force && !(now.weekday === 1 && inSendWindow(now))) {
    return Response.json({ skipped: 'not Monday morning', localHour: now.hour });
  }

  try {
    // One digest per ISO week. A forced manual run does not consume the week.
    if (!force) {
      const { data: claimed, error: claimErr } = await db.rpc('claim_job_run', {
        p_job: 'weekly-digest',
        p_run_key: now.isoWeekKey,
      });
      if (claimErr) throw claimErr;
      if (!claimed) return Response.json({ skipped: 'already sent this week', week: now.isoWeekKey });
    }

    const { data: recipients, error } = await db.rpc('digest_recipients');
    if (error) throw error;

    let sent = 0;
    let skipped = 0;
    for (const r of recipients ?? []) {
      if (!r.email) continue;
      const { data: rows, error: sumErr } = await db.rpc('report_summary_for', {
        p_viewer: r.id,
      });
      if (sumErr) {
        console.error(`[weekly-digest] summary failed for ${r.email}: ${sumErr.message}`);
        continue;
      }
      // Nothing assigned in their scope: no email worth sending.
      if (!rows || rows.length === 0) {
        skipped++;
        continue;
      }
      const subject = 'Your weekly training snapshot';
      const blocks = composeBlocks(r.full_name, rows as SummaryRow[]);
      const res = await send({
        from: EMAIL_FROM,
        to: r.email,
        subject,
        html: renderEmail({
          preheader: 'Who has completed their training, and who has actually retained it.',
          heading: 'This week in training',
          blocks,
        }),
        text: renderText(subject, blocks),
        idempotencyKey: `digest-${r.id}-${now.isoWeekKey}`,
        tag: 'weekly-digest',
        logPrefix: '[weekly-digest]',
      });
      if (res.ok) sent++;
    }

    const summary = { sent, skipped, week: now.isoWeekKey };
    console.log('[weekly-digest]', JSON.stringify(summary));
    return Response.json(summary);
  } catch (e) {
    console.error('[weekly-digest] failed:', e);
    return new Response(`weekly-digest failed: ${e}`, { status: 500 });
  }
});

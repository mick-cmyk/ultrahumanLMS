// course-notify: sends the "You have a new course" emails from the queue,
// and the message emails (important announcements, and "you have a new
// message" for questions) from message_email_queue.
//
// Runs every 10 minutes (cron job course-notify-10min). Each run claims what
// is due, up to the hourly limit (app_settings.email_hourly_limit), sends it,
// and records the result; anything over the limit waits for a later run. The
// database decides what is due and what no longer applies
// (claim_course_emails, 20261124000300_course_email_queue.sql).
//
// No send window here for course emails: the admin picked the send time when
// they assigned the course. Message emails are queued with a send time inside
// 8am to 8pm Sydney by the database (_next_send_time), so they wait too. Both
// share the hourly limit.
//
// Guarded by the CRON_SECRET header, like the other cron functions.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { APP_URL, type Brand, type EmailBlock, fromAddress, renderEmail, renderText, send } from '../_shared/email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EMAIL_FROM = fromAddress('COURSE_EMAIL_FROM');
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Claimed = {
  id: string;
  user_id: string;
  course_id: string;
  email: string;
  full_name: string | null;
  course_title: string;
  attempts: number;
};

type ClaimedMessage = {
  id: string;
  kind: 'announcement' | 'thread';
  ref_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  preview: string | null;
  from_name: string | null;
  attempts: number;
};

async function brandFor(userId: string): Promise<Brand> {
  const { data } = await db.rpc('unit_brand_for', { p_user: userId });
  const b = (Array.isArray(data) ? data[0] : null) as { name?: string; brand_color?: string; logo_url?: string } | null;
  return { name: b?.name ?? null, color: b?.brand_color ?? null, logoUrl: b?.logo_url ?? null };
}

async function sendOne(row: Claimed): Promise<{ ok: boolean; error?: string }> {
  const first = row.full_name?.split(' ')[0] ?? 'there';
  const subject = `New training for you: ${row.course_title}`;
  const blocks: EmailBlock[] = [
    { kind: 'p', text: `Hi ${first},` },
    { kind: 'p', text: `You have a new course to complete: ${row.course_title}. It's short, and you can do it on your phone.` },
    { kind: 'cta', label: 'Start the course', href: `${APP_URL}/courses/${row.course_id}` },
    {
      kind: 'note',
      text: 'If it asks you to log in, enter this email address and we will send you a link to tap. There is no password.',
    },
  ];
  const res = await send({
    from: EMAIL_FROM,
    to: row.email,
    subject,
    html: renderEmail({
      preheader: `${row.course_title} has been added to your training.`,
      heading: 'You have a new course to complete',
      blocks,
      brand: await brandFor(row.user_id),
    }),
    text: renderText(subject, blocks),
    // Stable per queue row and try, so a double-fired run can't send twice.
    idempotencyKey: `course-${row.id}-try-${row.attempts}`,
    tag: 'new-course',
    logPrefix: '[course-notify]',
  });
  return { ok: res.ok, error: res.error };
}

async function sendMessage(row: ClaimedMessage): Promise<{ ok: boolean; error?: string }> {
  const first = row.full_name?.split(' ')[0] ?? 'there';
  const title = row.title ?? 'A new message';
  const from = row.from_name ?? 'Your manager';
  const isAnnouncement = row.kind === 'announcement';
  const subject = isAnnouncement ? `Important: ${title}` : `New message from ${from}: ${title}`;
  const preview = (row.preview ?? '').trim();
  const blocks: EmailBlock[] = [
    { kind: 'p', text: `Hi ${first},` },
    {
      kind: 'p',
      text: isAnnouncement
        ? `${from} has posted an important update: ${title}.`
        : `${from} has written to you about "${title}".`,
    },
    ...(preview ? [{ kind: 'note' as const, text: preview.length >= 300 ? `${preview}...` : preview }] : []),
    {
      kind: 'cta',
      label: isAnnouncement ? 'Read it' : 'Read and reply',
      href: isAnnouncement ? `${APP_URL}/messages` : `${APP_URL}/messages/threads/${row.ref_id}`,
    },
    {
      kind: 'note',
      text: 'If it asks you to log in, enter this email address and we will send you a link to tap. There is no password.',
    },
  ];
  const res = await send({
    from: EMAIL_FROM,
    to: row.email,
    subject,
    html: renderEmail({
      preheader: isAnnouncement ? title : `${from} sent you a message.`,
      heading: isAnnouncement ? title : 'You have a new message',
      blocks,
      brand: await brandFor(row.user_id),
    }),
    text: renderText(subject, blocks),
    idempotencyKey: `message-${row.id}-try-${row.attempts}`,
    tag: isAnnouncement ? 'announcement' : 'message',
    logPrefix: '[course-notify]',
  });
  return { ok: res.ok, error: res.error };
}

Deno.serve(async (req) => {
  // Fail closed, as the other cron functions do.
  if (!CRON_SECRET) {
    console.error('[course-notify] CRON_SECRET is not set; refusing to run');
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const { data, error } = await db.rpc('claim_course_emails');
    if (error) throw error;
    const rows = (data ?? []) as Claimed[];
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const r = await sendOne(row);
      const { error: finErr } = await db.rpc('finish_course_email', {
        p_id: row.id,
        p_ok: r.ok,
        p_error: r.ok ? null : (r.error ?? 'send failed'),
      });
      if (finErr) console.error(`[course-notify] could not record result for ${row.id}: ${finErr.message}`);
      if (r.ok) sent++;
      else failed++;
    }
    // Then message emails, in whatever room the hourly limit has left.
    const { data: mdata, error: merr } = await db.rpc('claim_message_emails');
    if (merr) throw merr;
    const messages = (mdata ?? []) as ClaimedMessage[];
    for (const row of messages) {
      const r = await sendMessage(row);
      const { error: finErr } = await db.rpc('finish_message_email', {
        p_id: row.id,
        p_ok: r.ok,
        p_error: r.ok ? null : (r.error ?? 'send failed'),
      });
      if (finErr) console.error(`[course-notify] could not record result for message ${row.id}: ${finErr.message}`);
      if (r.ok) sent++;
      else failed++;
    }
    const summary = { claimed: rows.length, messages: messages.length, sent, failed };
    console.log('[course-notify]', JSON.stringify(summary));
    return Response.json(summary);
  } catch (e) {
    console.error('[course-notify] failed:', e);
    return new Response(`course-notify failed: ${e}`, { status: 500 });
  }
});

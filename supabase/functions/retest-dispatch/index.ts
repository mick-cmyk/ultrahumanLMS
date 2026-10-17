// retest-dispatch: the re-test engine cron.
//
// Fires every hour (see the cron migration) but only acts inside the send
// window, 8am to noon Sydney time by default, so staff get the email at the
// start of their day and a missed hour is picked up by the next one. The
// window is computed in the Australia/Sydney timezone, so daylight saving
// needs no cron edits.
//
// Two jobs each run:
//   1. New sends: due re-tests (pending or requeued, under the cycle cap) get
//      a single-use token and the "your quick check is ready" email, then flip
//      to 'sent'.
//   2. Reminders: re-tests sent 3+ days ago and still untouched get one
//      follow-up email, then stop. Two emails max per cycle.
//
// The emailed link opens a landing page with a Start button. Pressing it signs
// the learner in and takes them straight to the check, so there is no login
// step. The token lasts 7 days.
//
// Guarded by the CRON_SECRET header so nothing else can trigger it. Email goes
// via Resend when RESEND_API_KEY is set; otherwise the link is logged, so the
// loop is testable without an email provider.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  APP_URL,
  CHECK_NAME,
  type Brand,
  type EmailBlock,
  fromAddress,
  inSendWindow,
  localTime,
  renderEmail,
  renderText,
  send,
} from '../_shared/email.ts';

// Cadence knobs. Defaults mirror lib/constants.ts and can be tuned with env
// vars without a redeploy.
const numEnv = (name: string, fallback: number) => {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const REMINDER_DELAY_DAYS = numEnv('REMINDER_DELAY_DAYS', 3);
const RETEST_MAX_CYCLES = numEnv('RETEST_MAX_CYCLES', 3);
const TOKEN_TTL_DAYS = numEnv('RETEST_TOKEN_TTL_DAYS', 7);
const RETEST_QUESTION_HINT = 4; // informational only; sampling happens at play time
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EMAIL_FROM = fromAddress('RETEST_EMAIL_FROM');
const CRON_SECRET = Deno.env.get('CRON_SECRET');

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sendEmail(opts: {
  to: string;
  name: string | null;
  moduleTitle: string;
  link: string;
  reminder: boolean;
  brand: Brand;
  /** Stable per retest + stage, so a repeated cron run can't double-send. */
  idempotencyKey: string;
}) {
  const first = opts.name?.split(' ')[0] ?? 'there';
  const subject = opts.reminder
    ? `Reminder: your ${CHECK_NAME} on ${opts.moduleTitle}`
    : `${cap(CHECK_NAME)} on ${opts.moduleTitle}: two minutes, no login`;

  const blocks: EmailBlock[] = [
    { kind: 'p', text: `Hi ${first},` },
    {
      kind: 'p',
      text:
        `${opts.reminder ? 'Just a reminder: you' : 'You'} finished ${opts.moduleTitle} ` +
        `a few days ago. Here's your ${CHECK_NAME} to lock it in: ${RETEST_QUESTION_HINT} questions.`,
    },
    { kind: 'cta', label: `Start the ${CHECK_NAME}`, href: opts.link },
    {
      kind: 'note',
      text:
        'Tap the button and you go straight in. It takes about two minutes, ' +
        'and the gap since you watched it is deliberate: that is what makes it stick.',
    },
  ];

  const res = await send({
    from: EMAIL_FROM,
    to: opts.to,
    subject,
    html: renderEmail({
      preheader: `A two-minute ${CHECK_NAME} on ${opts.moduleTitle}.`,
      heading: opts.reminder ? `Your ${CHECK_NAME} is still waiting` : `Time for your ${CHECK_NAME}`,
      blocks,
      brand: opts.brand,
    }),
    text: renderText(subject, blocks),
    idempotencyKey: opts.idempotencyKey,
    tag: opts.reminder ? 'retest-reminder' : 'retest',
    logPrefix: '[retest-dispatch]',
  });
  return res.ok;
}

// The recipient, their nearest branded unit (logo and colour), and the module title.
async function loadRecipient(moduleId: string, userId: string) {
  const [{ data: user }, { data: module }, { data: brandRows }] = await Promise.all([
    db.from('users').select('email, full_name, active, role').eq('id', userId).maybeSingle(),
    db.from('modules').select('title').eq('id', moduleId).maybeSingle(),
    db.rpc('unit_brand_for', { p_user: userId }),
  ]);
  const b = (Array.isArray(brandRows) ? brandRows[0] : null) as
    | { name?: string; brand_color?: string; logo_url?: string }
    | null;
  const brand: Brand = {
    name: b?.name ?? null,
    color: b?.brand_color ?? null,
    logoUrl: b?.logo_url ?? null,
  };
  return { user, brand, moduleTitle: module?.title ?? 'your module' };
}

// Only active learners get a session-starting link.
const canReceive = (u: { active?: boolean; email?: string; role?: string } | null) =>
  Boolean(u?.active && u.email && u.role === 'learner');

async function dispatchNewSends() {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await db
    .from('retests')
    .select('id, user_id, module_id, attempts, status')
    .in('status', ['pending', 'requeued'])
    .lte('due_at', nowIso)
    .lt('attempts', RETEST_MAX_CYCLES);
  if (error) throw error;

  let sent = 0;
  for (const r of due ?? []) {
    const { user, brand, moduleTitle } = await loadRecipient(r.module_id, r.user_id);
    if (!canReceive(user)) continue; // deactivated or non-learner users drop out

    const token = newToken();
    const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000).toISOString();
    const { error: tokErr } = await db
      .from('retest_tokens')
      .insert({ token, retest_id: r.id, expires_at: expires });
    if (tokErr) {
      console.error(`[retest-dispatch] token insert failed for retest ${r.id}: ${tokErr.message}`);
      continue;
    }

    const ok = await sendEmail({
      to: user!.email!,
      name: user!.full_name,
      moduleTitle,
      link: `${APP_URL}/retest/${token}`,
      reminder: false,
      brand,
      idempotencyKey: `retest-${r.id}-cycle-${r.attempts}-send`,
    });
    if (!ok) continue;

    await db
      .from('retests')
      .update({ status: 'sent', sent_at: nowIso, reminder_sent_at: null })
      .eq('id', r.id);
    sent++;
  }
  return sent;
}

async function dispatchReminders() {
  const cutoff = new Date(Date.now() - REMINDER_DELAY_DAYS * 86400_000).toISOString();
  const { data: stale, error } = await db
    .from('retests')
    .select('id, user_id, module_id, attempts')
    .eq('status', 'sent')
    .is('reminder_sent_at', null)
    .lte('sent_at', cutoff)
    .lt('attempts', RETEST_MAX_CYCLES);
  if (error) throw error;

  let reminded = 0;
  for (const r of stale ?? []) {
    const { user, brand, moduleTitle } = await loadRecipient(r.module_id, r.user_id);
    if (!canReceive(user)) continue;

    // Reuse the latest still-valid unused token; mint a fresh one if none.
    const { data: tokens } = await db
      .from('retest_tokens')
      .select('token, expires_at, used_at')
      .eq('retest_id', r.id)
      .order('expires_at', { ascending: false });
    let token = tokens?.find((t) => !t.used_at && new Date(t.expires_at) > new Date())?.token;
    if (!token) {
      token = newToken();
      const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000).toISOString();
      const { error: tokErr } = await db
        .from('retest_tokens')
        .insert({ token, retest_id: r.id, expires_at: expires });
      if (tokErr) continue;
    }

    const ok = await sendEmail({
      to: user!.email!,
      name: user!.full_name,
      moduleTitle,
      link: `${APP_URL}/retest/${token}`,
      reminder: true,
      brand,
      idempotencyKey: `retest-${r.id}-cycle-${r.attempts}-reminder`,
    });
    if (!ok) continue;

    await db
      .from('retests')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', r.id);
    reminded++;
  }
  return reminded;
}

Deno.serve(async (req) => {
  // Fail closed: this function is deployed with verify_jwt = false so pg_net
  // can call it, which makes the shared secret the only gate. No secret
  // configured means nobody gets in, not everybody.
  if (!CRON_SECRET) {
    console.error('[retest-dispatch] CRON_SECRET is not set; refusing to run');
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  // ?force=1 skips the window check for manual runs. It still needs the secret.
  const force = new URL(req.url).searchParams.get('force') === '1';
  const now = localTime();
  if (!force && !inSendWindow(now)) {
    return Response.json({ skipped: 'outside send window', localHour: now.hour });
  }

  try {
    const sent = await dispatchNewSends();
    const reminded = await dispatchReminders();
    const summary = { sent, reminded };
    console.log('[retest-dispatch]', JSON.stringify(summary));
    return Response.json(summary);
  } catch (e) {
    console.error('[retest-dispatch] failed:', e);
    return new Response(`retest-dispatch failed: ${e}`, { status: 500 });
  }
});

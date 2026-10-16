// retest-dispatch — the daily re-test engine cron (spec Phase 2).
//
// Two jobs each run:
//   1. New sends:  due re-tests (pending or requeued, under the cycle cap) get
//      a single-use token and the "your 2-minute check is ready" email, then
//      flip to 'sent'.
//   2. Reminders:  re-tests sent 3+ days ago and still untouched get one
//      follow-up email, then stop. Two emails max per cycle.
//
// Invoked in production by pg_cron via pg_net (see the cron migration). Guarded
// with the CRON_SECRET header so nothing else can trigger it.
//
// Email goes via Resend when RESEND_API_KEY is set; otherwise it logs the link
// so the loop is fully testable locally without an email provider. All of that
// lives in ../_shared/email.ts.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  APP_URL,
  type Brand,
  type EmailBlock,
  fromAddress,
  renderEmail,
  renderText,
  send,
} from '../_shared/email.ts';

// Defaults mirror lib/constants.ts. Kept in sync by hand (both are the spec's
// "configurable constants" — this is the server side of that pair).
// Cadence knobs — defaults mirror lib/constants.ts, overridable via env so the
// reminder timing can be tuned in production without a redeploy (spec Phase 4:
// "reminder cadence tuning").
const numEnv = (name: string, fallback: number) => {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const REMINDER_DELAY_DAYS = numEnv('REMINDER_DELAY_DAYS', 3);
const RETEST_MAX_CYCLES = numEnv('RETEST_MAX_CYCLES', 3);
const TOKEN_TTL_DAYS = numEnv('RETEST_TOKEN_TTL_DAYS', 14);
const RETEST_QUESTION_HINT = 4; // informational only; sampling happens at play time

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
    ? `Reminder: your quick check on ${opts.moduleTitle}`
    : `Quick 2-minute check on ${opts.moduleTitle} — no login needed`;

  const blocks: EmailBlock[] = [
    { kind: 'p', text: `Hi ${first},` },
    {
      kind: 'p',
      text:
        `${opts.reminder ? 'Just a reminder — you' : 'You'} finished ${opts.moduleTitle} ` +
        `a few days ago. Here's a quick ${RETEST_QUESTION_HINT}-question check to lock it in.`,
    },
    { kind: 'cta', label: 'Start the check', href: opts.link },
    {
      kind: 'note',
      text:
        'No login needed — the link knows who you are. It takes about two minutes, ' +
        'and the gap since you watched it is deliberate: that is what makes it stick.',
    },
  ];

  const res = await send({
    from: EMAIL_FROM,
    to: opts.to,
    subject,
    html: renderEmail({
      preheader: `A two-minute check on ${opts.moduleTitle}. No login needed.`,
      heading: opts.reminder ? 'Your check is still waiting' : 'Time for a quick check',
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

// Retest joined to the recipient, their org's branding, and the module title.
async function loadRecipient(retestId: string, moduleId: string, userId: string) {
  const [{ data: user }, { data: module }] = await Promise.all([
    db
      .from('users')
      .select('email, full_name, active, org_id, orgs(name, brand_color, logo_url)')
      .eq('id', userId)
      .maybeSingle(),
    db.from('modules').select('title').eq('id', moduleId).maybeSingle(),
  ]);
  // supabase-js types a to-one join as an array; normalise it.
  const orgRaw = (user as { orgs?: unknown } | null)?.orgs;
  const org = (Array.isArray(orgRaw) ? orgRaw[0] : orgRaw) as
    | { name?: string; brand_color?: string; logo_url?: string }
    | undefined;
  const brand: Brand = {
    name: org?.name ?? null,
    color: org?.brand_color ?? null,
    logoUrl: org?.logo_url ?? null,
  };
  return { user, brand, moduleTitle: module?.title ?? 'your module' };
}

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
    const { user, brand, moduleTitle } = await loadRecipient(r.id, r.module_id, r.user_id);
    if (!user?.active || !user.email) continue; // deactivated users drop out

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
      to: user.email,
      name: user.full_name,
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
    const { user, brand, moduleTitle } = await loadRecipient(r.id, r.module_id, r.user_id);
    if (!user?.active || !user.email) continue;

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
      to: user.email,
      name: user.full_name,
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

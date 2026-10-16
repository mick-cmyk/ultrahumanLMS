// Shared email layer for the edge functions (spec: "Transactional email: Resend").
//
// Both crons (retest-dispatch, weekly-digest) send through here so that the
// from address, retry behaviour, branding and dry-run fallback live in exactly
// one place. Magic links do NOT come through here: those are sent by Supabase
// Auth itself, which is pointed at Resend over SMTP (see docs/EMAIL-SETUP.md).
//
// Behaviour with no RESEND_API_KEY set: every send is logged instead of sent,
// and reports success. That keeps the whole re-test loop testable without an
// email provider, which is how Phases 2-4 were verified.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Reads an env var under Deno (the edge runtime) or Node (the preview script in
// "LMS Build Out/"), so one renderer serves both and what you preview is byte
// for byte what the cron sends.
declare const process: { env: Record<string, string | undefined> } | undefined;
function env(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  if (d?.env?.get) return d.env.get(name) || undefined;
  if (typeof process !== 'undefined') return process?.env?.[name] || undefined;
  return undefined;
}

export const APP_URL = env('APP_URL') ?? 'http://localhost:3000';

/** Shown in the email header and footer when a unit has no logo of its own. */
export const BRAND_NAME = env('BRAND_NAME') ?? 'Training';

const RESEND_API_KEY = env('RESEND_API_KEY');
const REPLY_TO = env('EMAIL_REPLY_TO');

/** Set EMAIL_DRY_RUN=1 to log instead of send even when a key is present. */
const DRY_RUN = !RESEND_API_KEY || env('EMAIL_DRY_RUN') === '1';

export type Brand = {
  /** Retailer or client name shown in the header. */
  name?: string | null;
  /** A unit's brand colour, as a hex value. Falls back to the default ink. */
  color?: string | null;
  /** A unit's logo URL, absolute. Omitted rather than broken if missing. */
  logoUrl?: string | null;
};

const INK = '#14161A';
const EMBER = '#E4622B';
const SLATE = '#5A626E';
const LINE = '#E2E5EA';
const CREAM = '#F6F4F0';

/** Cheap guard so a bad brand_color can't inject CSS into the template. */
function safeColour(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : fallback;
}

/** Ink text on light brand colours (JB yellow), white on dark ones. */
function textOn(hex: string): string {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.45 ? INK : '#ffffff';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type EmailBlock =
  | { kind: 'p'; text: string }
  | { kind: 'cta'; label: string; href: string }
  | { kind: 'note'; text: string }
  | { kind: 'rows'; heading: string; rows: Array<[string, string, string]> };

/**
 * Renders a plain, table-based HTML email. Deliberately boring markup: this
 * has to survive Outlook and the Gmail app on a phone in a stockroom.
 */
export function renderEmail(opts: {
  preheader: string;
  heading: string;
  blocks: EmailBlock[];
  brand?: Brand;
}): string {
  const accent = safeColour(opts.brand?.color, INK);
  const logo = opts.brand?.logoUrl;

  const body = opts.blocks
    .map((b) => {
      switch (b.kind) {
        case 'p':
          return `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${INK}">${esc(b.text)}</p>`;
        case 'note':
          return `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${SLATE}">${esc(b.text)}</p>`;
        case 'cta':
          return (
            `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px">` +
            `<tr><td style="border-radius:6px;background:${accent}">` +
            `<a href="${esc(b.href)}" style="display:inline-block;padding:14px 28px;font-size:16px;` +
            `font-weight:bold;color:${textOn(accent)};text-decoration:none">${esc(b.label)}</a>` +
            `</td></tr></table>`
          );
        case 'rows': {
          const head =
            `<tr><th align="left" style="padding:8px 10px;font-size:11px;letter-spacing:.06em;` +
            `text-transform:uppercase;color:#ffffff;background:${INK}">${esc(b.heading)}</th>` +
            `<th align="right" style="padding:8px 10px;font-size:11px;letter-spacing:.06em;` +
            `text-transform:uppercase;color:#ffffff;background:${INK}">Completed</th>` +
            `<th align="right" style="padding:8px 10px;font-size:11px;letter-spacing:.06em;` +
            `text-transform:uppercase;color:#ffffff;background:${INK}">Still knows it</th></tr>`;
          const cells = b.rows
            .map(
              ([a, c, d]) =>
                `<tr><td style="padding:10px;font-size:14px;color:${INK};border-bottom:1px solid ${LINE}">${esc(a)}</td>` +
                `<td align="right" style="padding:10px;font-size:14px;color:${SLATE};border-bottom:1px solid ${LINE}">${esc(c)}</td>` +
                `<td align="right" style="padding:10px;font-size:14px;font-weight:bold;color:${INK};border-bottom:1px solid ${LINE}">${esc(d)}</td></tr>`
            )
            .join('');
          return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse">${head}${cells}</table>`;
        }
      }
    })
    .join('\n');

  const header = logo
    ? `<img src="${esc(logo)}" alt="${esc(opts.brand?.name ?? '')}" height="28" style="display:block;height:28px;border:0">`
    : `<span style="font-size:15px;font-weight:bold;letter-spacing:.04em;color:${INK}">${esc(
        opts.brand?.name ?? BRAND_NAME
      )}</span>`;

  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${CREAM}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <tr><td style="padding:22px 28px;border-bottom:3px solid ${accent}">${header}</td></tr>
  <tr><td style="padding:28px">
    <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:${INK}">${esc(opts.heading)}</h1>
    ${body}
  </td></tr>
  <tr><td style="padding:18px 28px;background:${CREAM};font-size:12px;line-height:1.5;color:${SLATE}">
    Sent by ${esc(BRAND_NAME)}. If this reached you by mistake, let your manager know.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Plain-text twin of renderEmail. Every email ships both parts. */
export function renderText(heading: string, blocks: EmailBlock[]): string {
  const parts = [heading, ''];
  for (const b of blocks) {
    if (b.kind === 'p' || b.kind === 'note') parts.push(b.text, '');
    else if (b.kind === 'cta') parts.push(b.href, '');
    else if (b.kind === 'rows') {
      parts.push(b.heading);
      for (const [a, c, d] of b.rows) parts.push(`  • ${a}: ${c} completed, ${d} still knows it`);
      parts.push('');
    }
  }
  return parts.join('\n');
}

export type SendResult = { ok: boolean; id?: string; error?: string; dryRun?: boolean };

/**
 * Sends via Resend with a small retry. `idempotencyKey` makes a retried cron
 * run (or a pg_net double-fire) safe: Resend collapses repeats within 24h,
 * so a learner never gets the same re-test email twice.
 */
export async function send(opts: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
  tag?: string;
  logPrefix: string;
}): Promise<SendResult> {
  if (DRY_RUN) {
    console.log(
      `${opts.logPrefix} (dry run: no RESEND_API_KEY) to=${opts.to} subject="${opts.subject}"\n${opts.text}`
    );
    return { ok: true, dryRun: true };
  }

  const payload: Record<string, unknown> = {
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  };
  if (REPLY_TO) payload.reply_to = REPLY_TO;
  if (opts.tag) payload.tags = [{ name: 'category', value: opts.tag }];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  // Three attempts, backing off. Only rate limits and server faults are worth
  // retrying: a 422 (bad address, unverified domain) will fail identically.
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        return { ok: true, id: (json as { id?: string }).id };
      }
      lastError = `${res.status} ${await res.text()}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastError = String(e);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 800));
  }

  console.error(`${opts.logPrefix} Resend failed for ${opts.to}: ${lastError}`);
  return { ok: false, error: lastError };
}

/**
 * Resolves the from address, preferring a per-purpose override so the re-test
 * and the digest can come from different mailboxes if that's ever wanted.
 */
export function fromAddress(specificEnv: string): string {
  return (
    env(specificEnv) ?? env('EMAIL_FROM') ?? `${BRAND_NAME} <training@example.com>`
  );
}


// ---------------------------------------------------------------------------
// Send windows. The crons fire every hour; the functions decide whether it is
// the right local moment, so daylight saving never needs a cron edit.
// ---------------------------------------------------------------------------

const SEND_TZ = env('SEND_TIMEZONE') ?? 'Australia/Sydney';
const SEND_START_HOUR = Number(env('SEND_START_HOUR') ?? '8');
const SEND_WINDOW_HOURS = Number(env('SEND_WINDOW_HOURS') ?? '4');

export type LocalTime = { hour: number; weekday: number; isoWeekKey: string };

/** The current local time in the send timezone. weekday: 1 = Monday ... 7 = Sunday. */
export function localTime(now: Date = new Date()): LocalTime {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: SEND_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const hour = Number(get('hour'));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;

  // ISO week of the local calendar date: the week belongs to the year of its Thursday.
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { hour, weekday, isoWeekKey: `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

/** True during the send window (default 8am to noon local, so a missed hour is retried). */
export function inSendWindow(t: LocalTime = localTime()): boolean {
  return t.hour >= SEND_START_HOUR && t.hour < SEND_START_HOUR + SEND_WINDOW_HOURS;
}

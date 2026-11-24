import 'server-only';
import { getBrand, getBrandTokens } from '@/brands';

// Emails the web app sends itself (the scheduled ones go from the edge
// functions, supabase/functions/_shared/email.ts). Same Resend account and
// sender: RESEND_API_KEY and EMAIL_FROM. Without a key, or with
// EMAIL_DRY_RUN=1, the email is logged instead of sent.
//
// Never sends to demo .invalid addresses.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** A plain branded email: heading, paragraphs, one button. */
export function renderEmail(opts: { heading: string; paragraphs: string[]; button?: { label: string; url: string } }) {
  const brand = getBrand();
  const tokens = getBrandTokens(brand);
  const paras = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#14161a">${esc(p)}</p>`)
    .join('');
  const button = opts.button
    ? `<p style="margin:24px 0"><a href="${esc(opts.button.url)}" style="display:inline-block;background:${tokens.brand};color:${tokens.brandFg};text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;font-size:16px">${esc(opts.button.label)}</a></p>`
    : '';
  const signoff = brand.voice.emailSignoff
    ? `<p style="margin:24px 0 0;font-size:14px;color:#5a626e">${esc(brand.voice.emailSignoff)}</p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f4f0;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px 24px 0;font-size:14px;font-weight:600;color:#5a626e">${esc(brand.name)}</td></tr>
<tr><td style="padding:16px 24px 24px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:28px;color:#14161a">${esc(opts.heading)}</h1>
${paras}${button}${signoff}
</td></tr></table></td></tr></table></body></html>`;
  const text = [opts.heading, '', ...opts.paragraphs, ...(opts.button ? ['', `${opts.button.label}: ${opts.button.url}`] : []),
    ...(brand.voice.emailSignoff ? ['', brand.voice.emailSignoff] : [])].join('\n');
  return { html, text };
}

export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  const to = opts.to.trim();
  if (!to || /\.invalid$/i.test(to)) return false;
  const key = process.env.RESEND_API_KEY;
  const brand = getBrand();
  const from = process.env.EMAIL_FROM || `${brand.emailFromName ?? brand.name} <onboarding@resend.dev>`;
  if (!key || process.env.EMAIL_DRY_RUN === '1') {
    console.log(`[email dry run] to=${to} subject=${opts.subject}`);
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) console.error(`[email] Resend refused (${res.status}) for ${opts.subject}`);
    return res.ok;
  } catch (e) {
    console.error('[email] send failed', e instanceof Error ? e.message : e);
    return false;
  }
}

/** Sent to a new person once they're in (auto-approved or approved). */
// Also sent when an admin or manager adds someone (People, My team, CSV
// import), but only for a brand-new login, never when an existing person is
// moved or updated.
function welcomeMessage(to: string, name: string) {
  const brand = getBrand();
  const first = name.trim().split(/\s+/)[0] || 'there';
  const { html, text } = renderEmail({
    heading: `You're in, ${first}`,
    paragraphs: [
      `Your account for ${brand.name} is ready.`,
      'To log in, open the training site and enter this email address. We will email you a link to tap. There is no password.',
    ],
    button: { label: 'Go to your training', url: `${appUrl()}/login` },
  });
  return { to: to.trim(), subject: `Your ${brand.name} account is ready`, html, text };
}

export async function sendWelcome(to: string, name: string) {
  return sendEmail(welcomeMessage(to, name));
}

/**
 * Welcome emails for many new people at once (CSV import). Uses Resend's
 * batch endpoint, 100 per call, so a big import doesn't trip the per-second
 * limit. Returns how many were sent (or logged, in a dry run).
 */
export async function sendWelcomeBatch(people: { email: string; name: string }[]): Promise<number> {
  const messages = people.map((p) => welcomeMessage(p.email, p.name)).filter((m) => m.to && !/\.invalid$/i.test(m.to));
  if (messages.length === 0) return 0;
  const key = process.env.RESEND_API_KEY;
  const brand = getBrand();
  const from = process.env.EMAIL_FROM || `${brand.emailFromName ?? brand.name} <onboarding@resend.dev>`;
  if (!key || process.env.EMAIL_DRY_RUN === '1') {
    for (const m of messages) console.log(`[email dry run] to=${m.to} subject=${m.subject}`);
    return messages.length;
  }
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(
          chunk.map((m) => ({
            from,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
            ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
          }))
        ),
      });
      if (res.ok) sent += chunk.length;
      else console.error(`[email] Resend refused a welcome batch (${res.status})`);
    } catch (e) {
      console.error('[email] welcome batch failed', e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/** Sent to each approver for the place a request is for. */
export async function sendApprovalRequest(
  to: string,
  req: { name: string; email: string; place: string; note?: string }
) {
  const { html, text } = renderEmail({
    heading: 'Someone is waiting for approval',
    paragraphs: [
      `${req.name} (${req.email}) has asked to join the training for ${req.place}.`,
      ...(req.note ? [`Their note: "${req.note}"`] : []),
      'If you know them, approve them (you can choose their role as you do) and they will get an email to say they can log in. If not, decline the request.',
    ],
    button: { label: 'Approve or decline', url: `${appUrl()}/approvals` },
  });
  return sendEmail({ to, subject: `Waiting for approval: ${req.name}, ${req.place}`, html, text });
}

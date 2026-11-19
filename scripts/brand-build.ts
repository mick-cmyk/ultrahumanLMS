// Generates the brand-dependent files that live outside the Next.js app.
//
//   npm run brand:build                 write the magic-link email templates
//   npm run brand:build -- --brand ultrahuman
//   npm run brand:secrets -- --app-url https://lms.octolab.com.au
//                                       print the edge function secrets to set
//
// Source of truth is brands/<brand>.ts. Run brand:build after editing a brand
// file, then paste the hosted template into Supabase (Authentication, Email
// Templates, Magic link) and set the subject printed below. brand:secrets
// prints one `supabase secrets set` line you can run as it is.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBrand, getBrandTokens } from '../brands';
import { die, parseArgs } from './db';

const SLATE = '#5A626E';
const CREAM = '#F6F4F0';
const INK = '#14161A';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The magic-link subject in supabase/config.toml, so the printed hint matches local dev. */
function magicLinkSubject(): string | null {
  try {
    const toml = readFileSync(join(process.cwd(), 'supabase', 'config.toml'), 'utf8');
    const m = toml.match(/\[auth\.email\.template\.magic_link\][^[]*?\nsubject\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function template(name: string, logoUrl: string | null, link: string, accent: string, onAccent: string, signoff: string) {
  // The brand logo is a square mark, so the name sits beside it (a table, for mail clients).
  const nameSpan = `<span style="font-size:15px;font-weight:bold;letter-spacing:.04em;color:${INK}">${esc(name)}</span>`;
  const header = logoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
      `<td style="padding-right:10px;vertical-align:middle"><img src="${esc(logoUrl)}" alt="" width="32" height="32" style="display:block;width:32px;height:32px;border:0"></td>` +
      `<td style="vertical-align:middle">${nameSpan}</td></tr></table>`
    : nameSpan;
  return `<!doctype html>
<html lang="en-AU">
<body style="margin:0;padding:0;background:${CREAM}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <tr><td style="padding:22px 28px;border-bottom:3px solid ${accent}">${header}</td></tr>
  <tr><td style="padding:28px">
    <h1 style="margin:0 0 18px;font-size:22px;color:${INK}">Your login link</h1>
    <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${INK}">
      Tap the button to log in to ${esc(name)}. No password needed.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px">
      <tr><td style="border-radius:6px;background:${accent}">
        <a href="${link}"
           style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:bold;color:${onAccent};text-decoration:none">
          Log in
        </a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;line-height:1.5;color:${SLATE}">
      Open it on the device you want to use. It works once and expires in an hour.
      If you didn't ask for it, you can ignore this email.
    </p>
  </td></tr>
  <tr><td style="padding:18px 28px;background:${CREAM};font-size:12px;line-height:1.5;color:${SLATE}">
    ${esc(signoff)}
  </td></tr>
</table>
</td></tr></table>
</body>
</html>
`;
}

function shellQuote(v: string): string {
  return `"${v.replace(/(["\\$`])/g, '\\$1')}"`;
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  const brand = getBrand(opts.brand);
  const t = getBrandTokens(brand);

  if (positional[0] === 'secrets') {
    const appUrl = opts['app-url'] ?? process.env.APP_URL;
    if (!appUrl) die('Pass --app-url https://your-site (or set APP_URL).');
    const pairs: [string, string | null][] = [
      ['BRAND_NAME', brand.name],
      ['BRAND_COLOR', brand.primaryColor],
      ['BRAND_LOGO_URL', brand.logoUrl],
      ['BRAND_CHECK_NAME', brand.voice.checkName],
      ['BRAND_SIGNOFF', brand.voice.emailSignoff],
      ['BRAND_SUPPORT_EMAIL', brand.supportEmail],
      ['APP_URL', appUrl],
    ];
    const args = pairs.filter(([, v]) => v).map(([k, v]) => `${k}=${shellQuote(v as string)}`);
    console.log(`\nBrand: ${brand.id}\n\nRun this (add --project-ref <ref> if the project is not linked):\n`);
    console.log(`npx supabase secrets set ${args.join(' ')}\n`);
    console.log(`From name for EMAIL_FROM: ${brand.emailFromName} <address@your-verified-domain>\n`);
    return;
  }

  const sign = `${brand.voice.emailSignoff}`;
  const dir = join(process.cwd(), 'supabase', 'templates');
  mkdirSync(dir, { recursive: true });
  // Local dev (supabase start) builds the link itself; hosted passes ConfirmationURL.
  writeFileSync(
    join(dir, 'magic_link.html'),
    template(brand.name, brand.logoUrl, '{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink', t.brand, t.brandFg, sign)
  );
  writeFileSync(
    join(dir, 'magic_link_hosted.html'),
    template(brand.name, brand.logoUrl, '{{ .ConfirmationURL }}', t.brand, t.brandFg, sign)
  );

  console.log(`\nBrand: ${brand.id} (${brand.name}), primary ${brand.primaryColor}`);
  console.log(`Text on the button: ${t.brandFg}`);
  console.log('\nWrote supabase/templates/magic_link.html and magic_link_hosted.html');
  console.log('\nFor a hosted Supabase project, paste magic_link_hosted.html into');
  console.log('Authentication, Email Templates, Magic link, and set the subject to:');
  console.log(`  ${magicLinkSubject() ?? `Your ${brand.name} login link`}\n`);
}

main().catch((e) => die(String(e)));

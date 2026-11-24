// Preview and test-send the transactional emails without waiting for a cron.
//
//   npm run email:preview                  -> writes HTML files you can open
//   npm run email:send -- you@example.com  -> actually sends both, via Resend
//
// It imports the exact renderer the edge functions use, so what you see here is
// byte for byte what a learner or manager receives. Needs RESEND_API_KEY and
// EMAIL_FROM in .env.local before it can send (see docs/EMAIL-SETUP.md).

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type EmailBlock,
  fromAddress,
  renderEmail,
  renderText,
  send,
} from '../supabase/functions/_shared/email';

const APP = process.env.APP_URL ?? 'http://localhost:3000';

const brand = { name: 'JB Hi-Fi', color: '#FFE600', logoUrl: null };

const retestBlocks: EmailBlock[] = [
  { kind: 'p', text: 'Hi Ava,' },
  {
    kind: 'p',
    text:
      "You finished Attach-Selling: sell the full solution a few days ago. Here's a " +
      'quick 4-question check to lock it in.',
  },
  { kind: 'cta', label: 'Start the check', href: `${APP}/retest/preview-token` },
  {
    kind: 'note',
    text:
      'No login needed — the link knows who you are. It takes about two minutes, and ' +
      'the gap since you watched it is deliberate: that is what makes it stick.',
  },
];

const digestBlocks: EmailBlock[] = [
  { kind: 'p', text: "Hi Sam, here is this week's training snapshot." },
  {
    kind: 'rows',
    heading: 'Course',
    rows: [
      ['Attach-Selling: sell the full solution', '13/14', '12/14'],
      ['LG OLED 2026 Range', '9/14', '4/14'],
    ],
  },
  {
    kind: 'p',
    text:
      '6 people have completed training but not yet proven they retained it. ' +
      'That gap is the number worth acting on.',
  },
  { kind: 'cta', label: 'Open full reporting', href: `${APP}/reports` },
  {
    kind: 'note',
    text:
      '"Completed" means watched and passed the quiz. "Still knows it" means they also ' +
      'passed the check a week later.',
  },
];

const samples = [
  {
    key: 'retest',
    from: fromAddress('RETEST_EMAIL_FROM'),
    subject: 'Quick 2-minute check on Attach-Selling — no login needed',
    heading: 'Time for a quick check',
    preheader: 'A two-minute check on Attach-Selling. No login needed.',
    blocks: retestBlocks,
    brand,
  },
  {
    key: 'weekly-digest',
    from: fromAddress('DIGEST_EMAIL_FROM'),
    subject: 'Your weekly training snapshot',
    heading: 'This week in training',
    preheader: 'Who has completed their training, and who has actually retained it.',
    blocks: digestBlocks,
    brand: undefined,
  },
];

const to = process.argv[2];

async function main() {
  const outDir = join(process.cwd(), 'email-previews');
  mkdirSync(outDir, { recursive: true });

  for (const s of samples) {
    const html = renderEmail({
      preheader: s.preheader,
      heading: s.heading,
      blocks: s.blocks,
      brand: s.brand,
    });
    const file = join(outDir, `${s.key}.html`);
    writeFileSync(file, html, 'utf8');
    console.log(`rendered  ${file}`);

    if (!to) continue;

    const res = await send({
      from: s.from,
      to,
      subject: `[TEST] ${s.subject}`,
      html,
      text: renderText(s.subject, s.blocks),
      tag: `preview-${s.key}`,
      logPrefix: `[email-preview:${s.key}]`,
    });
    if (res.dryRun) {
      console.log(`  not sent — no RESEND_API_KEY in .env.local (dry run)`);
    } else if (res.ok) {
      console.log(`  sent to ${to}  (Resend id ${res.id})`);
    } else {
      console.error(`  FAILED: ${res.error}`);
      process.exitCode = 1;
    }
  }

  if (!to) {
    console.log('\nOpen the files above in a browser to check them.');
    console.log('To send them for real:  npm run email:send -- you@example.com');
  }
}

main();

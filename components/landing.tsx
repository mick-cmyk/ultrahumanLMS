import { Bricolage_Grotesque } from 'next/font/google';
import { getBrand } from '@/brands';
import { RETEST_DELAY_DAYS } from '@/lib/constants';
import { LoginForm } from '@/components/login-form';
import { Welcome } from '@/components/welcome';
import { resolveWelcome, welcomeLogo } from '@/lib/welcome';

// The public front page for anyone not logged in: what the product does, plus a
// login box so staff who already have an account can get straight in. All
// wording that names the product comes from the brand file; colours come from
// the brand tokens. Status colours on the sample report are fixed on purpose.

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '800'], display: 'swap' });

const brand = getBrand();
const check = brand.voice.checkName;

// Full-bleed band inside the layout's centred <main>: the box keeps the
// column's width and a clipped shadow paints the colour out to both edges, so
// the page never gets wider than the window (100vw would add the scrollbar).
const band = 'shadow-[0_0_0_100vmax_var(--brand)] [clip-path:inset(0_-100vmax)]';
const eyebrow = 'font-mono text-xs uppercase tracking-[0.08em]';

const steps = [
  {
    day: 'Day 1',
    title: 'Watch',
    body: 'A short video on any phone, at their desk, on site or on a break. Skipping to the end doesn’t count. They need to see at least 90% of it.',
  },
  {
    day: 'Day 1',
    title: 'Check',
    body: 'A few plain-language questions straight after. Pass and the lesson is done. Miss and they can watch again.',
  },
  {
    day: `Day ${1 + RETEST_DELAY_DAYS}`,
    title: 'Prove it',
    body: `An email arrives at 8am with a fresh ${check}. One tap to start, no password. This is the score that shows what they really know.`,
  },
];

// Generic on purpose: the same tree fits a company, a franchise network or a
// supplier training its retail partners.
const tree = [
  { label: 'Head office', body: 'Build and assign courses, see every result.' },
  { label: 'Division or partner', body: 'Read-only reports for everything under them.' },
  { label: 'Region or site', body: 'Manage people and chase results across their patch.' },
  { label: 'Team leader', body: 'Add new starters, see who’s done what.' },
  { label: 'Staff', body: 'Get a link, watch, answer. That’s it.' },
];

const uses = ['New products', 'Compliance', 'Health and safety', 'Onboarding', 'Policies and procedures', 'Customer service'];

const features = [
  { title: 'No passwords', body: 'Staff log in from a link in their email. Nothing to remember, nothing for managers to reset.' },
  { title: 'Made for phones', body: 'Big buttons, short lessons, plain English. Works on whatever phone is in their pocket.' },
  { title: 'Your brand on it', body: 'Your name, colours and logo throughout, plus each division or partner’s own logo on their people’s screens.' },
  { title: 'Monday digest', body: 'Managers get one email a week with who’s finished, who’s due and who’s behind. No logging in to find out.' },
  { title: 'Bring your courses', body: 'Already have SCORM 1.2 packages? Import them as they are. Need to hand a course to a partner’s own system? Export it.' },
  { title: 'Proof, not clicks', body: `Reports show who passed the later ${check}, not just who opened the video. That’s the number worth acting on.` },
];

const sample = [
  { site: 'Dandenong warehouse', detail: '22 of 24 staff proven', pct: 92, tone: 'bg-green-100 text-green-800' },
  { site: 'Parramatta office', detail: '12 of 18 staff proven, 6 checks due', pct: 67, tone: 'bg-amber-100 text-amber-900' },
  { site: 'Eagle Farm depot', detail: '4 of 16 staff proven', pct: 25, tone: 'bg-red-100 text-red-800' },
];

export function Landing({ signupOpen = false, savedWelcome = null }: { signupOpen?: boolean; savedWelcome?: unknown }) {
  // A client site (or any site whose admin has saved welcome wording) gets the
  // short welcome page instead of the product pitch.
  const welcome = resolveWelcome(savedWelcome);
  if (welcome.show) return <Welcome text={welcome.text} logoUrl={welcomeLogo()} signupOpen={signupOpen} />;
  const website = brand.links.website;

  return (
    <div className="-mt-6">
      {/* Hero: the promise on the left, the login box on the right. */}
      <section className="grid items-center gap-10 py-12 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:py-16">
        <div className="min-w-0">
          <p className={`${eyebrow} text-gray-500`}>Training for teams who are hard to get in a room</p>
          <h1
            className={`${display.className} mt-3 text-[clamp(2.4rem,6vw,4.2rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-balance`}
          >
            Training your people will <span className="text-brand-ink">still remember next week.</span>
          </h1>
          <p className="mt-5 max-w-[36ch] text-lg text-gray-600">
            Short videos on their phone. A quick check straight after. Then{' '}
            <strong className="text-gray-900">
              {RETEST_DELAY_DAYS} days later, a fresh {check} lands in their inbox
            </strong>{' '}
            to prove it stuck. You see who actually knows it, team by team and site by site.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2" aria-label="What teams use it for">
            {uses.map((u) => (
              <li key={u} className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-700">
                {u}
              </li>
            ))}
          </ul>
          {website && (
            <a
              href={website}
              className="mt-7 inline-block rounded-full bg-gray-900 px-6 py-3 font-semibold text-gray-50 hover:bg-gray-700"
            >
              Book a demo
            </a>
          )}
        </div>

        <div id="login" className="min-w-0 rounded-2xl border border-gray-200 bg-gray-50 p-6 shadow-sm">
          {brand.markUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.markUrl} alt="" className="mb-4 h-14 w-14 rounded-full bg-white object-contain p-1 ring-1 ring-gray-200" />
          )}
          <LoginForm variant="card" signupOpen={signupOpen} />
          <p className="mt-4 text-sm text-gray-500">
            New here? Your manager adds you, then you can log in with your work email.
          </p>
        </div>
      </section>

      {/* How it works: a real sequence, so the steps carry their day. */}
      <section className={`${band} bg-brand text-brand-fg`}>
        <div className={'py-14'}>
          <p className={`${eyebrow} opacity-80`}>How it works</p>
          <h2 className={`${display.className} mt-2 max-w-[20ch] text-3xl font-extrabold tracking-[-0.03em] md:text-4xl`}>
            Watch it, check it, then prove it stuck.
          </h2>
          <ol className="mt-9 grid gap-8 md:grid-cols-3">
            {steps.map((s) => (
              <li key={s.title} className="grid content-start gap-2 border-t-2 border-current pt-4">
                <span className={`${eyebrow} opacity-85`}>{s.day}</span>
                <h3 className={`${display.className} text-2xl font-semibold`}>{s.title}</h3>
                <p className="max-w-[32ch]">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* The unit tree, in the brand's own level names. */}
      <section className="grid gap-10 border-b border-gray-200 py-14 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <p className={`${eyebrow} text-gray-500`}>Built the way your organisation works</p>
          <h2 className={`${display.className} mt-2 text-3xl font-extrabold tracking-[-0.03em] text-balance`}>
            Everyone sees their own patch. Head office sees it all.
          </h2>
          <p className="mt-4 max-w-[46ch] text-gray-600">
            Set up your divisions, sites and teams once. Assign a course to everyone, one state, or a
            handful of sites, and new starters in those places pick it up automatically.
          </p>
        </div>
        <ol className="min-w-0">
          {tree.map((t, i) => (
            <li
              key={t.label}
              className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 border-b border-dashed border-gray-200 py-3.5 last:border-b-0"
              style={{ paddingLeft: `${i * 1.1}rem` }}
            >
              <span
                aria-hidden="true"
                className={`mt-1.5 h-3.5 w-3.5 rounded-full border-2 ${
                  i === 0
                    ? 'border-gray-900 bg-gray-900'
                    : i === tree.length - 1
                      ? 'border-brand bg-brand'
                      : 'border-gray-900'
                }`}
              />
              <div>
                <b className={`${display.className} block text-lg font-semibold`}>{t.label}</b>
                <span className="text-[15px] text-gray-600">{t.body}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-b border-gray-200 py-14">
        <p className={`${eyebrow} text-gray-500`}>What you get</p>
        <h2 className={`${display.className} mt-2 text-3xl font-extrabold tracking-[-0.03em] text-balance`}>
          Simple for staff. Straight answers for you.
        </h2>
        <div className="mt-9 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="grid content-start gap-1.5">
              <h3 className={`${display.className} text-xl font-semibold`}>{f.title}</h3>
              <p className="text-gray-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-10 border-b border-gray-200 py-14 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <p className={`${eyebrow} text-gray-500`}>Reporting</p>
          <h2 className={`${display.className} mt-2 text-3xl font-extrabold tracking-[-0.03em] text-balance`}>
            Know which sites have actually got it.
          </h2>
          <p className="mt-4 max-w-[46ch] text-gray-600">
            Every result rolls up from person to team to site to the whole organisation. Spot the site that
            needs a visit before the audit or the launch, not after.
          </p>
        </div>
        <figure className="min-w-0 rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <figcaption className={`${eyebrow} mb-3 text-gray-500`}>Example: manual handling refresher</figcaption>
          <ul className="grid gap-3">
            {sample.map((r) => (
              <li key={r.site} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div>
                  <div className="font-semibold">{r.site}</div>
                  <div className="text-sm text-gray-600 tabular-nums">{r.detail}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 font-mono text-xs tabular-nums ${r.tone}`}>
                  {r.pct}% passed
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-gray-200 pt-3 text-sm text-gray-500">Sample figures for illustration.</p>
        </figure>
      </section>

      <section className="grid items-center gap-8 py-16 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h2 className={`${display.className} max-w-[18ch] text-4xl font-extrabold tracking-[-0.035em] text-balance`}>
            What your people learn, still there next week.
          </h2>
          <p className="mt-4 max-w-[48ch] text-gray-600">
            We&apos;ll set up a demo with one of your own courses and a few of your teams, so you can see it the
            way your people will.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            {website && (
              <a
                href={website}
                className="inline-block rounded-full bg-gray-900 px-6 py-3 font-semibold text-gray-50 hover:bg-gray-700"
              >
                Talk to {brand.name}
              </a>
            )}
            <a href="#login" className="font-medium text-brand-ink underline">
              Already have an account? Log in
            </a>
          </div>
        </div>
        {brand.markUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.markUrl}
            alt=""
            className="hidden h-36 w-36 -rotate-6 rounded-full bg-white object-contain p-3 shadow-lg ring-1 ring-gray-200 md:block"
          />
        )}
      </section>
    </div>
  );
}

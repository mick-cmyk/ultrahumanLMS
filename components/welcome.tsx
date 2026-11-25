import { Bricolage_Grotesque } from 'next/font/google';
import { BrandLogo } from '@/components/brand-logo';
import { getBrand } from '@/brands';
import type { WelcomeText } from '@/lib/welcome';
import { LoginForm } from '@/components/login-form';

// A client deployment's front page: their logo, what this site is, how the
// training works, and the login box. No sales pitch. The wording comes from
// the Settings page (or the brand file); the Settings page also renders this
// as its preview, with a stand-in login box.

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '800'], display: 'swap' });

export function Welcome({
  text,
  logoUrl,
  signupOpen = false,
  preview = false,
}: {
  text: WelcomeText;
  logoUrl: string | null;
  signupOpen?: boolean;
  preview?: boolean;
}) {
  const brand = getBrand();
  const website = brand.links.website;

  return (
    <div className="mx-auto grid max-w-3xl gap-10 py-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:items-start md:py-14">
      <div className="min-w-0">
        {logoUrl ? (
          <BrandLogo src={logoUrl} className="h-6 w-auto max-w-full md:h-7" />
        ) : (
          <p className={`${display.className} text-xl font-extrabold`}>{brand.name}</p>
        )}
        <h1 className={`${display.className} mt-8 text-3xl font-extrabold tracking-[-0.03em] text-balance md:text-4xl`}>
          {text.heading}
        </h1>
        {text.intro.map((p, i) => (
          <p key={i} className="mt-4 max-w-[44ch] text-lg text-gray-600">
            {p}
          </p>
        ))}
        {text.steps.length > 0 && (
          <ol className="mt-8 grid gap-4">
            {text.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-semibold text-brand-fg">
                  {i + 1}
                </span>
                <div>
                  <b className="block">{s.title}</b>
                  <span className="text-gray-600">{s.body}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="min-w-0">
        <div id="login" className="rounded-2xl border border-gray-200 bg-gray-50 p-6 shadow-sm">
          {preview ? (
            <div aria-hidden="true" className="space-y-3">
              <p className="font-semibold">Log in</p>
              <div className="h-10 rounded border border-gray-300 bg-white dark:bg-transparent" />
              <div className="h-10 rounded bg-brand opacity-80" />
              <p className="text-xs text-gray-500">The login box appears here.</p>
            </div>
          ) : (
            <LoginForm variant="card" signupOpen={signupOpen} />
          )}
          {text.newHere && <p className="mt-4 text-sm text-gray-500">{text.newHere}</p>}
        </div>
        {website && text.websitePrompt && (
          <p className="mt-4 text-sm text-gray-500">
            {text.websitePrompt}{' '}
            <a href={website} className="font-medium text-brand-ink underline">
              {text.websiteLinkText}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

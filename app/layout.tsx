import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getProfile, type Role } from '@/lib/auth';
import { getBrand, getBrandTokens } from '@/brands';
import { ThemeToggle } from '@/components/theme-toggle';
import { THEME_COOKIE } from '@/lib/theme';
import './globals.css';

// Everything the product says about itself comes from the deployment's brand
// file (brands/<brand>.ts, chosen by NEXT_PUBLIC_BRAND).
const brand = getBrand();
const tokens = getBrandTokens(brand);

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s | ${brand.name}` },
  description: brand.tagline,
};

// Which nav links each role sees. Order matters: first link is the "home"
// each role lands on.
const NAV: Record<Role, { href: string; label: string }[]> = {
  learner: [{ href: '/', label: 'My training' }],
  viewer: [{ href: '/reports', label: 'Reporting' }],
  manager: [
    { href: '/', label: 'My training' },
    { href: '/team', label: 'My team' },
    { href: '/reports', label: 'Reporting' },
  ],
  admin: [
    { href: '/reports', label: 'Reporting' },
    { href: '/build', label: 'Courses' },
    { href: '/assign', label: 'Assign' },
    { href: '/people', label: 'People' },
    { href: '/structure', label: 'Structure' },
    { href: '/import', label: 'Import SCORM' },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = saved === 'dark' || saved === 'light' ? saved : undefined;
  const links = profile ? NAV[profile.role] : [];
  const footerLinks = [
    brand.links.help && { href: brand.links.help, label: 'Help' },
    brand.links.privacy && { href: brand.links.privacy, label: 'Privacy' },
    brand.links.terms && { href: brand.links.terms, label: 'Terms' },
    brand.supportEmail && { href: `mailto:${brand.supportEmail}`, label: 'Contact support' },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <html
      lang="en-AU"
      data-theme={theme}
      style={
        {
          '--brand': tokens.brand,
          '--brand-fg': tokens.brandFg,
          '--brand-ink-light': tokens.brandInk,
          '--brand-soft-light': tokens.brandSoft,
          '--brand-ink-dark': tokens.brandInkDark,
          '--brand-soft-dark': tokens.brandSoftDark,
        } as React.CSSProperties
      }
    >
      <body className="min-h-screen bg-surface text-gray-900 antialiased">
        <header className="border-b border-gray-200 border-t-4 border-t-brand">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              {brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logoUrl} alt={brand.name} className="h-7 max-w-[160px] object-contain dark:rounded dark:bg-white dark:p-0.5" />
              ) : (
                brand.name
              )}
            </Link>
            <nav className="flex flex-wrap gap-x-4 text-sm">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="text-gray-600 hover:text-brand-ink">
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              {!profile && (
                <Link href="/login" className="text-sm font-medium text-brand-ink underline">
                  Log in
                </Link>
              )}
              {profile && (
                <form action="/auth/signout" method="post">
                  <button
                    type="submit"
                    className="text-sm text-gray-600 underline hover:text-brand-ink"
                  >
                    Log out
                  </button>
                </form>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
        {footerLinks.length > 0 && (
          <footer className="mx-auto max-w-4xl px-4 pb-8 text-sm text-gray-600">
            <nav className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-200 pt-4">
              {footerLinks.map((l) => (
                <a key={l.label} href={l.href} className="underline hover:text-brand-ink">
                  {l.label}
                </a>
              ))}
            </nav>
          </footer>
        )}
      </body>
    </html>
  );
}

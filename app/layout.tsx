import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getProfile, type Role } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getBrand, getBrandTokens } from '@/brands';
import { ThemeToggle } from '@/components/theme-toggle';
import { BrandLogo } from '@/components/brand-logo';
import { SideNav, type NavSection } from '@/components/side-nav';
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

// The menu for each role, in sections. The first link is where that role
// lands. A link can have children to make a drop-down (see components/side-nav).
function menuFor(role: Role, unread: number): NavSection[] {
  const messages: NavSection = { title: 'Community', links: [{ href: '/messages', label: 'Messages', badge: unread }] };
  const learning: NavSection = { title: 'Learning', links: [{ href: '/', label: 'My training' }] };
  switch (role) {
    case 'learner':
      return [learning, messages];
    case 'viewer':
      return [{ title: 'Reporting', links: [{ href: '/reports', label: 'Reporting' }] }, messages];
    case 'manager':
      return [
        learning,
        { title: 'My team', links: [{ href: '/team', label: 'My team' }, { href: '/reports', label: 'Reporting' }] },
        messages,
      ];
    case 'admin':
      return [
        learning,
        {
          title: 'Manage',
          links: [
            { href: '/reports', label: 'Reporting' },
            { href: '/people', label: 'People' },
            { href: '/structure', label: 'Structure' },
            { href: '/assign', label: 'Assign' },
          ],
        },
        { title: 'Courses', links: [{ href: '/build', label: 'Courses' }, { href: '/import', label: 'Import SCORM' }] },
        messages,
        { title: 'Site', links: [{ href: '/settings', label: 'Settings' }] },
      ];
  }
}

const ROLE_LABEL: Record<Role, string> = {
  learner: 'Staff',
  viewer: 'Reporting, read only',
  manager: 'Manager',
  admin: 'Admin',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = saved === 'dark' || saved === 'light' ? saved : undefined;
  // Messages badge: unread updates and conversations, plus reported posts for moderators.
  let unread = 0;
  if (profile) {
    const { data } = await (await createClient()).rpc('message_counts');
    const c = (data ?? {}) as { announcements?: number; threads?: number; reported?: number };
    unread = (c.announcements ?? 0) + (c.threads ?? 0) + (c.reported ?? 0);
  }
  const footerLinks = [
    brand.links.help && { href: brand.links.help, label: 'Help' },
    brand.links.privacy && { href: brand.links.privacy, label: 'Privacy' },
    brand.links.terms && { href: brand.links.terms, label: 'Terms' },
    brand.supportEmail && { href: `mailto:${brand.supportEmail}`, label: 'Contact support' },
  ].filter(Boolean) as { href: string; label: string }[];

  const logo = (
    <Link href="/" className="flex items-center gap-2 font-semibold">
      {brand.welcome?.logoUrl ? (
        // A client's wide logo (the same one as the welcome page), on every page.
        <>
          <BrandLogo src={brand.welcome.logoUrl} className="h-4 w-auto max-w-[180px] sm:h-5" />
          <span className="text-sm font-medium text-gray-600">Training</span>
        </>
      ) : brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt={brand.name} className="h-7 max-w-[160px] object-contain dark:rounded dark:bg-white dark:p-0.5" />
      ) : (
        brand.name
      )}
    </Link>
  );
  const siteFooter = footerLinks.length > 0 && (
    <footer className="mx-auto max-w-4xl px-4 pb-8 text-sm text-gray-600">
      <nav className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-200 pt-4">
        {footerLinks.map((l) => (
          <a key={l.label} href={l.href} className="underline hover:text-brand-ink">
            {l.label}
          </a>
        ))}
      </nav>
    </footer>
  );

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
        {profile ? (
          <div className="lg:flex">
            <SideNav
              sections={menuFor(profile.role, unread)}
              logo={logo}
              unread={unread}
              user={{ name: profile.full_name || profile.email, role: ROLE_LABEL[profile.role] }}
              footer={
                <>
                  <ThemeToggle />
                  <form action="/auth/signout" method="post">
                    <button type="submit" className="min-h-11 rounded-lg px-3 text-sm text-gray-600 underline hover:text-brand-ink">
                      Log out
                    </button>
                  </form>
                </>
              }
            />
            <div className="min-w-0 flex-1">
              <main className="mx-auto max-w-4xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
              {siteFooter}
            </div>
          </div>
        ) : (
          <>
            <header className="border-b border-gray-200 border-t-4 border-t-brand">
              <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
                {logo}
                <div className="ml-auto flex items-center gap-2">
                  <ThemeToggle />
                  <Link href="/login" className="text-sm font-medium text-brand-ink underline">
                    Log in
                  </Link>
                </div>
              </div>
            </header>
            <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
            {siteFooter}
          </>
        )}
      </body>
    </html>
  );
}

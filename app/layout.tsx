import type { Metadata } from 'next';
import Link from 'next/link';
import { getProfile, type Role } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'P1xel Forge Training',
  description: 'Training for retail staff and client teams.',
};

// Which nav links each role sees. Order matters — first link is the "home"
// each role lands on.
const NAV: Record<Role, { href: string; label: string }[]> = {
  learner: [{ href: '/', label: 'My training' }],
  manager: [
    { href: '/', label: 'My training' },
    { href: '/team', label: 'My team' },
    { href: '/reports', label: 'Reporting' },
  ],
  coordinator: [{ href: '/reports', label: 'Reporting' }],
  admin: [
    { href: '/reports', label: 'Reporting' },
    { href: '/assign', label: 'Assign' },
    { href: '/people', label: 'People' },
    { href: '/structure', label: 'Structure' },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  const links = profile ? NAV[profile.role] : [];

  return (
    <html lang="en-AU">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <header className="border-b border-gray-200">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="font-semibold">P1xel Forge Training</span>
            <nav className="flex flex-wrap gap-x-4 text-sm">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="text-gray-600 hover:text-gray-900">
                  {l.label}
                </Link>
              ))}
            </nav>
            {profile && (
              <form action="/auth/signout" method="post" className="ml-auto">
                <button
                  type="submit"
                  className="text-sm text-gray-500 underline hover:text-gray-900"
                >
                  Log out
                </button>
              </form>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

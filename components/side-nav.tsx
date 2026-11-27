'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

// The main menu for logged-in people. A side panel on wide screens; a top bar
// with a Menu button that opens the same panel on phones.
//
// The menu is a list of sections (Learning, Manage...), each with links. A
// section heading folds its links away. A link can also have its own
// sub-links (children), which open as a drop-down under it. Which sections are
// folded is remembered on this device.

export type NavLink = { href: string; label: string; badge?: number; children?: NavLink[] };
export type NavSection = { title: string; links: NavLink[] };

const FOLD_KEY = 'nav-folded';

function isActive(path: string, href: string): boolean {
  if (href === '/') return path === '/' || path.startsWith('/courses') || path.startsWith('/lessons') || path.startsWith('/retest');
  return path === href || path.startsWith(`${href}/`);
}

function Chevron({ open, className = '' }: { open: boolean; className?: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${className}`}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto rounded-full bg-brand px-1.5 text-xs font-semibold leading-5 text-brand-fg">
      {n > 99 ? '99+' : n}
      <span className="sr-only"> new</span>
    </span>
  );
}

function Item({ link, path }: { link: NavLink; path: string }) {
  const active = isActive(path, link.href);
  const childActive = link.children?.some((c) => isActive(path, c.href)) ?? false;
  const [open, setOpen] = useState(childActive);
  const base =
    'relative flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors';
  const look = active
    ? 'bg-brand-soft font-semibold text-brand-ink'
    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900';

  if (link.children?.length) {
    return (
      <li>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`${base} ${childActive ? 'font-semibold text-gray-900' : 'text-gray-700 hover:bg-gray-100'}`}>
          {link.label}
          <Badge n={link.badge} />
          <Chevron open={open} className={link.badge ? '' : 'ml-auto'} />
        </button>
        {open && (
          <ul className="mt-1 space-y-0.5 border-l border-gray-200 pl-2 ml-4">
            {link.children.map((c) => (
              <Item key={c.href} link={c} path={path} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <Link href={link.href} aria-current={active ? 'page' : undefined} className={`${base} ${look}`}>
        {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-full bg-brand" />}
        {link.label}
        <Badge n={link.badge} />
        {active && !link.badge && (
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0">
            <path d="m9 6 6 6-6 6" />
          </svg>
        )}
      </Link>
    </li>
  );
}

function Sections({ sections, path }: { sections: NavSection[]; path: string }) {
  const [folded, setFolded] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]');
      if (Array.isArray(saved)) setFolded(saved.filter((s) => typeof s === 'string'));
    } catch {
      // No saved choice (private window, blocked storage): everything open.
    }
  }, []);
  function toggle(title: string) {
    const next = folded.includes(title) ? folded.filter((t) => t !== title) : [...folded, title];
    setFolded(next);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(next));
    } catch {
      // Fine: it just won't be remembered.
    }
  }

  return (
    <div className="space-y-3">
      {sections.map((s) => {
        // The section holding the page you're on never folds away.
        const holdsActive = s.links.some((l) => isActive(path, l.href) || l.children?.some((c) => isActive(path, c.href)));
        const open = holdsActive || !folded.includes(s.title);
        const id = `nav-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        return (
          <div key={s.title} className="rounded-xl border border-gray-200 p-1.5">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              disabled={holdsActive}
              onClick={() => toggle(s.title)}
              className="flex min-h-9 w-full items-center px-3 text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink disabled:cursor-default"
            >
              {s.title}
              {!holdsActive && <Chevron open={open} className="ml-auto text-gray-500" />}
            </button>
            {open && (
              <ul id={id} className="space-y-0.5">
                {s.links.map((l) => (
                  <Item key={l.href} link={l} path={path} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SideNav({
  sections,
  logo,
  user,
  footer,
  unread,
}: {
  sections: NavSection[];
  /** The brand logo, linking home. */
  logo: ReactNode;
  user: { name: string; role: string };
  /** Theme switch and log out. */
  footer: ReactNode;
  /** Total new messages, for the phone menu button. */
  unread: number;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const initials =
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';

  const panel = (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="px-1">{logo}</div>
      <div className="flex items-center gap-3 border-b border-gray-200 px-1 pb-4">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-fg">
          {initials}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{user.name}</span>
          <span className="block truncate text-xs text-gray-500">{user.role}</span>
        </span>
      </div>
      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto">
        <Sections sections={sections} path={path} />
      </nav>
      <div className="flex items-center justify-between gap-2 border-t border-gray-200 pt-3">{footer}</div>
    </div>
  );

  return (
    <>
      {/* Wide screens: the panel down the left. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-gray-200 border-t-4 border-t-brand lg:block">
        {panel}
      </aside>

      {/* Phones and tablets: a top bar, and the panel slides in. */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 border-t-4 border-t-brand bg-surface px-4 py-2 lg:hidden">
        <div className="min-w-0 flex-1">{logo}</div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-medium hover:bg-gray-50"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          Menu
          {unread > 0 && <span className="h-2 w-2 rounded-full bg-brand" aria-label="New messages" />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div id="mobile-nav" className="absolute inset-y-0 left-0 w-[min(20rem,85vw)] overflow-y-auto bg-surface shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"
              aria-label="Close menu"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
            {panel}
          </div>
        </div>
      )}
    </>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { THEME_COOKIE } from '@/lib/theme';

// Light / dark switch in the header. The choice is kept in a cookie for a year
// so the server renders the right theme on the next visit with no flash.
// Until someone chooses, the page follows their device setting (CSS, see
// app/globals.css).

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const chosen = document.documentElement.dataset.theme;
    setDark(chosen ? chosen === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    document.cookie = `${THEME_COOKIE}=${next ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax`;
  }

  // Render a same-sized placeholder until we know the theme, so the header
  // doesn't jump.
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark === null ? 'Switch theme' : label}
      title={dark === null ? undefined : label}
      className="inline-flex h-11 w-11 items-center justify-center rounded text-gray-600 hover:bg-gray-100 hover:text-brand-ink"
    >
      {dark ? (
        // Sun: tap for light.
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // Moon: tap for dark.
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

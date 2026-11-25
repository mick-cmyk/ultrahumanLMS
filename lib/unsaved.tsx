'use client';

import { useEffect } from 'react';

// Unsaved text on a page: a "Not saved yet" note beside its Save button, and a
// warning before leaving the page (closing the tab, reloading, or clicking a
// link in the app) while any form on it has changes that aren't saved.
//
// Tick boxes and dropdowns save the moment they change, so only text forms
// use this.

const dirtyForms = new Set<symbol>();
let installed = false;
const MESSAGE = 'You have changes that are not saved. Leave this page anyway?';

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!dirtyForms.size) return;
  e.preventDefault();
  e.returnValue = '';
}

// In-app links don't fire beforeunload, so catch them first (capture phase):
// cancelling here also stops Next's <Link> from navigating.
function onClick(e: MouseEvent) {
  if (!dirtyForms.size || e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // opens a new tab
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  const url = new URL(a.href, window.location.href);
  if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.hash) return;
  if (window.confirm(MESSAGE)) {
    dirtyForms.clear(); // they chose to leave: don't ask again on the way out
  } else {
    e.preventDefault();
    e.stopPropagation();
  }
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('click', onClick, true);
}

/** Warn before leaving the page while `dirty` is true. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const key = Symbol('unsaved');
    dirtyForms.add(key);
    install();
    return () => {
      dirtyForms.delete(key);
    };
  }, [dirty]);
}

/** Small note beside a Save button while there are unsaved changes. */
export function NotSaved({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return <span className="text-sm font-medium text-amber-800">Not saved yet</span>;
}

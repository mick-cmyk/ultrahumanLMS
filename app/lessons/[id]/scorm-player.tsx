'use client';

import { useEffect, useRef, useState } from 'react';
import { Scorm12Api, type ScormLaunch, type ScormState } from '@/lib/scorm/runtime';

// Runs an imported SCORM 1.2 package. The package is loaded in an iframe from
// this app's own origin (/scorm-files/...) and finds window.API on this page.
// Saves go to /api/scorm/commit; on page close they go by sendBeacon so the
// last state isn't lost.

type Props = {
  lessonId: string;
  title: string;
  packageId: string;
  launchHref: string;
  launch: ScormLaunch;
  initiallyComplete: boolean;
  /** Admin checking a lesson they aren't assigned: run it, save nothing. */
  preview: boolean;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

declare global {
  interface Window {
    API?: Scorm12Api;
  }
}

export function ScormPlayer({ lessonId, title, packageId, launchHref, launch, initiallyComplete, preview }: Props) {
  const [complete, setComplete] = useState(initiallyComplete);
  const [save, setSave] = useState<SaveState>('idle');
  const apiRef = useRef<Scorm12Api | null>(null);

  useEffect(() => {
    const send = (state: ScormState, sessionSeconds: number, finishing: boolean) => {
      if (preview) return;
      const body = JSON.stringify({ lessonId, state, sessionSeconds });
      if (finishing && document.visibilityState === 'hidden' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/scorm/commit', new Blob([body], { type: 'text/plain' }));
        return;
      }
      setSave('saving');
      fetch('/api/scorm/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { completed?: boolean };
          if (data.completed) setComplete(true);
          setSave('saved');
        })
        .catch(() => setSave('error'));
    };

    const api = new Scorm12Api(launch, send);
    apiRef.current = api;
    window.API = api; // SCORM 1.2 packages look for exactly this name

    const onHide = () => api.flush(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      api.flush(true);
      if (window.API === api) delete window.API;
    };
    // launch is fixed for the life of the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const src = `/scorm-files/${packageId}/${launchHref}`;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
        <iframe
          src={src}
          title={`${title} (interactive lesson)`}
          className="block h-[75vh] min-h-[480px] w-full bg-white"
          allow="fullscreen; autoplay"
        />
      </div>
      <div aria-live="polite" className="text-sm">
        {preview ? (
          <p className="rounded bg-gray-100 p-3 text-gray-800">
            Preview. You aren&apos;t assigned this course, so nothing you do here is saved.
          </p>
        ) : complete ? (
          <p className="rounded bg-green-50 p-3 font-medium text-green-800">
            Done. This lesson is complete.
          </p>
        ) : (
          <p className="text-gray-600">
            Work through the lesson above. It saves as you go and counts as done when the lesson
            says you&apos;ve finished.
          </p>
        )}
        {save === 'error' && (
          <p className="mt-2 rounded bg-amber-50 p-3 text-amber-800">
            We couldn&apos;t save your progress just now. Keep going; we&apos;ll try again at the next step.
          </p>
        )}
      </div>
    </div>
  );
}

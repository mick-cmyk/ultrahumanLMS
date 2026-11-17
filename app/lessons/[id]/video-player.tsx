'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Watch tracking, the honest way: a Set of unique second-indices seen via the
// player's timeupdate events. watch_pct = unique seconds / duration, so
// scrubbing to the end doesn't count. Posts are throttled - every 10s while
// playing, plus on pause and page-hide - and the server never lets the stored
// percentage decrease.
//
// Two sources: a Bunny signed embed (iframe + player.js) in production, or a
// plain sample video (native <video>) for demos before Bunny is wired up. Both
// feed the same tracking so the watch -> quiz -> complete loop works either way.
export function VideoPlayer({
  lessonId,
  title,
  durationSeconds,
  watchThreshold,
  embedUrl,
  sampleVideoUrl,
  imageUrl,
  initialPct,
  initiallyWatched,
}: {
  lessonId: string;
  /** Lesson title, for the video frame's accessible name. */
  title: string;
  durationSeconds: number | null;
  watchThreshold: number;
  embedUrl: string | null;
  sampleVideoUrl: string | null;
  imageUrl: string | null;
  initialPct: number;
  initiallyWatched: boolean;
}) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seenSeconds = useRef<Set<number>>(new Set());
  const durationRef = useRef<number | null>(durationSeconds);
  const lastSentPct = useRef(initialPct);
  const watchedRef = useRef(initiallyWatched);
  const [pct, setPct] = useState(initialPct);
  const [watched, setWatched] = useState(initiallyWatched);

  const mode: 'bunny' | 'sample' | 'none' = embedUrl
    ? 'bunny'
    : sampleVideoUrl
      ? 'sample'
      : 'none';

  useEffect(() => {
    if (mode === 'none') return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let detach: (() => void) | undefined;

    function currentPct() {
      const duration = durationRef.current;
      if (!duration || duration <= 0) return 0;
      return Math.min(1, seenSeconds.current.size / duration);
    }

    function markSecond(seconds: number, duration?: number) {
      if (duration && duration > 0) durationRef.current = duration;
      if (Number.isFinite(seconds)) seenSeconds.current.add(Math.floor(seconds));
      setPct(Math.max(currentPct(), lastSentPct.current));
    }

    async function post(useBeacon = false) {
      const p = Math.max(currentPct(), lastSentPct.current);
      if (p <= lastSentPct.current) return;
      lastSentPct.current = p;
      const body = JSON.stringify({ lesson_id: lessonId, watch_pct: p });

      if (useBeacon) {
        navigator.sendBeacon('/api/progress', body);
        return;
      }
      try {
        const res = await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (res.ok && !cancelled) {
          const row = await res.json();
          setPct(row.watch_pct ?? p);
          if (row.watched_at && !watchedRef.current) {
            watchedRef.current = true;
            setWatched(true);
            router.refresh(); // reveal the now-unlocked quiz without a reload
          }
        }
      } catch {
        // Transient network failure - the next throttled post catches up.
        lastSentPct.current = Math.min(lastSentPct.current, p);
      }
    }

    const onHide = () => {
      if (document.visibilityState === 'hidden') post(true);
    };
    const onPageHide = () => post(true);

    if (mode === 'sample') {
      const v = videoRef.current;
      if (!v) return;
      const onTime = () => markSecond(v.currentTime, v.duration);
      const onMeta = () => {
        if (v.duration && Number.isFinite(v.duration)) durationRef.current = v.duration;
      };
      const onPause = () => post();
      const onEnded = () => post();
      v.addEventListener('timeupdate', onTime);
      v.addEventListener('loadedmetadata', onMeta);
      v.addEventListener('pause', onPause);
      v.addEventListener('ended', onEnded);
      detach = () => {
        v.removeEventListener('timeupdate', onTime);
        v.removeEventListener('loadedmetadata', onMeta);
        v.removeEventListener('pause', onPause);
        v.removeEventListener('ended', onEnded);
      };
      interval = setInterval(() => post(), 10_000);
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onPageHide);
    } else {
      // Bunny embed via player.js.
      (async () => {
        const playerjs = await import('player.js');
        if (cancelled || !iframeRef.current) return;
        const player = new playerjs.Player(iframeRef.current);
        player.on('timeupdate', ({ seconds, duration }) => markSecond(seconds, duration));
        player.on('pause', () => post());
        player.on('ended', () => post());
      })();
      interval = setInterval(() => post(), 10_000);
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onPageHide);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (detach) detach();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      post(true);
    };
  }, [mode, lessonId, router]);

  return (
    <div className="space-y-3">
      {mode === 'bunny' && (
        <div className="aspect-video w-full overflow-hidden rounded border border-gray-200 bg-black">
          <iframe
            ref={iframeRef}
            src={embedUrl!}
            title={`${title} (video)`}
            className="h-full w-full"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {mode === 'sample' && (
        <div className="space-y-1">
          <div className="aspect-video w-full overflow-hidden rounded border border-gray-200 bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              src={sampleVideoUrl!}
              poster={imageUrl ?? undefined}
              controls
              playsInline
              className="h-full w-full"
            />
          </div>
          <p className="text-xs text-gray-500">
            Sample clip - swap in the real Bunny video when it&apos;s ready.
          </p>
        </div>
      )}

      {mode === 'none' && (
        <div className="flex aspect-video w-full items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-gray-500">
          The video for this lesson isn&apos;t connected yet. Check back soon.
        </div>
      )}

      {mode !== 'none' && (
        <>
          <div className="flex items-center justify-between text-sm">
            {watched ? (
              <span className="font-medium text-green-700">
                <span aria-hidden="true">✓ </span>Watched
              </span>
            ) : (
              <span className="text-gray-600">
                You&apos;ve watched {Math.round(pct * 100)}%. It counts as watched at{' '}
                {Math.round(watchThreshold * 100)}%.
              </span>
            )}
          </div>
          <div
            role="progressbar"
            aria-label="How much of the video you've watched"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct * 100)}
            className="h-2 w-full rounded bg-gray-100"
          >
            <div
              className={`h-2 rounded ${watched ? 'bg-green-600' : 'bg-gray-600'}`}
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

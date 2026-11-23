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
  aspect,
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
  /** Video width / height from Bunny; null means assume 16:9. */
  aspect?: number | null;
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

  // A course where watching is optional has a threshold of 0: opening the
  // lesson counts, which unlocks the quiz (the server stamps watched_at).
  const optional = watchThreshold <= 0;
  useEffect(() => {
    if (!optional || watchedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lesson_id: lessonId, watch_pct: 0 }),
        });
        if (!res.ok || cancelled) return;
        const row = await res.json();
        if (row.watched_at && !watchedRef.current) {
          watchedRef.current = true;
          setWatched(true);
          router.refresh();
        }
      } catch {
        /* try again next visit */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [optional, lessonId, router]);

  // Shown in steps of 10% so the number doesn't tick up every second.
  const shownPct = Math.min(100, Math.floor(pct * 10) * 10);

  // The frame takes the video's own shape. A portrait clip on a phone fills
  // most of the screen height; it never grows past 80% of the screen height,
  // so the progress and quiz stay in reach.
  const ratio = aspect && aspect > 0 ? aspect : 16 / 9;
  const frameStyle = { aspectRatio: String(ratio), width: `min(100%, calc(80svh * ${ratio}))` };

  return (
    <div className="space-y-3">
      {mode === 'bunny' && (
        <div className="mx-auto overflow-hidden rounded border border-gray-200 bg-black" style={frameStyle}>
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
          <div className="mx-auto overflow-hidden rounded border border-gray-200 bg-black" style={frameStyle}>
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

      {mode !== 'none' && optional && (
        <p className="text-sm text-gray-600">
          {watched ? (
            <span className="font-medium text-green-700">
              <span aria-hidden="true">✓ </span>The quiz is open.
            </span>
          ) : null}{' '}
          Watching the video is optional for this course, but it will help with the questions.
        </p>
      )}

      {mode !== 'none' && !optional && (
        <>
          <div className="flex items-center justify-between text-sm">
            {watched ? (
              <span className="font-medium text-green-700">
                <span aria-hidden="true">✓ </span>Watched
              </span>
            ) : (
              <span className="text-gray-600">
                You&apos;ve watched {shownPct}%. It counts as watched at{' '}
                {Math.round(watchThreshold * 100)}%.
              </span>
            )}
          </div>
          <div
            role="progressbar"
            aria-label="How much of the video you've watched"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={shownPct}
            className="h-2 w-full rounded bg-gray-100"
          >
            <div
              className={`h-2 rounded ${watched ? 'bg-green-600' : 'bg-gray-600'}`}
              style={{ width: `${watched ? 100 : shownPct}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

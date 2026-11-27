'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A picture that fills a 16:9 box. Wide pictures fill it. Upright ones (phone
 * videos) are shown whole, with a blurred copy filling the sides, so heads are
 * never cropped off. Calls onFail when the picture can't load.
 */
export function FitImage({ src, alt = '', onFail }: { src: string; alt?: string; onFail: () => void }) {
  const [upright, setUpright] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const check = (img: HTMLImageElement) => setUpright(img.naturalHeight > img.naturalWidth * 1.05);
  // A picture already in the browser's cache can finish loading before the
  // page wakes up, and then onLoad never fires, so check once on mount too.
  useEffect(() => {
    const img = ref.current;
    if (!img?.complete) return;
    if (img.naturalWidth > 0) check(img);
    else onFail(); // failed before the page woke up, so onError was missed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return (
    <>
      {upright && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-md" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading="lazy"
        onError={onFail}
        onLoad={(e) => check(e.currentTarget)}
        className={`relative h-full w-full ${upright ? 'object-contain' : 'object-cover'}`}
      />
    </>
  );
}

// A 16:9 video thumbnail or course cover for staff pages. If the picture
// can't load (Bunny only serves the live site, or there is none), it shows a
// plain block with a play mark instead, so layouts never jump or break.
export function Thumb({ src, className = '', play = false }: { src: string | null; className?: string; play?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const ok = src && failed !== src;
  return (
    <span className={`relative block aspect-video overflow-hidden rounded bg-gray-100 ${className}`} aria-hidden="true">
      {ok && <FitImage src={src} onFail={() => setFailed(src)} />}
      {!ok && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-xs text-white">&#9654;</span>
        </span>
      )}
      {play && ok && (
        // Small, in the corner, so it never covers a face.
        <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[9px] text-white">&#9654;</span>
      )}
    </span>
  );
}

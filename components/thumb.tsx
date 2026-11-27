'use client';

import { useState } from 'react';

// A 16:9 video thumbnail or course cover for staff pages. If the picture
// can't load (Bunny only serves the live site, or there is none), it shows a
// plain block with a play mark instead, so layouts never jump or break.
export function Thumb({ src, className = '', play = false }: { src: string | null; className?: string; play?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const ok = src && failed !== src;
  return (
    <span className={`relative block aspect-video overflow-hidden rounded bg-gray-100 ${className}`} aria-hidden="true">
      {ok && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} className="h-full w-full object-cover" />
      )}
      {(play || !ok) && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-xs text-white">&#9654;</span>
        </span>
      )}
    </span>
  );
}

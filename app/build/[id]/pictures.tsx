'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { resizeToAspect } from '@/lib/resize-image';
import { FitImage } from '@/components/thumb';

// Pictures in the course builder: a lesson's video thumbnail (kept in Bunny,
// with the video) and a course's cover picture. Both save straight away.

const btn = 'min-h-11 rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50';

async function send(body: FormData | object): Promise<string | null> {
  const res = await fetch('/api/pictures', {
    method: 'POST',
    ...(body instanceof FormData
      ? { body }
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  }).catch(() => null);
  if (!res) return 'Could not reach the site. Check your connection and try again.';
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? 'Could not save the picture. Try again.';
}

/** A 16:9 picture that quietly says so when it can't load (for example on localhost). */
export function Picture({ src, alt = '', className = '' }: { src: string | null; alt?: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return (
      <div className={`flex aspect-video items-center justify-center rounded bg-gray-100 p-2 text-center text-xs text-gray-500 ${className}`}>
        {src ? 'Picture shows on the live site' : 'No picture'}
      </div>
    );
  }
  return (
    <span className={`relative block aspect-video overflow-hidden rounded bg-gray-100 ${className}`}>
      <FitImage src={src} alt={alt} onFail={() => setFailed(src)} />
    </span>
  );
}

function useUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(work: () => Promise<string | null>, done: string) {
    setBusy(true);
    setMsg(null);
    let error: string | null;
    try {
      error = await work();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the picture. Try again.';
    }
    setBusy(false);
    setMsg(error ? { ok: false, text: error } : { ok: true, text: done });
    if (!error) router.refresh();
  }
  return { busy, msg, run };
}

function Status({ msg, busy }: { msg: { ok: boolean; text: string } | null; busy: boolean }) {
  if (busy) return <p className="text-sm text-gray-600">Saving the picture...</p>;
  if (!msg) return null;
  return (
    <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>
      {msg.text}
    </p>
  );
}

export function LessonThumbnail({
  lessonId,
  hasVideo,
  current,
  frames,
  aspect,
}: {
  lessonId: string;
  hasVideo: boolean;
  current: string | null;
  frames: string[];
  /** The video's width / height from Bunny (below 1 for upright phone videos). */
  aspect: number | null;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const { busy, msg, run } = useUpload();

  if (!hasVideo) {
    return (
      <section className="space-y-1">
        <h3 className="text-sm font-medium">Thumbnail</h3>
        <p className="text-sm text-gray-600">Save the Bunny video link first. Its picture then shows here.</p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Thumbnail</h3>
      <p className="text-sm text-gray-600">
        The picture staff see for this video, in the course and in the player before it starts. Bunny picks one
        automatically. Upload your own, or pick another frame from the video. Saves straight away.
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <Picture src={current} alt="Current thumbnail" className="w-48" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={busy} onClick={() => file.current?.click()}>
            Upload a picture
          </button>
          <button type="button" className={btn} disabled={busy} aria-expanded={picking} onClick={() => setPicking(!picking)}>
            {picking ? 'Close frames' : 'Pick a frame from the video'}
          </button>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              run(async () => {
                // Same shape as the video, so it fits the player too.
                const shape = aspect && aspect < 1 ? 9 / 16 : 16 / 9;
                const small = await resizeToAspect(f, { aspect: shape, long: 1280, type: 'image/jpeg' });
                const form = new FormData();
                form.set('kind', 'lesson');
                form.set('id', lessonId);
                form.set('file', small);
                return send(form);
              }, 'Thumbnail saved.');
            }}
          />
        </div>
      </div>
      {picking && (
        <div>
          <p className="mb-2 text-sm text-gray-600">Click a frame to use it.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {frames.map((src, i) => (
              <button
                key={src}
                type="button"
                disabled={busy}
                className="rounded border-2 border-transparent hover:border-brand focus:border-brand disabled:opacity-50"
                aria-label={`Use frame ${i + 1}`}
                onClick={() =>
                  run(async () => {
                    const error = await send({ action: 'lesson.frame', id: lessonId, frame: i + 1 });
                    if (!error) setPicking(false);
                    return error;
                  }, 'Thumbnail saved.')
                }
              >
                <Picture src={src} className="w-full" />
              </button>
            ))}
          </div>
        </div>
      )}
      <Status msg={msg} busy={busy} />
    </section>
  );
}

export function CourseCover({
  courseId,
  cover,
  fallback,
}: {
  courseId: string;
  cover: string | null;
  /** The first video's thumbnail, used when there is no cover. */
  fallback: string | null;
}) {
  const file = useRef<HTMLInputElement>(null);
  const { busy, msg, run } = useUpload();

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Cover picture</h3>
      <p className="text-sm text-gray-600">
        Shown on the course card in My training.{' '}
        {cover ? 'Remove it to use the first video’s thumbnail instead.' : 'Without one, the first video’s thumbnail is used.'}{' '}
        Saves straight away.
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <Picture src={cover ?? fallback} alt="Course cover" className="w-48" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={busy} onClick={() => file.current?.click()}>
            {cover ? 'Change the picture' : 'Upload a picture'}
          </button>
          {cover && (
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => run(() => send({ action: 'course.cover.remove', id: courseId }), 'Cover removed.')}
            >
              Remove
            </button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              run(async () => {
                const small = await resizeToAspect(f, { aspect: 16 / 9, long: 1280, type: 'image/jpeg', quality: 0.8 });
                const form = new FormData();
                form.set('kind', 'course');
                form.set('id', courseId);
                form.set('file', small);
                return send(form);
              }, 'Cover saved.');
            }}
          />
        </div>
      </div>
      <Status msg={msg} busy={busy} />
    </section>
  );
}

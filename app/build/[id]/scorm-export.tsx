'use client';

import { useState } from 'react';
import { buildPackageZip, slug, type ExportLesson } from '@/lib/scorm/export';
import type { ExportPlan } from '@/lib/scorm/export-plan';

// "Download as SCORM": a self-contained SCORM 1.2 zip a retailer can load into
// their own LMS. The browser fetches the videos and builds the zip, so there's
// no size limit from the server.

type State =
  | { kind: 'idle' }
  | { kind: 'working'; text: string; pct: number | null }
  | { kind: 'done'; text: string; skipped: ExportPlan['skipped'] }
  | { kind: 'error'; text: string; skipped: ExportPlan['skipped'] };

async function fetchVideo(
  sources: string[],
  onBytes: (got: number, total: number | null) => void
): Promise<Uint8Array | null> {
  for (const url of sources) {
    let res: Response;
    try {
      res = await fetch(url, { cache: 'no-store' });
    } catch {
      continue;
    }
    if (!res.ok || !res.body) continue;
    const total = Number(res.headers.get('content-length')) || null;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.byteLength;
      onBytes(got, total);
    }
    const out = new Uint8Array(got);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.byteLength;
    }
    return out;
  }
  return null;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function ScormExport({ courseId }: { courseId: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const busy = state.kind === 'working';

  async function run() {
    setState({ kind: 'working', text: 'Getting the course ready...', pct: null });
    let plan: ExportPlan;
    try {
      const res = await fetch(`/api/courses/${courseId}/scorm`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not read the course.');
      plan = body;
    } catch (e) {
      setState({ kind: 'error', text: e instanceof Error ? e.message : 'Could not read the course.', skipped: [] });
      return;
    }
    if (!plan.lessons.length) {
      setState({ kind: 'error', text: 'There are no video lessons to put in the file.', skipped: plan.skipped });
      return;
    }

    const lessons: ExportLesson[] = [];
    for (const [i, l] of plan.lessons.entries()) {
      const label = `Downloading video ${i + 1} of ${plan.lessons.length}: ${l.title}`;
      setState({ kind: 'working', text: label, pct: 0 });
      const video = await fetchVideo(l.sources, (got, total) =>
        setState({ kind: 'working', text: `${label} (${mb(got)})`, pct: total ? got / total : null })
      );
      if (!video) {
        setState({
          kind: 'error',
          text: `Couldn't download the video for "${l.title}". Check it plays in the course, then try again.`,
          skipped: plan.skipped,
        });
        return;
      }
      lessons.push({
        id: l.id,
        title: l.title,
        videoPath: `media/lesson-${i + 1}.mp4`,
        video,
        watchThreshold: l.watchThreshold,
        script: l.script,
        quiz: l.quiz,
      });
    }

    setState({ kind: 'working', text: 'Putting the file together...', pct: null });
    // Let the message show before the (briefly blocking) zip step.
    await new Promise((r) => setTimeout(r, 50));
    let zip: Uint8Array;
    try {
      zip = buildPackageZip({
        id: plan.id,
        title: plan.title,
        description: plan.description,
        accent: plan.accent,
        accentText: plan.accentText,
        lessons,
      });
    } catch (e) {
      setState({ kind: 'error', text: e instanceof Error ? e.message : 'Could not build the file.', skipped: plan.skipped });
      return;
    }

    const fileName = `${slug(plan.title)}-scorm12.zip`;
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    const quizzes = lessons.filter((l) => l.quiz).length;
    setState({
      kind: 'done',
      text: `Downloaded ${fileName} (${mb(zip.byteLength)}): ${lessons.length} ${lessons.length === 1 ? 'lesson' : 'lessons'}, ${quizzes} with a quiz.`,
      skipped: plan.skipped,
    });
  }

  return (
    <section className="space-y-3 rounded border border-gray-200 p-4">
      <h2 className="font-semibold">Download as SCORM</h2>
      <p className="text-sm text-gray-600">
        A SCORM 1.2 file that another LMS can import. The videos, quizzes and scripts are all inside it, and it
        keeps the same watching and pass mark rules. It can&apos;t send the week-later re-test, and anyone who
        opens the file can see the quiz answers.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="min-h-11 rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
      >
        {busy ? 'Working...' : 'Download SCORM file'}
      </button>
      {state.kind === 'working' && (
        <div role="status" className="space-y-1 text-sm text-gray-700">
          <p>{state.text}</p>
          {state.pct !== null && (
            <div className="h-2 overflow-hidden rounded bg-gray-200">
              <div className="h-full bg-brand" style={{ width: `${Math.round(state.pct * 100)}%` }} />
            </div>
          )}
          <p className="text-xs text-gray-500">Keep this page open until it finishes.</p>
        </div>
      )}
      {state.kind === 'done' && (
        <p role="status" className="text-sm text-green-800">
          {state.text} Test it in your LMS before sending it to a retailer.
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="text-sm text-red-700">
          {state.text}
        </p>
      )}
      {(state.kind === 'done' || state.kind === 'error') && state.skipped.length > 0 && (
        <div className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">Left out of the file:</p>
          <ul className="list-disc pl-5">
            {state.skipped.map((s, i) => (
              <li key={i}>
                {s.title}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

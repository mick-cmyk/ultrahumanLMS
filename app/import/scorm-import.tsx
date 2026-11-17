'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ManifestError } from '@/lib/scorm/manifest';
import { MB, unpack, type Unpacked } from '@/lib/scorm/unpack';
import { contentTypeFor } from '@/lib/scorm/mime';

type CourseOption = { id: string; title: string; published: boolean; modules: { id: string; title: string }[] };

export function ScormImport({ courses, userId }: { courses: CourseOption[]; userId: string }) {
  const [pkg, setPkg] = useState<Unpacked | null>(null);
  const [problem, setProblem] = useState('');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState<'new' | string>(courses.some((c) => c.modules.length) ? '' : 'new');
  const [courseTitle, setCourseTitle] = useState('');
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<{ lessonId: string; courseId: string } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    setProblem('');
    setPkg(null);
    setDone(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const unpacked = unpack(await file.arrayBuffer());
      setPkg(unpacked);
      setTitle(unpacked.manifest.title);
      setCourseTitle(unpacked.manifest.title);
    } catch (err) {
      setProblem(err instanceof ManifestError ? err.message : 'We couldn’t read that zip.');
    }
  }

  async function runImport() {
    if (!pkg) return;
    setBusy(true);
    setProblem('');
    setProgress(0);
    const supabase = createClient();
    const packageId = crypto.randomUUID();
    try {
      // 1. Files, a few at a time.
      let sent = 0;
      const queue = [...pkg.files];
      const worker = async () => {
        for (let f = queue.shift(); f; f = queue.shift()) {
          const { error } = await supabase.storage
            .from('scorm')
            .upload(`${packageId}/${f.path}`, new Blob([f.data as BlobPart], { type: contentTypeFor(f.path) }), {
              contentType: contentTypeFor(f.path),
              upsert: false,
            });
          if (error) throw new Error(`Uploading ${f.path}: ${error.message}`);
          sent += f.data.byteLength;
          setProgress(sent / pkg.totalBytes);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);

      // 2. The package row.
      const { error: pkgErr } = await supabase.from('scorm_packages').insert({
        id: packageId,
        title: pkg.manifest.title,
        launch_href: pkg.manifest.launchHref,
        manifest: {
          title: pkg.manifest.title,
          mastery_score: pkg.manifest.masteryScore,
          sco_count: pkg.manifest.scoCount,
        },
        file_count: pkg.files.length,
        total_bytes: pkg.totalBytes,
        uploaded_by: userId,
      });
      if (pkgErr) throw new Error(`Saving the package: ${pkgErr.message}`);

      // 3. Where it goes: an existing module, or a new course with one module.
      let moduleId = target;
      let courseId = courses.find((c) => c.modules.some((m) => m.id === target))?.id ?? '';
      if (target === 'new') {
        const { data: course, error: cErr } = await supabase
          .from('courses')
          .insert({ title: courseTitle.trim() || pkg.manifest.title, published: publish })
          .select('id')
          .single();
        if (cErr || !course) throw new Error(`Creating the course: ${cErr?.message}`);
        courseId = course.id;
        const { data: mod, error: mErr } = await supabase
          .from('modules')
          .insert({ course_id: course.id, title: 'Lessons', sort_order: 1 })
          .select('id')
          .single();
        if (mErr || !mod) throw new Error(`Creating the module: ${mErr?.message}`);
        moduleId = mod.id;
      }

      const { data: last } = await supabase
        .from('lessons')
        .select('sort_order')
        .eq('module_id', moduleId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: lesson, error: lErr } = await supabase
        .from('lessons')
        .insert({
          module_id: moduleId,
          title: title.trim() || pkg.manifest.title,
          sort_order: (last?.sort_order ?? 0) + 1,
          kind: 'scorm',
          scorm_package_id: packageId,
        })
        .select('id')
        .single();
      if (lErr || !lesson) throw new Error(`Creating the lesson: ${lErr?.message}`);

      setDone({ lessonId: lesson.id, courseId });
      setPkg(null);
      setTimeout(() => resultRef.current?.focus(), 0);
    } catch (err) {
      // Files already uploaded under packageId are left behind; they're
      // unreachable without a package row and can be cleared from storage.
      setProblem(err instanceof Error ? err.message : 'The import failed.');
    } finally {
      setBusy(false);
    }
  }

  const canImport =
    pkg && !busy && (target === 'new' ? courseTitle.trim() !== '' || pkg.manifest.title : target !== '');

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">SCORM 1.2 zip</span>
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={choose}
          disabled={busy}
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-brand file:px-4 file:py-2 file:font-medium file:text-brand-fg"
        />
      </label>

      {problem && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">
          {problem}
        </p>
      )}

      {pkg && (
        <div className="space-y-4 rounded-lg border border-gray-200 p-4">
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-600">Package</dt>
            <dd className="font-medium">{pkg.manifest.title}</dd>
            <dt className="text-gray-600">Starts at</dt>
            <dd className="break-all font-mono text-xs leading-5">{pkg.manifest.launchHref}</dd>
            <dt className="text-gray-600">Size</dt>
            <dd>
              {pkg.files.length} files, {MB(pkg.totalBytes)}
            </dd>
            {pkg.manifest.masteryScore != null && (
              <>
                <dt className="text-gray-600">Pass mark</dt>
                <dd>{pkg.manifest.masteryScore}%</dd>
              </>
            )}
          </dl>
          {pkg.manifest.scoCount > 1 && (
            <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
              This package has {pkg.manifest.scoCount} separate parts. Only the first one runs as this
              lesson. If the package needs all of them, ask its author for a single-part export.
            </p>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Lesson name</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Add it to</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="" disabled>
                Choose where it goes
              </option>
              <option value="new">A new course</option>
              {courses
                .filter((c) => c.modules.length)
                .map((c) => (
                  <optgroup key={c.id} label={`${c.title}${c.published ? '' : ' (draft)'}`}>
                    {c.modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
            </select>
          </label>

          {target === 'new' && (
            <div className="space-y-3 rounded bg-gray-50 p-3">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Course name</span>
                <input
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} className="h-5 w-5" />
                Publish it straight away (it still needs assigning before anyone sees it)
              </label>
            </div>
          )}

          {busy && (
            <div>
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                className="h-2 overflow-hidden rounded bg-gray-200"
              >
                <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <p className="mt-1 text-sm text-gray-600">Uploading… {Math.round(progress * 100)}%</p>
            </div>
          )}

          <button
            type="button"
            onClick={runImport}
            disabled={!canImport}
            className="rounded bg-brand px-4 py-2 font-medium text-brand-fg disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      )}

      <div ref={resultRef} tabIndex={-1} aria-live="polite" className="outline-none">
        {done && (
          <div className="rounded bg-green-50 p-4 text-sm text-green-900">
            <p className="font-medium">Imported.</p>
            <p className="mt-1">
              <Link href={`/lessons/${done.lessonId}`} className="underline">
                Open the lesson
              </Link>{' '}
              to check it runs, then{' '}
              <Link href="/assign" className="underline">
                assign the course
              </Link>{' '}
              so staff can see it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

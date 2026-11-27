'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { courseApi, download, formatDuration, parseDuration } from '../api';
import { SendToManager } from './check/send-to-manager';
import { NotSaved, useUnsavedWarning } from '@/lib/unsaved';
import { ScormExport } from './scorm-export';
import { CourseCover, LessonThumbnail, Picture } from './pictures';
import {
  ANSWER_LETTERS,
  MAX_QUESTIONS,
  parseQuestionsCsv,
  questionsToCsv,
  templateCsv,
  type QuizQuestion,
} from '@/lib/quiz-csv';
import { parseLessonImport, type LessonImport, type WrittenPrompt } from '@/lib/lesson-import';

type Lesson = {
  id: string;
  title: string;
  kind: string;
  bunny_video_id: string | null;
  sample_video_url: string | null;
  duration_seconds: number | null;
  script: string | null;
  quiz: { pass_mark: number; questions: QuizQuestion[] } | null;
  expectancy: string | null;
  written_prompts: WrittenPrompt[];
  needs_review: boolean;
  draft: { note: string | null; created_at: string; questions?: QuizQuestion[]; pass_mark?: number } | null;
};
type Module = { id: string; title: string; intro: string | null; lessons: Lesson[] };
/** Thumbnails (from Bunny) and the course cover, worked out on the server. */
export type Pictures = {
  cover: string | null;
  fallback: string | null;
  lessons: Record<string, { thumbnail: string | null; frames: string[] }>;
};
type Course = {
  id: string;
  title: string;
  description: string | null;
  require_watch: boolean;
  published: boolean;
  modules: Module[];
};

const input = 'w-full rounded border border-gray-300 bg-surface px-3 py-2';
const btn = 'min-h-11 rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50';
const primary = 'min-h-11 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50';

// One shared hook for "send this, show what happened, refresh the page data".
function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'note'; text: string } | null>(null);
  async function save(body: Record<string, unknown>, okText = 'Saved.') {
    setBusy(true);
    setMsg(null);
    const res = await courseApi(body);
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: 'error', text: res.error! });
      return null;
    }
    setMsg(res.note ? { kind: 'note', text: String(res.note) } : { kind: 'ok', text: okText });
    router.refresh();
    return res;
  }
  return { busy, msg, setMsg, save };
}

function Msg({ msg, dirty = false }: { msg: { kind: 'ok' | 'error' | 'note'; text: string } | null; dirty?: boolean }) {
  // A "Saved." from before is out of date once there are new unsaved edits.
  if (!msg || (dirty && msg.kind === 'ok')) return null;
  const style =
    msg.kind === 'error' ? 'text-red-700' : msg.kind === 'note' ? 'text-amber-800' : 'text-green-800';
  return (
    <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${style}`}>
      {msg.text}
    </p>
  );
}

export function CourseEditor({ course, pictures, lookupAvailable }: { course: Course; pictures: Pictures; lookupAvailable: boolean }) {
  return (
    <div className="space-y-8">
      <CourseDetails course={course} pictures={pictures} />
      {course.modules.map((m, i) => (
        <ModuleCard
          key={m.id}
          module={m}
          first={i === 0}
          last={i === course.modules.length - 1}
          number={i + 1}
          lookupAvailable={lookupAvailable}
          courseId={course.id}
          pictures={pictures}
        />
      ))}
      <AddModule courseId={course.id} first={course.modules.length === 0} />
      {course.modules.length > 0 && <ScormExport courseId={course.id} />}
      <DeleteCourse course={course} />
    </div>
  );
}

// ------------------------------------------------------------------ course
function CourseDetails({ course, pictures }: { course: Course; pictures: Pictures }) {
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? '');
  const [requireWatch, setRequireWatch] = useState(course.require_watch);
  const { busy, msg, save } = useSave();
  const watch = useSave();
  const dirty = title !== course.title || description !== (course.description ?? '');
  useUnsavedWarning(dirty);
  return (
    <section className="space-y-3 rounded border border-gray-200 p-4">
      <h2 className="font-semibold">Course details</h2>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Description</span>
        <span className="mb-1 block text-sm text-gray-600">One or two sentences staff see at the top of the course.</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={input} />
      </label>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={requireWatch}
          disabled={watch.busy}
          onChange={async (e) => {
            // Saves straight away, like every tick box.
            const next = e.target.checked;
            if (await watch.save({ action: 'course.update', id: course.id, require_watch: next })) setRequireWatch(next);
          }}
        />
        <span>
          <span className="block text-sm font-medium">Staff must watch each video before its quiz</span>
          <span className="block text-sm text-gray-600">
            Ticked: the quiz opens once they&apos;ve watched 90% of the video. Not ticked: the video is optional and the
            quiz is open straight away. Saves as soon as you tick or untick it.
          </span>
          <Msg msg={watch.msg} />
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty}
          className={primary}
          onClick={() => save({ action: 'course.update', id: course.id, title, description })}
        >
          Save details
        </button>
        <NotSaved dirty={dirty} />
        <Msg msg={msg} dirty={dirty} />
      </div>
      <CourseCover courseId={course.id} cover={pictures.cover} fallback={pictures.fallback} />
    </section>
  );
}

function DeleteCourse({ course }: { course: Course }) {
  const router = useRouter();
  const { busy, msg, save } = useSave();
  if (course.published) return null;
  return (
    <section className="space-y-2 border-t border-gray-200 pt-4">
      <button
        type="button"
        disabled={busy}
        className="text-sm text-red-700 underline"
        onClick={async () => {
          if (!confirm(`Delete "${course.title}" and everything in it? This can't be undone.`)) return;
          if (await save({ action: 'course.delete', id: course.id })) router.push('/build');
        }}
      >
        Delete this draft course
      </button>
      <Msg msg={msg} />
    </section>
  );
}

// ------------------------------------------------------------------ modules
function AddModule({ courseId, first }: { courseId: string; first: boolean }) {
  const [title, setTitle] = useState('');
  const { busy, msg, setMsg, save } = useSave();
  return (
    <section className="space-y-2 rounded border border-dashed border-gray-300 p-4">
      <h2 className="font-semibold">{first ? 'Add the first module' : 'Add another module'}</h2>
      <p className="text-sm text-gray-600">
        A module is a group of lessons. The week-later re-test is set per module, so keep each one to a
        single topic.
      </p>
      <div className="flex flex-wrap gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Module title, for example: Safe lifting"
          className={`${input} min-w-0 flex-1`}
        />
        <button
          type="button"
          disabled={busy}
          className={primary}
          onClick={async () => {
            if (!title.trim()) return setMsg({ kind: 'error', text: 'Give the module a title.' });
            if (await save({ action: 'module.create', course_id: courseId, title }, 'Module added.')) setTitle('');
          }}
        >
          Add module
        </button>
      </div>
      <Msg msg={msg} />
    </section>
  );
}

function ModuleCard({
  module,
  first,
  last,
  number,
  lookupAvailable,
  courseId,
  pictures,
}: {
  module: Module;
  first: boolean;
  last: boolean;
  number: number;
  lookupAvailable: boolean;
  courseId: string;
  pictures: Pictures;
}) {
  const [title, setTitle] = useState(module.title);
  const [intro, setIntro] = useState(module.intro ?? '');
  const moduleDirty = title !== module.title || intro !== (module.intro ?? '');
  useUnsavedWarning(moduleDirty);
  const [newLesson, setNewLesson] = useState('');
  const details = useSave();
  const lessonAdd = useSave();

  return (
    <section className="space-y-4 rounded border border-gray-300 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Module {number}</h2>
        <div className="flex gap-2">
          <button type="button" className={btn} disabled={first || details.busy} aria-label="Move module up"
            onClick={() => details.save({ action: 'module.move', id: module.id, dir: -1 }, 'Moved.')}>
            &uarr; Up
          </button>
          <button type="button" className={btn} disabled={last || details.busy} aria-label="Move module down"
            onClick={() => details.save({ action: 'module.move', id: module.id, dir: 1 }, 'Moved.')}>
            &darr; Down
          </button>
          <button type="button" className={`${btn} text-red-700`} disabled={details.busy}
            onClick={() => {
              if (confirm(`Delete the module "${module.title}" and its lessons?`)) {
                details.save({ action: 'module.delete', id: module.id }, 'Deleted.');
              }
            }}>
            Delete
          </button>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Module title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Intro text</span>
        <span className="mb-1 block text-sm text-gray-600">
          Shown above the lessons. What this module covers and why it matters, in plain words.
        </span>
        <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={details.busy || !moduleDirty} className={primary}
          onClick={() => details.save({ action: 'module.update', id: module.id, title, intro })}>
          Save module
        </button>
        <NotSaved dirty={moduleDirty} />
        <Msg msg={details.msg} dirty={moduleDirty} />
      </div>

      <div className="space-y-3">
        {module.lessons.map((l, i) => (
          <LessonCard
            key={l.id}
            lesson={l}
            number={i + 1}
            first={i === 0}
            last={i === module.lessons.length - 1}
            lookupAvailable={lookupAvailable}
            courseId={courseId}
            pictures={pictures.lessons[l.id] ?? null}
          />
        ))}
      </div>

      <div className="space-y-2 rounded bg-gray-50 p-3">
        <div className="flex flex-wrap gap-3">
          <input
            value={newLesson}
            onChange={(e) => setNewLesson(e.target.value)}
            placeholder="New lesson title, for example: The safe lift, step by step"
            className={`${input} min-w-0 flex-1`}
          />
          <button type="button" disabled={lessonAdd.busy} className={primary}
            onClick={async () => {
              if (!newLesson.trim()) return lessonAdd.setMsg({ kind: 'error', text: 'Give the lesson a title.' });
              if (await lessonAdd.save({ action: 'lesson.create', module_id: module.id, title: newLesson }, 'Lesson added.')) {
                setNewLesson('');
              }
            }}>
            Add lesson
          </button>
        </div>
        <Msg msg={lessonAdd.msg} />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ lessons
function LessonCard({
  lesson,
  number,
  first,
  last,
  lookupAvailable,
  courseId,
  pictures,
}: {
  lesson: Lesson;
  courseId: string;
  pictures: { thumbnail: string | null; frames: string[] } | null;
  number: number;
  first: boolean;
  last: boolean;
  lookupAvailable: boolean;
}) {
  const [open, setOpen] = useState(!lesson.bunny_video_id && lesson.kind !== 'scorm');
  const [title, setTitle] = useState(lesson.title);
  const [video, setVideo] = useState(lesson.bunny_video_id ?? '');
  const [duration, setDuration] = useState(formatDuration(lesson.duration_seconds));
  const [script, setScript] = useState(lesson.script ?? '');
  const s = useSave();
  const lessonDirty =
    title !== lesson.title ||
    video !== (lesson.bunny_video_id ?? '') ||
    duration !== formatDuration(lesson.duration_seconds) ||
    script !== (lesson.script ?? '');
  useUnsavedWarning(lessonDirty);
  const qCount = lesson.quiz?.questions.length ?? 0;
  const isScorm = lesson.kind === 'scorm';

  async function saveLesson() {
    const secs = parseDuration(duration);
    if (Number.isNaN(secs)) {
      s.setMsg({ kind: 'error', text: 'Write the video length like 3:45 (minutes and seconds).' });
      return;
    }
    const body: Record<string, unknown> = { action: 'lesson.update', id: lesson.id, title, script, video };
    // Leave the length out when it's blank and a video is set, so the server
    // can fill it in from Bunny.
    if (secs !== null || !video.trim()) body.duration_seconds = secs;
    const res = await s.save(body);
    if (res && typeof res.duration_seconds === 'number') setDuration(formatDuration(res.duration_seconds));
    // A pasted embed link is stored as just the video's ID; show that, so the
    // form doesn't look unsaved.
    const id = res ? video.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] : undefined;
    if (id) setVideo(id.toLowerCase());
  }

  const status = isScorm
    ? 'SCORM package'
    : [lesson.bunny_video_id || lesson.sample_video_url ? 'Video set' : 'No video yet',
       qCount ? `${qCount} question${qCount === 1 ? '' : 's'}` : 'No questions',
       ...(lesson.written_prompts.length
         ? [`${lesson.written_prompts.length} written prompt${lesson.written_prompts.length === 1 ? '' : 's'}`]
         : []),
       ...(lesson.draft ? ['change waiting for review'] : lesson.needs_review ? ['not reviewed yet'] : [])].join(', ');

  return (
    <div className="rounded border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <button type="button" className="flex min-h-11 items-center gap-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
          {pictures?.thumbnail && <Picture src={pictures.thumbnail} className="hidden w-20 shrink-0 sm:block" />}
          <span>
          <span className="font-medium underline">
            Lesson {number}: {lesson.title}
          </span>
          <span className="block text-sm text-gray-600">{status}</span>
          </span>
        </button>
        <div className="flex gap-2">
          <button type="button" className={btn} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Close' : isScorm ? 'Open' : 'Edit video and questions'}
          </button>
          <button type="button" className={btn} disabled={first || s.busy} aria-label="Move lesson up"
            onClick={() => s.save({ action: 'lesson.move', id: lesson.id, dir: -1 }, 'Moved.')}>
            &uarr;
          </button>
          <button type="button" className={btn} disabled={last || s.busy} aria-label="Move lesson down"
            onClick={() => s.save({ action: 'lesson.move', id: lesson.id, dir: 1 }, 'Moved.')}>
            &darr;
          </button>
          <button type="button" className={`${btn} text-red-700`} disabled={s.busy}
            onClick={() => {
              if (confirm(`Delete the lesson "${lesson.title}"?`)) s.save({ action: 'lesson.delete', id: lesson.id }, 'Deleted.');
            }}>
            Delete
          </button>
        </div>
      </div>
      {!open && <div className="px-3 pb-3"><Msg msg={s.msg} /></div>}

      {open && isScorm && (
        <p className="border-t border-gray-200 p-3 text-sm text-gray-600">
          This lesson is a SCORM package. Change it by importing a new package on the Import SCORM page.
        </p>
      )}

      {open && !isScorm && (
        <div className="space-y-4 border-t border-gray-200 p-3">
          {lesson.draft && (
            <p role="status" className="rounded bg-amber-50 p-3 text-sm text-amber-800">
              A change to this lesson&apos;s questions is waiting for review{lesson.draft.note ? ` (${lesson.draft.note})` : ''}.
              Staff still see the version below until someone approves the change on the{' '}
              <a href={`/build/${courseId}/check#lesson-${lesson.id}`} className="font-medium underline">
                Check page
              </a>
              .
            </p>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Lesson title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Bunny video link</span>
            <span className="mb-1 block text-sm text-gray-600">
              In Bunny Stream, open the video and copy its embed link or video ID, then paste it here.
            </span>
            <input
              value={video}
              onChange={(e) => setVideo(e.target.value)}
              placeholder="https://iframe.mediadelivery.net/embed/123456/…"
              className={`${input} font-mono text-sm`}
            />
          </label>

          <label className="block max-w-xs">
            <span className="mb-1 block text-sm font-medium">Video length</span>
            <span className="mb-1 block text-sm text-gray-600">
              {lookupAvailable ? 'Leave blank to fill it in from Bunny.' : 'Minutes and seconds, like 3:45.'}
            </span>
            <input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="3:45" className={input} />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Notes under the video (optional)</span>
            <span className="mb-1 block text-sm text-gray-600">
              The script or key points. Staff can read along. Each line becomes a paragraph.
            </span>
            <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={4} className={input} />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={s.busy || !lessonDirty} className={primary} onClick={saveLesson}>
              {s.busy ? 'Saving…' : 'Save lesson'}
            </button>
            <NotSaved dirty={lessonDirty} />
            <Msg msg={s.msg} dirty={lessonDirty} />
          </div>

          <LessonThumbnail
            lessonId={lesson.id}
            hasVideo={Boolean(lesson.bunny_video_id)}
            current={pictures?.thumbnail ?? null}
            frames={pictures?.frames ?? []}
          />

          <BeforeVideo key={`exp-${lesson.expectancy ?? ''}`} lesson={lesson} />

          <Questions lesson={lesson} />

          <Written lesson={lesson} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ questions
function Questions({ lesson }: { lesson: Lesson }) {
  // On a live course, edits go to the change waiting for review, so keep
  // building on that version rather than the one staff see.
  const editingDraft = Boolean(lesson.draft?.questions);
  const current = (editingDraft ? lesson.draft!.questions : lesson.quiz?.questions) ?? [];
  const [passMark, setPassMark] = useState(lesson.quiz?.pass_mark ?? 0.8);
  const [pending, setPending] = useState<{ questions: QuizQuestion[]; errors: string[]; file: string } | null>(null);
  const [imported, setImported] = useState<{ value: LessonImport | null; errors: string[]; file: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const s = useSave();
  const slug = lesson.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lesson';

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) await readCsv(f);
  }

  async function readCsv(f: File) {
    s.setMsg(null);
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setPending({ questions: [], errors: ['Save the spreadsheet as CSV first (File, Save as, CSV), then upload that file.'], file: f.name });
      return;
    }
    if (f.size > 512 * 1024) {
      setPending({ questions: [], errors: ['That file is too big for a question list. Check it is the right file.'], file: f.name });
      return;
    }
    const parsed = parseQuestionsCsv(await f.text(), current);
    setPending({ ...parsed, file: f.name });
  }

  async function onJson(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) await readJson(f);
  }

  async function readJson(f: File) {
    s.setMsg(null);
    setPending(null);
    if (f.size > 1024 * 1024) {
      setImported({ value: null, errors: ['That file is too big for a lesson. Check it is the right file.'], file: f.name });
      return;
    }
    setImported({ ...parseLessonImport(await f.text()), file: f.name });
  }

  // Drop a file anywhere on the panel: a .json goes to the question maker
  // import, anything else to the CSV upload (which explains what it wants).
  function onDragOver(e: React.DragEvent) {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (/\.json$/i.test(f.name) || f.type === 'application/json') await readJson(f);
    else await readCsv(f);
  }

  if (imported) {
    return (
      <ImportPreview
        lesson={lesson}
        imported={imported}
        passMark={passMark}
        setPassMark={setPassMark}
        onDone={() => setImported(null)}
      />
    );
  }

  const shown = pending && pending.errors.length === 0 ? pending.questions : current;

  return (
    <div
      className={`space-y-3 rounded bg-gray-50 p-3 ${dragging ? 'ring-2 ring-brand' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div>
        <h3 className="font-medium">Questions</h3>
        <p className="text-sm text-gray-600">
          Staff answer these straight after the video. The same questions make up the re-test a few days
          later. Download the template, fill it in in Excel or Google Sheets, save it as CSV and upload it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => download('questions-template.csv', templateCsv())}>
          Download template
        </button>
        <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
          Upload questions (CSV)
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} aria-label="Questions CSV file" />
        <button type="button" className={btn} onClick={() => jsonRef.current?.click()}>
          Import from question maker (JSON)
        </button>
        <input ref={jsonRef} type="file" accept=".json,application/json" className="sr-only" onChange={onJson} aria-label="Lesson file from the question maker" />
        {current.length > 0 && (
          <button type="button" className={btn} onClick={() => download(`${slug}-questions.csv`, questionsToCsv(current))}>
            Download these questions
          </button>
        )}
      </div>

      <div
        className={`rounded border-2 border-dashed px-3 py-4 text-center text-sm ${
          dragging ? 'border-brand bg-brand-soft text-gray-900' : 'border-gray-300 text-gray-600'
        }`}
      >
        {dragging ? 'Drop it to read it. Nothing saves until you check it.' : 'Or drop the question maker file (.json) or a questions CSV here.'}
      </div>

      {pending && pending.errors.length > 0 && (
        <div role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">Nothing was saved. Fix these in {pending.file} and upload it again:</p>
          <ul className="mt-1 list-disc pl-5">
            {pending.errors.map((er) => (
              <li key={er}>{er}</li>
            ))}
          </ul>
        </div>
      )}

      {pending && pending.errors.length === 0 && (
        <p role="status" className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          {pending.questions.length} question{pending.questions.length === 1 ? '' : 's'} read from {pending.file}. Check
          them below, then save. {current.length > 0 && 'This replaces the questions already on this lesson.'}
        </p>
      )}

      {!pending ? (
        <QuestionList
          questions={current}
          editingDraft={editingDraft}
          busy={s.busy}
          onSave={async (questions, okText) =>
            Boolean(await s.save({ action: 'quiz.set', lesson_id: lesson.id, questions, pass_mark: passMark }, okText))
          }
        />
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-600">No questions yet. Without them this lesson is watch only.</p>
      ) : (
        <ol className="space-y-3">
          {shown.map((q, i) => (
            <li key={q.id} className="rounded border border-gray-200 bg-surface p-3 text-sm">
              <p className="font-medium">
                {i + 1}. {q.text}
              </p>
              <ul className="mt-1 space-y-0.5">
                {q.options.map((o, j) => (
                  <li key={j} className={j === q.correct_index ? 'font-medium text-green-800' : 'text-gray-700'}>
                    {ANSWER_LETTERS[j]}. {o} {j === q.correct_index && '(correct)'}
                  </li>
                ))}
              </ul>
              {q.explanation && <p className="mt-1 text-gray-600">Why: {q.explanation}</p>}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Pass mark</span>
          <select
            value={passMark}
            disabled={s.busy}
            onChange={async (e) => {
              const next = Number(e.target.value);
              setPassMark(next);
              // With questions already saved, a new pass mark saves straight
              // away. With an upload waiting, it goes with "Save these questions".
              if (!pending && current.length > 0) {
                const ok = await s.save({ action: 'quiz.set', lesson_id: lesson.id, questions: current, pass_mark: next }, 'Pass mark saved.');
                if (!ok) setPassMark(lesson.quiz?.pass_mark ?? next);
              }
            }}
            className={input}
          >
            {[0.6, 0.7, 0.8, 0.9, 1].map((p) => (
              <option key={p} value={p}>
                {Math.round(p * 100)}%
              </option>
            ))}
          </select>
        </label>
        {pending && pending.errors.length === 0 && (
          <>
            <button type="button" disabled={s.busy} className={primary}
              onClick={async () => {
                if (await s.save({ action: 'quiz.set', lesson_id: lesson.id, questions: pending.questions, pass_mark: passMark }, 'Questions saved.')) {
                  setPending(null);
                }
              }}>
              Save these questions
            </button>
            <button type="button" className={btn} onClick={() => setPending(null)}>
              Cancel
            </button>
          </>
        )}
        {!pending && current.length > 0 && (
          <>
            <button type="button" disabled={s.busy} className={`${btn} text-red-700`}
              onClick={() => {
                if (confirm('Remove all questions from this lesson?')) {
                  s.save({ action: 'quiz.set', lesson_id: lesson.id, questions: [], pass_mark: passMark }, 'Questions removed.');
                }
              }}>
              Remove all questions
            </button>
          </>
        )}
      </div>
      <Msg msg={s.msg} />
    </div>
  );
}

// ---------------------------------------------------- editing questions
function newQuestionId(used: QuizQuestion[]): string {
  const ids = new Set(used.map((q) => q.id));
  let id: string;
  do {
    id = 'q-' + Math.random().toString(36).slice(2, 10);
  } while (ids.has(id));
  return id;
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// The lesson's questions, each with Edit, Move up, Move down and Delete, and
// an "Add a question" form at the end. Every change saves straight away.
function QuestionList({
  questions,
  editingDraft,
  busy,
  onSave,
}: {
  questions: QuizQuestion[];
  editingDraft: boolean;
  busy: boolean;
  onSave: (questions: QuizQuestion[], okText: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const atMax = questions.length >= MAX_QUESTIONS;

  async function saveOne(q: QuizQuestion) {
    const next = editing === 'new' ? [...questions, q] : questions.map((x, i) => (i === editing ? q : x));
    if (await onSave(next, editing === 'new' ? 'Question added.' : 'Question saved.')) setEditing(null);
  }

  return (
    <div className="space-y-3">
      {editingDraft && (
        <p className="text-sm text-amber-800">Showing the version waiting for review. Changes here add to it.</p>
      )}
      {questions.length === 0 && editing !== 'new' && (
        <p className="text-sm text-gray-600">No questions yet. Without them this lesson is watch only.</p>
      )}
      {questions.length > 0 && (
        <ol className="space-y-3">
          {questions.map((q, i) =>
            editing === i ? (
              <li key={q.id}>
                <QuestionForm number={i + 1} initial={q} busy={busy} onSave={saveOne} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={q.id} className="rounded border border-gray-200 bg-surface p-3 text-sm">
                <p className="font-medium">
                  {i + 1}. {q.text}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {q.options.map((o, j) => (
                    <li key={j} className={j === q.correct_index ? 'font-medium text-green-800' : 'text-gray-700'}>
                      {ANSWER_LETTERS[j]}. {o} {j === q.correct_index && '(correct)'}
                    </li>
                  ))}
                </ul>
                {q.explanation && <p className="mt-1 text-gray-600">Why: {q.explanation}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={btn} disabled={busy || editing !== null} onClick={() => setEditing(i)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={busy || editing !== null || i === 0}
                    aria-label={`Move question ${i + 1} up`}
                    onClick={() => onSave(move(questions, i, i - 1), 'Order saved.')}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className={btn}
                    disabled={busy || editing !== null || i === questions.length - 1}
                    aria-label={`Move question ${i + 1} down`}
                    onClick={() => onSave(move(questions, i, i + 1), 'Order saved.')}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className={`${btn} text-red-700`}
                    disabled={busy || editing !== null}
                    onClick={() => {
                      if (confirm(`Delete question ${i + 1}?`)) {
                        onSave(questions.filter((_, k) => k !== i), 'Question deleted.');
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          )}
        </ol>
      )}
      {editing === 'new' ? (
        <QuestionForm
          number={questions.length + 1}
          initial={{ id: newQuestionId(questions), text: '', options: ['', '', ''], correct_index: 0, explanation: '' }}
          busy={busy}
          onSave={saveOne}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" className={btn} disabled={busy || editing !== null || atMax} onClick={() => setEditing('new')}>
          {atMax ? `${MAX_QUESTIONS} questions is the most for one lesson` : '+ Add a question'}
        </button>
      )}
    </div>
  );
}

function QuestionForm({
  number,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  number: number;
  initial: QuizQuestion;
  busy: boolean;
  onSave: (q: QuizQuestion) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial.text);
  const [options, setOptions] = useState<string[]>(initial.options);
  const [correct, setCorrect] = useState(initial.correct_index);
  const [explanation, setExplanation] = useState(initial.explanation ?? '');
  const [error, setError] = useState('');
  const group = `correct-${initial.id}`;
  const dirty =
    text !== initial.text ||
    correct !== initial.correct_index ||
    explanation !== (initial.explanation ?? '') ||
    JSON.stringify(options) !== JSON.stringify(initial.options);
  useUnsavedWarning(dirty);

  function moveOption(from: number, to: number) {
    setOptions((o) => move(o, from, to));
    // The correct answer travels with its text.
    setCorrect((c) => (c === from ? to : c === to ? from : c));
  }

  function removeOption(i: number) {
    setOptions((o) => o.filter((_, k) => k !== i));
    setCorrect((c) => (c === i ? 0 : c > i ? c - 1 : c));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = options.map((o) => o.trim());
    if (!text.trim()) return setError('Write the question.');
    if (cleaned.some((o) => !o)) return setError('Fill in every answer, or remove the empty ones.');
    if (new Set(cleaned.map((o) => o.toLowerCase())).size !== cleaned.length) return setError('Two answers are the same.');
    setError('');
    onSave({
      id: initial.id,
      text: text.trim(),
      options: cleaned,
      correct_index: correct,
      ...(explanation.trim() ? { explanation: explanation.trim() } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-brand bg-surface p-3 text-sm">
      <p className="font-medium">{initial.text ? `Edit question ${number}` : `New question ${number}`}</p>
      <label className="block">
        <span className="mb-1 block font-medium">Question</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500} className={input} autoFocus />
      </label>

      <fieldset className="space-y-2">
        <legend className="mb-1 font-medium">Answers (tick the correct one)</legend>
        {options.map((o, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="radio"
              name={group}
              checked={correct === i}
              onChange={() => setCorrect(i)}
              aria-label={`Answer ${ANSWER_LETTERS[i]} is correct`}
              className="h-5 w-5"
            />
            <span className="w-5 font-medium">{ANSWER_LETTERS[i]}.</span>
            <input
              value={o}
              onChange={(e) => setOptions((all) => all.map((x, k) => (k === i ? e.target.value : x)))}
              maxLength={500}
              aria-label={`Answer ${ANSWER_LETTERS[i]}`}
              className={`${input} min-w-0 flex-1`}
            />
            <span className="flex gap-1">
              <button
                type="button"
                className={btn}
                disabled={i === 0}
                onClick={() => moveOption(i, i - 1)}
                aria-label={`Move answer ${ANSWER_LETTERS[i]} up`}
              >
                Up
              </button>
              <button
                type="button"
                className={btn}
                disabled={i === options.length - 1}
                onClick={() => moveOption(i, i + 1)}
                aria-label={`Move answer ${ANSWER_LETTERS[i]} down`}
              >
                Down
              </button>
              <button
                type="button"
                className={`${btn} text-red-700`}
                disabled={options.length <= 2}
                onClick={() => removeOption(i)}
                aria-label={`Remove answer ${ANSWER_LETTERS[i]}`}
              >
                Remove
              </button>
            </span>
          </div>
        ))}
        {options.length < ANSWER_LETTERS.length && (
          <button type="button" className={btn} onClick={() => setOptions((o) => [...o, ''])}>
            + Add an answer
          </button>
        )}
      </fieldset>

      <label className="block">
        <span className="mb-1 block font-medium">Why (optional)</span>
        <span className="mb-1 block text-gray-600">Shown after they answer, right or wrong.</span>
        <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} maxLength={500} className={input} />
      </label>

      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primary}>
          {busy ? 'Saving...' : 'Save question'}
        </button>
        <button type="button" className={btn} onClick={onCancel}>
          Cancel
        </button>
        <NotSaved dirty={dirty} />
      </div>
    </form>
  );
}

// ---------------------------------------------------- before the video
function BeforeVideo({ lesson }: { lesson: Lesson }) {
  const [text, setText] = useState(lesson.expectancy ?? '');
  const s = useSave();
  const dirty = text !== (lesson.expectancy ?? '');
  useUnsavedWarning(dirty);
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Before the video (optional)</span>
        <span className="mb-1 block text-sm text-gray-600">
          One sentence shown above the video, telling staff what they&apos;ll have to explain afterwards.
          Told first, it changes how they watch. The question maker writes one for you.
        </span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000} className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} disabled={s.busy || text === (lesson.expectancy ?? '')}
          onClick={() => s.save({ action: 'lesson.update', id: lesson.id, expectancy: text }, 'Saved.')}>
          Save sentence
        </button>
        <NotSaved dirty={dirty} />
        <Msg msg={s.msg} dirty={dirty} />
      </div>
    </div>
  );
}

// ---------------------------------------------------- written prompts
function Written({ lesson }: { lesson: Lesson }) {
  const s = useSave();
  if (lesson.written_prompts.length === 0) return null;
  return (
    <div className="space-y-3 rounded bg-gray-50 p-3">
      <div>
        <h3 className="font-medium">Explain it in your own words</h3>
        <p className="text-sm text-gray-600">
          Not marked. Staff write an answer after the video, then see the model answer. They can&apos;t change
          their answer after that. These come in with a question maker import.
        </p>
      </div>
      <ol className="space-y-3">
        {lesson.written_prompts.map((p, i) => (
          <li key={p.id} className="rounded border border-gray-200 bg-surface p-3 text-sm">
            <p className="font-medium">
              {i + 1}. {p.prompt}
              {p.max_words ? <span className="font-normal text-gray-600"> (up to {p.max_words} words)</span> : null}
            </p>
            {p.model_answer && <p className="mt-1 text-gray-600">Model answer: {p.model_answer}</p>}
            <SendToManager lessonId={lesson.id} promptId={p.id} on={Boolean(p.send_to_manager)} />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={s.busy} className={`${btn} text-red-700`}
          onClick={() => {
            if (confirm('Remove the written prompts from this lesson? What staff already wrote is kept.')) {
              s.save({ action: 'written.set', lesson_id: lesson.id, written_prompts: [] }, 'Written prompts removed.');
            }
          }}>
          Remove written prompts
        </button>
        <Msg msg={s.msg} />
      </div>
    </div>
  );
}

// ---------------------------------------------------- question maker import
function ImportPreview({
  lesson,
  imported,
  passMark,
  setPassMark,
  onDone,
}: {
  lesson: Lesson;
  imported: { value: LessonImport | null; errors: string[]; file: string };
  passMark: number;
  setPassMark: (n: number) => void;
  onDone: () => void;
}) {
  const s = useSave();
  const v = imported.value;
  const replacing = (lesson.quiz?.questions.length ?? 0) > 0 || lesson.written_prompts.length > 0 || Boolean(lesson.expectancy);

  return (
    <div className="space-y-3 rounded bg-gray-50 p-3">
      <h3 className="font-medium">Import from the question maker</h3>

      {!v ? (
        <div role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">Nothing was saved. {imported.file} couldn&apos;t be read:</p>
          <ul className="mt-1 list-disc pl-5">
            {imported.errors.map((er) => (
              <li key={er}>{er}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p role="status" className="rounded bg-amber-50 p-3 text-sm text-amber-800">
            {v.source.set_title ? <>From &ldquo;{v.source.set_title}&rdquo;{v.source.client ? ` (${v.source.client})` : ''}. </> : null}
            {v.questions.length} question{v.questions.length === 1 ? '' : 's'}, {v.written_prompts.length} written prompt
            {v.written_prompts.length === 1 ? '' : 's'}. Check them below, then save.
            {replacing && ' This replaces the questions, written prompts and before-video sentence already on this lesson.'}
            {v.source.includes_drafts && ' This file includes questions nobody has approved yet.'}
          </p>

          {v.idea && (
            <p className="text-sm">
              <span className="font-medium">The idea these test:</span> {v.idea}
            </p>
          )}
          {v.expectancy && (
            <p className="text-sm">
              <span className="font-medium">Before the video:</span> {v.expectancy}
            </p>
          )}

          {v.questions.length > 0 && (
            <ol className="space-y-3">
              {v.questions.map((q, i) => (
                <li key={q.id} className="rounded border border-gray-200 bg-surface p-3 text-sm">
                  <p className="font-medium">
                    {i + 1}. {q.text}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {q.options.map((o, j) => (
                      <li key={j} className={j === q.correct_index ? 'font-medium text-green-800' : 'text-gray-700'}>
                        {ANSWER_LETTERS[j]}. {o} {j === q.correct_index && '(correct)'}
                      </li>
                    ))}
                  </ul>
                  {q.explanation && <p className="mt-1 text-gray-600">Why: {q.explanation}</p>}
                </li>
              ))}
            </ol>
          )}

          {v.written_prompts.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Explain it in your own words (not marked)</p>
              <ol className="space-y-2">
                {v.written_prompts.map((p) => (
                  <li key={p.id} className="rounded border border-gray-200 bg-surface p-3 text-sm">
                    <p className="font-medium">{p.prompt}</p>
                    {p.model_answer && <p className="mt-1 text-gray-600">Model answer: {p.model_answer}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {v.skipped.length > 0 && (
            <div className="text-sm text-gray-600">
              <p className="font-medium">Left out ({v.skipped.length}):</p>
              <ul className="mt-1 list-disc pl-5">
                {v.skipped.map((k) => (
                  <li key={k.id}>
                    {k.stem ? `${k.stem.slice(0, 80)}${k.stem.length > 80 ? '…' : ''}: ` : ''}
                    {k.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Pass mark</span>
              <select value={passMark} onChange={(e) => setPassMark(Number(e.target.value))} className={input}>
                {[0.6, 0.7, 0.8, 0.9, 1].map((pm) => (
                  <option key={pm} value={pm}>
                    {Math.round(pm * 100)}%
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={s.busy} className={primary}
              onClick={async () => {
                const res = await s.save(
                  {
                    action: 'lesson.import',
                    lesson_id: lesson.id,
                    questions: v.questions,
                    written_prompts: v.written_prompts,
                    expectancy: v.expectancy,
                    pass_mark: passMark,
                    note: v.source.set_title
                      ? `Imported from the question maker: ${v.source.set_title}`.slice(0, 500)
                      : 'Imported from the question maker',
                  },
                  'Imported. Tick it off on the Check page once you have read it.'
                );
                if (res) onDone();
              }}>
              {s.busy ? 'Saving…' : 'Save this lesson'}
            </button>
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btn} onClick={onDone}>
          {v ? 'Cancel' : 'Close'}
        </button>
        <Msg msg={s.msg} />
      </div>
    </div>
  );
}

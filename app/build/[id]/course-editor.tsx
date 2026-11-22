'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { courseApi, download, formatDuration, parseDuration } from '../api';
import {
  ANSWER_LETTERS,
  parseQuestionsCsv,
  questionsToCsv,
  templateCsv,
  type QuizQuestion,
} from '@/lib/quiz-csv';

type Lesson = {
  id: string;
  title: string;
  kind: string;
  bunny_video_id: string | null;
  sample_video_url: string | null;
  duration_seconds: number | null;
  script: string | null;
  quiz: { pass_mark: number; questions: QuizQuestion[] } | null;
};
type Module = { id: string; title: string; intro: string | null; lessons: Lesson[] };
type Course = { id: string; title: string; description: string | null; published: boolean; modules: Module[] };

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

function Msg({ msg }: { msg: { kind: 'ok' | 'error' | 'note'; text: string } | null }) {
  if (!msg) return null;
  const style =
    msg.kind === 'error' ? 'text-red-700' : msg.kind === 'note' ? 'text-amber-800' : 'text-green-800';
  return (
    <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${style}`}>
      {msg.text}
    </p>
  );
}

export function CourseEditor({ course, lookupAvailable }: { course: Course; lookupAvailable: boolean }) {
  return (
    <div className="space-y-8">
      <CourseDetails course={course} />
      {course.modules.map((m, i) => (
        <ModuleCard
          key={m.id}
          module={m}
          first={i === 0}
          last={i === course.modules.length - 1}
          number={i + 1}
          lookupAvailable={lookupAvailable}
        />
      ))}
      <AddModule courseId={course.id} first={course.modules.length === 0} />
      <DeleteCourse course={course} />
    </div>
  );
}

// ------------------------------------------------------------------ course
function CourseDetails({ course }: { course: Course }) {
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description ?? '');
  const { busy, msg, save } = useSave();
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
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          className={primary}
          onClick={() => save({ action: 'course.update', id: course.id, title, description })}
        >
          Save details
        </button>
        <Msg msg={msg} />
      </div>
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
}: {
  module: Module;
  first: boolean;
  last: boolean;
  number: number;
  lookupAvailable: boolean;
}) {
  const [title, setTitle] = useState(module.title);
  const [intro, setIntro] = useState(module.intro ?? '');
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
        <button type="button" disabled={details.busy} className={primary}
          onClick={() => details.save({ action: 'module.update', id: module.id, title, intro })}>
          Save module
        </button>
        <Msg msg={details.msg} />
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
}: {
  lesson: Lesson;
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
  }

  const status = isScorm
    ? 'SCORM package'
    : [lesson.bunny_video_id || lesson.sample_video_url ? 'Video set' : 'No video yet',
       qCount ? `${qCount} question${qCount === 1 ? '' : 's'}` : 'No questions'].join(', ');

  return (
    <div className="rounded border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <button type="button" className="min-h-11 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="font-medium underline">
            Lesson {number}: {lesson.title}
          </span>
          <span className="block text-sm text-gray-600">{status}</span>
        </button>
        <div className="flex gap-2">
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
            <button type="button" disabled={s.busy} className={primary} onClick={saveLesson}>
              {s.busy ? 'Saving…' : 'Save lesson'}
            </button>
            <Msg msg={s.msg} />
          </div>

          <Questions lesson={lesson} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ questions
function Questions({ lesson }: { lesson: Lesson }) {
  const current = lesson.quiz?.questions ?? [];
  const [passMark, setPassMark] = useState(lesson.quiz?.pass_mark ?? 0.8);
  const [pending, setPending] = useState<{ questions: QuizQuestion[]; errors: string[]; file: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useSave();
  const slug = lesson.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lesson';

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
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

  const shown = pending && pending.errors.length === 0 ? pending.questions : current;

  return (
    <div className="space-y-3 rounded bg-gray-50 p-3">
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
        {current.length > 0 && (
          <button type="button" className={btn} onClick={() => download(`${slug}-questions.csv`, questionsToCsv(current))}>
            Download these questions
          </button>
        )}
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

      {shown.length === 0 ? (
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
          <select value={passMark} onChange={(e) => setPassMark(Number(e.target.value))} className={input}>
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
            <button type="button" disabled={s.busy || passMark === lesson.quiz?.pass_mark} className={btn}
              onClick={() => s.save({ action: 'quiz.set', lesson_id: lesson.id, questions: current, pass_mark: passMark }, 'Pass mark saved.')}>
              Save pass mark
            </button>
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

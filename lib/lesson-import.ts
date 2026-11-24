// A lesson file from the question maker (QuestionForge). One question set
// becomes one lesson: the quiz, the "explain it in your own words" prompts and
// the sentence staff see before the video.
//
// The format is written by QuestionForge's "LMS lesson (JSON)" download. It is
// deliberately small: only what this LMS stores. The question maker's full
// export (evidence grades, provenance, delivery rules) stays in the question
// maker.
//
// {
//   "format": "learnforge-lesson",
//   "version": 1,
//   "source": { "app", "set_id", "set_title", "client", "exported_at", "includes_drafts" },
//   "lesson": {
//     "idea": "the idea the questions test (shown to the admin, not to staff)",
//     "expectancy": "shown above the video",
//     "questions": [{ "id", "text", "options": [2..6], "correct_index", "explanation" }],
//     "written_prompts": [{ "id", "prompt", "model_answer", "max_words" }]
//   },
//   "skipped": [{ "id", "type", "stem", "reason" }]
// }
//
// Shared by the browser (instant preview) and the API route (the check that
// counts). The database refuses anything malformed regardless.

import { MAX_QUESTIONS, questionsProblem, type QuizQuestion } from './quiz-csv';

export const LESSON_IMPORT_FORMAT = 'learnforge-lesson';
export const LESSON_IMPORT_VERSION = 1;
export const MAX_WRITTEN_PROMPTS = 5;

export type WrittenPrompt = {
  id: string;
  prompt: string;
  model_answer: string | null;
  max_words: number | null;
  /** Answers go to the person's nearest manager in Messages (set on the Check page). */
  send_to_manager?: boolean;
};

export type LessonImport = {
  source: {
    app: string;
    set_id: string | null;
    set_title: string | null;
    client: string | null;
    exported_at: string | null;
    includes_drafts: boolean;
  };
  idea: string | null;
  expectancy: string | null;
  questions: QuizQuestion[];
  written_prompts: WrittenPrompt[];
  skipped: { id: string; type: string; stem: string; reason: string }[];
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

// Server-side recheck of prompts sent from the browser. Mirrors the
// written_prompts table checks.
export function writtenPromptsProblem(prompts: unknown): string | null {
  if (!Array.isArray(prompts)) return 'Written prompts must be a list.';
  if (prompts.length > MAX_WRITTEN_PROMPTS) return `Keep it to ${MAX_WRITTEN_PROMPTS} written prompts or fewer.`;
  const ids = new Set<string>();
  for (const [i, p] of prompts.entries()) {
    const n = i + 1;
    if (!p || typeof p !== 'object') return `Written prompt ${n} is not valid.`;
    const { id, prompt, model_answer, max_words } = p as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim() || id.length > 100 || ids.has(id)) {
      return `Written prompt ${n} has a missing or repeated id.`;
    }
    ids.add(id);
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1000) {
      return `Written prompt ${n} needs a prompt under 1,000 characters.`;
    }
    if (model_answer !== null && model_answer !== undefined && (typeof model_answer !== 'string' || model_answer.length > 2000)) {
      return `Written prompt ${n} has a model answer that is too long or not text.`;
    }
    if (max_words !== null && max_words !== undefined && (!Number.isInteger(max_words) || (max_words as number) < 5 || (max_words as number) > 300)) {
      return `Written prompt ${n} has a word limit outside 5 to 300.`;
    }
  }
  return null;
}

export function parseLessonImport(input: string): { value: LessonImport | null; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(input.replace(/^﻿/, ''));
  } catch {
    return { value: null, errors: ["That file isn't valid JSON. Download it again from the question maker."] };
  }
  if (!raw || typeof raw !== 'object') return { value: null, errors: ['That file is empty.'] };
  const r = raw as Record<string, unknown>;

  if (r.format !== LESSON_IMPORT_FORMAT) {
    const hint =
      r.generated_by === 'STRIKE' || r.schema_version
        ? " That's the question maker's full export. Use its \"LMS lesson (JSON)\" download instead."
        : '';
    return { value: null, errors: [`This isn't a lesson file from the question maker.${hint}`] };
  }
  if (r.version !== LESSON_IMPORT_VERSION) {
    return { value: null, errors: [`This file is version ${String(r.version)}; this site reads version ${LESSON_IMPORT_VERSION}.`] };
  }

  const lesson = (r.lesson ?? {}) as Record<string, unknown>;
  const src = (r.source ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  const questions = Array.isArray(lesson.questions) ? (lesson.questions as QuizQuestion[]) : [];
  const qProblem = questionsProblem(questions);
  if (qProblem) errors.push(qProblem);

  const prompts: WrittenPrompt[] = (Array.isArray(lesson.written_prompts) ? lesson.written_prompts : []).map(
    (p: Record<string, unknown>) => ({
      id: typeof p?.id === 'string' ? p.id : '',
      prompt: typeof p?.prompt === 'string' ? p.prompt.trim() : '',
      model_answer: text(p?.model_answer, 2000),
      max_words: Number.isInteger(p?.max_words) ? (p.max_words as number) : null,
    })
  );
  const pProblem = writtenPromptsProblem(prompts);
  if (pProblem) errors.push(pProblem);

  const expectancy = text(lesson.expectancy, 1000);
  if (questions.length === 0 && prompts.length === 0) {
    errors.push('There are no questions or written prompts in this file. Approve some in the question maker first.');
  }

  const skipped = (Array.isArray(r.skipped) ? r.skipped : []).map((s: Record<string, unknown>) => ({
    id: String(s?.id ?? ''),
    type: String(s?.type ?? ''),
    stem: String(s?.stem ?? ''),
    reason: String(s?.reason ?? ''),
  }));

  const value: LessonImport = {
    source: {
      app: String(src.app ?? 'QuestionForge'),
      set_id: text(src.set_id, 100),
      set_title: text(src.set_title, 300),
      client: text(src.client, 200),
      exported_at: text(src.exported_at, 40),
      includes_drafts: src.includes_drafts === true,
    },
    idea: text(lesson.idea, 1000),
    expectancy,
    questions: questions.slice(0, MAX_QUESTIONS),
    written_prompts: prompts,
    skipped,
  };
  return { value: errors.length ? null : value, errors };
}

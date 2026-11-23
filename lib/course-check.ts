// "Check this course" rules. Pure, so the check page, the publish action and
// the unit tests all use the same list. Errors block publishing; warnings are
// things staff would notice but that might be on purpose.

import type { QuizQuestion } from './quiz-csv';

export type CheckLesson = {
  id: string;
  title: string;
  kind: string; // 'video' | 'scorm'
  bunny_video_id: string | null;
  sample_video_url: string | null;
  duration_seconds: number | null;
  quiz: { pass_mark: number; questions: QuizQuestion[] } | null;
  // Set by the course tree. True when the lesson has questions, written
  // prompts or a before-video sentence nobody has ticked as reviewed.
  needs_review?: boolean;
  // A change to a live lesson's questions, waiting for review.
  has_draft?: boolean;
};

export type CheckModule = {
  id: string;
  title: string;
  intro: string | null;
  lessons: CheckLesson[];
};

export type CheckCourse = {
  title: string;
  description: string | null;
  modules: CheckModule[];
};

export type Issue = {
  level: 'error' | 'warning';
  where: string;
  message: string;
  lessonId?: string;
};

export function checkCourse(course: CheckCourse, opts: { bunnyReady: boolean }): Issue[] {
  const issues: Issue[] = [];
  const err = (where: string, message: string, lessonId?: string) =>
    issues.push({ level: 'error', where, message, lessonId });
  const warn = (where: string, message: string, lessonId?: string) =>
    issues.push({ level: 'warning', where, message, lessonId });

  if (!course.title.trim()) err('Course', 'Give the course a title.');
  if (!course.description?.trim()) warn('Course', 'No description. Staff see it at the top of the course.');
  if (course.modules.length === 0) err('Course', 'Add at least one module with a lesson in it.');

  for (const m of course.modules) {
    const mWhere = `Module: ${m.title || 'untitled'}`;
    if (!m.title.trim()) err(mWhere, 'Give the module a title.');
    if (!m.intro?.trim()) warn(mWhere, 'No intro text. A line or two on why this matters helps staff.');
    if (m.lessons.length === 0) {
      err(mWhere, 'This module has no lessons.');
      continue;
    }

    const videoLessons = m.lessons.filter((l) => l.kind !== 'scorm');
    if (videoLessons.length && videoLessons.every((l) => !l.quiz?.questions.length)) {
      warn(mWhere, 'No questions in any lesson, so this module has no quick check and no re-test.');
    }

    for (const l of m.lessons) {
      const where = `Lesson: ${l.title || 'untitled'}`;
      if (!l.title.trim()) err(where, 'Give the lesson a title.', l.id);
      if (l.kind === 'scorm') continue;

      if (!l.bunny_video_id && !l.sample_video_url) {
        err(where, 'No video yet. Paste the Bunny video link.', l.id);
      } else if (l.bunny_video_id && !opts.bunnyReady) {
        err(where, "Bunny isn't connected on this site yet, so staff would see no video.", l.id);
      }
      if (!l.duration_seconds) {
        warn(where, 'No video length, so the course page can\'t show how long it takes.', l.id);
      }

      if (l.needs_review) {
        err(where, "Questions not reviewed yet. Read them below and tick \u201cI've reviewed this lesson\u201d.", l.id);
      }
      if (l.has_draft) {
        warn(where, 'A change to the questions is waiting for review. Staff still see the current version.', l.id);
      }

      const qs = l.quiz?.questions ?? [];
      if (qs.length === 0) {
        warn(where, 'No questions. Staff watch it and move on, and it is left out of the re-test.', l.id);
      } else {
        const needed = Math.ceil((l.quiz!.pass_mark ?? 0.8) * qs.length - 1e-9);
        if (qs.length < 3 && needed === qs.length) {
          warn(
            where,
            `Only ${qs.length} question${qs.length === 1 ? '' : 's'}, so staff must get every one right to pass.`,
            l.id
          );
        }
      }
    }
  }
  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

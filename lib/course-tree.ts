import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckCourse } from './course-check';
import type { QuizQuestion } from './quiz-csv';
import type { WrittenPrompt } from './lesson-import';

export type LessonDraft = {
  pass_mark: number;
  questions: QuizQuestion[];
  written_prompts: WrittenPrompt[];
  expectancy: string | null;
  note: string | null;
  created_at: string;
};

export type TreeLesson = CheckCourse['modules'][number]['lessons'][number] & {
  sort_order: number;
  script: string | null;
  expectancy: string | null;
  written_prompts: WrittenPrompt[];
  reviewed_at: string | null;
  needs_review: boolean;
  draft: LessonDraft | null;
};
export type TreeModule = Omit<CheckCourse['modules'][number], 'lessons'> & {
  sort_order: number;
  lessons: TreeLesson[];
};
export type CourseTree = {
  id: string;
  title: string;
  description: string | null;
  require_watch: boolean;
  published: boolean;
  modules: TreeModule[];
};

// The whole course for the builder and the check page, read with the admin's
// own session (quizzes are admin-only under RLS, so this only works for admins).
export async function loadCourseTree(supabase: SupabaseClient, id: string): Promise<CourseTree | null> {
  const { data } = await supabase
    .from('courses')
    .select(
      'id, title, description, published, require_watch, modules(id, title, intro, sort_order, lessons(id, title, kind, sort_order, bunny_video_id, sample_video_url, duration_seconds, script, expectancy, reviewed_at, quizzes(pass_mark, questions), written_prompts(id, prompt, model_answer, max_words, sort_order), lesson_drafts(pass_mark, questions, written_prompts, expectancy, note, created_at)))'
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;

  type RawLesson = Omit<TreeLesson, 'quiz' | 'written_prompts' | 'needs_review' | 'draft' | 'has_draft'> & {
    quizzes: { pass_mark: number; questions: QuizQuestion[] } | { pass_mark: number; questions: QuizQuestion[] }[] | null;
    written_prompts: (WrittenPrompt & { sort_order: number })[] | null;
    lesson_drafts: LessonDraft | LessonDraft[] | null;
  };
  type RawModule = Omit<TreeModule, 'lessons'> & { lessons: RawLesson[] | null };

  const modules = ((data.modules as RawModule[] | null) ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((m) => ({
      ...m,
      lessons: (m.lessons ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(({ quizzes, written_prompts, lesson_drafts, ...l }) => {
          // quizzes is one-to-one (unique lesson_id), so PostgREST may return
          // an object or a one-item array depending on how it reads the FK.
          const quiz = Array.isArray(quizzes) ? (quizzes[0] ?? null) : quizzes;
          const draft = Array.isArray(lesson_drafts) ? (lesson_drafts[0] ?? null) : lesson_drafts;
          const hasContent =
            l.kind !== 'scorm' &&
            Boolean(quiz?.questions?.length || written_prompts?.length || l.expectancy?.trim());
          return {
            ...l,
            quiz: quiz ? { pass_mark: Number(quiz.pass_mark), questions: quiz.questions ?? [] } : null,
            expectancy: l.expectancy ?? null,
            written_prompts: (written_prompts ?? [])
              .sort((a, b) => a.sort_order - b.sort_order)
              .map(({ id, prompt, model_answer, max_words }) => ({ id, prompt, model_answer, max_words })),
            reviewed_at: l.reviewed_at ?? null,
            needs_review: hasContent && !l.reviewed_at,
            draft: draft ? { ...draft, pass_mark: Number(draft.pass_mark) } : null,
            has_draft: Boolean(draft),
          };
        }),
    }));

  return {
    id: data.id as string,
    title: data.title as string,
    description: (data.description as string | null) ?? null,
    require_watch: (data.require_watch as boolean | null) !== false,
    published: Boolean(data.published),
    modules,
  };
}

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckCourse } from './course-check';
import type { QuizQuestion } from './quiz-csv';

export type TreeLesson = CheckCourse['modules'][number]['lessons'][number] & {
  sort_order: number;
  script: string | null;
};
export type TreeModule = Omit<CheckCourse['modules'][number], 'lessons'> & {
  sort_order: number;
  lessons: TreeLesson[];
};
export type CourseTree = {
  id: string;
  title: string;
  description: string | null;
  published: boolean;
  modules: TreeModule[];
};

// The whole course for the builder and the check page, read with the admin's
// own session (quizzes are admin-only under RLS, so this only works for admins).
export async function loadCourseTree(supabase: SupabaseClient, id: string): Promise<CourseTree | null> {
  const { data } = await supabase
    .from('courses')
    .select(
      'id, title, description, published, modules(id, title, intro, sort_order, lessons(id, title, kind, sort_order, bunny_video_id, sample_video_url, duration_seconds, script, quizzes(pass_mark, questions)))'
    )
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;

  type RawLesson = Omit<TreeLesson, 'quiz'> & {
    quizzes: { pass_mark: number; questions: QuizQuestion[] } | { pass_mark: number; questions: QuizQuestion[] }[] | null;
  };
  type RawModule = Omit<TreeModule, 'lessons'> & { lessons: RawLesson[] | null };

  const modules = ((data.modules as RawModule[] | null) ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((m) => ({
      ...m,
      lessons: (m.lessons ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(({ quizzes, ...l }) => {
          // quizzes is one-to-one (unique lesson_id), so PostgREST may return
          // an object or a one-item array depending on how it reads the FK.
          const quiz = Array.isArray(quizzes) ? (quizzes[0] ?? null) : quizzes;
          return {
            ...l,
            quiz: quiz ? { pass_mark: Number(quiz.pass_mark), questions: quiz.questions ?? [] } : null,
          };
        }),
    }));

  return {
    id: data.id as string,
    title: data.title as string,
    description: (data.description as string | null) ?? null,
    published: Boolean(data.published),
    modules,
  };
}

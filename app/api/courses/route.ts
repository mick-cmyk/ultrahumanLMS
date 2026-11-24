import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { bunnyConfigured, fetchBunnyVideo, parseBunnyVideo } from '@/lib/bunny';
import { questionsProblem } from '@/lib/quiz-csv';
import { writtenPromptsProblem, type WrittenPrompt } from '@/lib/lesson-import';
import type { QuizQuestion } from '@/lib/quiz-csv';
import { checkCourse, hasErrors } from '@/lib/course-check';
import { loadCourseTree } from '@/lib/course-tree';

// Course builder writes (admin only). Every write goes through the admin's own
// session: the content RLS policies and table grants are the real gate, and
// the database refuses malformed quiz questions. Anything that would throw
// away a learner's progress is refused here rather than cascading silently.

type Body = { action: string; [key: string]: unknown };

const str = (v: unknown, max = 5000): string | null =>
  typeof v === 'string' ? v.trim().slice(0, max) : null;
const PASS_MARKS = [0.6, 0.7, 0.8, 0.9, 1];

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 });

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const supabase = await createClient();
  try {
    return NextResponse.json(await handle(supabase, body));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Something went wrong.' }, { status: 400 });
  }
}

function fail(message: string): never {
  throw new Error(message);
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) fail(friendly(res.error.message));
  return res.data;
}

async function handle(supabase: SupabaseClient, b: Body): Promise<Record<string, unknown>> {
  const id = str(b.id, 64);
  switch (b.action) {
    // ------------------------------------------------------------- courses
    case 'course.create': {
      const title = str(b.title, 200) || fail('Give the course a title.');
      const row = check(
        await supabase
          .from('courses')
          .insert({ title, description: str(b.description) || null, published: false })
          .select('id')
          .single()
      );
      return { id: row!.id };
    }
    case 'course.update': {
      const patch: Record<string, unknown> = {};
      if ('title' in b) patch.title = str(b.title, 200) || fail('The course needs a title.');
      if ('description' in b) patch.description = str(b.description) || null;
      // Staff must watch 90% of each video before its quiz (true), or opening
      // the lesson is enough (false). The database moves the lessons' threshold.
      if ('require_watch' in b) patch.require_watch = b.require_watch !== false;
      check(await supabase.from('courses').update(patch).eq('id', id!));
      return { ok: true };
    }
    case 'course.publish': {
      const tree = (await loadCourseTree(supabase, id!)) ?? fail('Course not found.');
      if (b.published === true) {
        const issues = checkCourse(tree, { bunnyReady: bunnyConfigured() });
        if (hasErrors(issues)) fail('Fix the problems on the check page before publishing.');
      }
      check(await supabase.from('courses').update({ published: b.published === true }).eq('id', id!));
      return { ok: true };
    }
    case 'course.delete': {
      const tree = (await loadCourseTree(supabase, id!)) ?? fail('Course not found.');
      if (tree.published) fail('Unpublish the course before deleting it.');
      const lessonIds = tree.modules.flatMap((m) => m.lessons.map((l) => l.id));
      await refuseIfProgress(supabase, lessonIds, 'course');
      check(await supabase.from('courses').delete().eq('id', id!));
      return { ok: true };
    }

    // ------------------------------------------------------------- modules
    case 'module.create': {
      const courseId = str(b.course_id, 64) || fail('Missing course.');
      const title = str(b.title, 200) || fail('Give the module a title.');
      const sort_order = await nextSort(supabase, 'modules', 'course_id', courseId);
      const row = check(
        await supabase
          .from('modules')
          .insert({ course_id: courseId, title, intro: str(b.intro) || null, sort_order })
          .select('id')
          .single()
      );
      return { id: row!.id };
    }
    case 'module.update': {
      const patch: Record<string, unknown> = {};
      if ('title' in b) patch.title = str(b.title, 200) || fail('The module needs a title.');
      if ('intro' in b) patch.intro = str(b.intro) || null;
      check(await supabase.from('modules').update(patch).eq('id', id!));
      return { ok: true };
    }
    case 'module.delete': {
      const lessons = check(await supabase.from('lessons').select('id').eq('module_id', id!)) ?? [];
      await refuseIfProgress(supabase, lessons.map((l) => l.id as string), 'module');
      const { count } = await supabase.from('retests').select('id', { count: 'exact', head: true }).eq('module_id', id!);
      if (count) fail('Staff already have re-tests for this module, so it can\'t be deleted.');
      check(await supabase.from('modules').delete().eq('id', id!));
      return { ok: true };
    }
    case 'module.move':
      await move(supabase, 'modules', 'course_id', id!, b.dir === -1 ? -1 : 1);
      return { ok: true };

    // ------------------------------------------------------------- lessons
    case 'lesson.create': {
      const moduleId = str(b.module_id, 64) || fail('Missing module.');
      const title = str(b.title, 200) || fail('Give the lesson a title.');
      const sort_order = await nextSort(supabase, 'lessons', 'module_id', moduleId);
      const row = check(
        await supabase.from('lessons').insert({ module_id: moduleId, title, sort_order }).select('id').single()
      );
      return { id: row!.id };
    }
    case 'lesson.update': {
      const patch: Record<string, unknown> = {};
      let note: string | null = null;
      if ('title' in b) patch.title = str(b.title, 200) || fail('The lesson needs a title.');
      if ('script' in b) patch.script = str(b.script, 20000) || null;
      if ('expectancy' in b) {
        const expectancy = str(b.expectancy, 1000) || null;
        const where = await lessonPlace(supabase, id!);
        if (where.published) {
          await stage(supabase, id!, { expectancy });
          note = STAGED;
        } else {
          patch.expectancy = expectancy;
        }
      }
      if ('duration_seconds' in b) {
        const d = b.duration_seconds;
        if (d === null || d === '') patch.duration_seconds = null;
        else if (Number.isInteger(d) && (d as number) > 0 && (d as number) < 6 * 3600) patch.duration_seconds = d;
        else fail('Video length must be a number of seconds.');
      }
      if ('video' in b) {
        const raw = str(b.video, 2000) ?? '';
        if (!raw) {
          patch.bunny_video_id = null;
        } else {
          const v = parseBunnyVideo(raw) ?? fail("That doesn't look like a Bunny video link or ID.");
          const lib = process.env.BUNNY_STREAM_LIBRARY_ID;
          if (v.libraryId && lib && v.libraryId !== lib) {
            fail(`That video is in Bunny library ${v.libraryId}, but this site plays library ${lib}.`);
          }
          patch.bunny_video_id = v.videoId;
          const found = await fetchBunnyVideo(v.videoId);
          if (found.ok) {
            if (!('duration_seconds' in b) && found.info.lengthSeconds > 0) {
              patch.duration_seconds = found.info.lengthSeconds;
            }
            // The video's shape, so the player fits it (portrait or landscape).
            if (found.info.aspect) patch.video_aspect = found.info.aspect;
            if (found.info.failed) note = 'Bunny says this video failed to process. Upload it again in Bunny.';
            else if (!found.info.ready) note = 'Bunny is still processing this video. It will play once that finishes.';
          } else if (found.reason === 'not-found') {
            fail("Bunny can't find that video in this site's library.");
          }
        }
      }
      if (Object.keys(patch).length) {
        check(await supabase.from('lessons').update(patch).eq('id', id!).eq('kind', 'video'));
      }
      return { ok: true, note, duration_seconds: patch.duration_seconds ?? undefined };
    }
    case 'lesson.delete': {
      await refuseIfProgress(supabase, [id!], 'lesson');
      check(await supabase.from('lessons').delete().eq('id', id!));
      return { ok: true };
    }
    case 'lesson.move':
      await move(supabase, 'lessons', 'module_id', id!, b.dir === -1 ? -1 : 1);
      return { ok: true };

    // ------------------------------------------------------------- questions
    case 'quiz.set': {
      const lessonId = str(b.lesson_id, 64) || fail('Missing lesson.');
      const questions = b.questions;
      const problem = questionsProblem(questions);
      if (problem) fail(problem);
      const pass = Number(b.pass_mark ?? 0.8);
      if (!PASS_MARKS.includes(pass)) fail('Pick a pass mark from the list.');
      if ((await lessonPlace(supabase, lessonId)).published) {
        await stage(supabase, lessonId, { questions: questions as QuizQuestion[], pass_mark: pass });
        return { ok: true, note: STAGED };
      }
      if ((questions as unknown[]).length === 0) {
        check(await supabase.from('quizzes').delete().eq('lesson_id', lessonId));
      } else {
        check(
          await supabase
            .from('quizzes')
            .upsert({ lesson_id: lessonId, pass_mark: pass, questions }, { onConflict: 'lesson_id' })
        );
      }
      return { ok: true };
    }

    // ----------------------------------------------- written prompts, import
    case 'written.set': {
      const lessonId = str(b.lesson_id, 64) || fail('Missing lesson.');
      if ((await lessonPlace(supabase, lessonId)).published) {
        const problem = writtenPromptsProblem(b.written_prompts);
        if (problem) fail(problem);
        await stage(supabase, lessonId, { written_prompts: b.written_prompts as WrittenPrompt[] });
        return { ok: true, note: STAGED };
      }
      await setWrittenPrompts(supabase, lessonId, b.written_prompts);
      return { ok: true };
    }
    // Send a written prompt's answers to the person's manager, or stop. Not a
    // change to the questions, so it applies straight away with no review.
    case 'written.send': {
      const lessonId = str(b.lesson_id, 64) || fail('Missing lesson.');
      const promptId = str(b.prompt_id, 100) || fail('Missing question.');
      check(await supabase.rpc('set_written_prompt_send', { p_lesson_id: lessonId, p_prompt_id: promptId, p_on: b.on === true }));
      return { ok: true };
    }
    // A lesson file from the question maker: quiz, written prompts and the
    // sentence shown before the video, in one go. Questions first, because
    // they're the part the database is most likely to refuse.
    case 'lesson.import': {
      const lessonId = str(b.lesson_id, 64) || fail('Missing lesson.');
      const questions = b.questions ?? [];
      const problem = questionsProblem(questions);
      if (problem) fail(problem);
      const promptProblem = writtenPromptsProblem(b.written_prompts ?? []);
      if (promptProblem) fail(promptProblem);
      const pass = Number(b.pass_mark ?? 0.8);
      if (!PASS_MARKS.includes(pass)) fail('Pick a pass mark from the list.');
      const where = await lessonPlace(supabase, lessonId);
      if (where.kind !== 'video') fail('That lesson is a SCORM package.');
      if (where.published) {
        await stage(
          supabase,
          lessonId,
          {
            questions: questions as QuizQuestion[],
            pass_mark: pass,
            written_prompts: (b.written_prompts ?? []) as WrittenPrompt[],
            expectancy: str(b.expectancy, 1000) || null,
          },
          str(b.note, 500)
        );
        return { ok: true, note: STAGED };
      }
      if ((questions as unknown[]).length === 0) {
        check(await supabase.from('quizzes').delete().eq('lesson_id', lessonId));
      } else {
        check(
          await supabase
            .from('quizzes')
            .upsert({ lesson_id: lessonId, pass_mark: pass, questions }, { onConflict: 'lesson_id' })
        );
      }
      check(
        await supabase.from('lessons').update({ expectancy: str(b.expectancy, 1000) || null }).eq('id', lessonId)
      );
      await setWrittenPrompts(supabase, lessonId, b.written_prompts ?? []);
      return { ok: true };
    }

    // ------------------------------------------------------------- review
    case 'lesson.review': {
      const lessonId = str(b.lesson_id, 64) || fail('Missing lesson.');
      check(await supabase.rpc('mark_lesson_reviewed', { p_lesson_id: lessonId, p_reviewed: b.reviewed !== false }));
      return { ok: true };
    }
    case 'draft.apply': {
      const lessonId = str(b.lesson_id, 64) || fail('Missing lesson.');
      check(await supabase.rpc('apply_lesson_draft', { p_lesson_id: lessonId }));
      return { ok: true };
    }
    case 'draft.discard': {
      const lessonId = str(b.lesson_id, 64) || fail('Missing lesson.');
      check(await supabase.from('lesson_drafts').delete().eq('lesson_id', lessonId));
      return { ok: true };
    }

    // ------------------------------------------------------------- Bunny
    case 'bunny.lookup': {
      const v = parseBunnyVideo(str(b.video, 2000) ?? '') ?? fail("That doesn't look like a Bunny video link or ID.");
      const found = await fetchBunnyVideo(v.videoId);
      return { videoId: v.videoId, info: found.ok ? found.info : null, reason: found.ok ? null : found.reason };
    }
  }
  fail('Unknown action.');
}

async function refuseIfProgress(supabase: SupabaseClient, lessonIds: string[], what: string) {
  if (lessonIds.length === 0) return;
  const { count, error } = await supabase
    .from('lesson_progress')
    .select('lesson_id', { count: 'exact', head: true })
    .in('lesson_id', lessonIds);
  if (error) fail(error.message);
  if (count) {
    fail(`Staff have already started this ${what}, so deleting it would wipe their progress. Rename or edit it instead.`);
  }
}

async function nextSort(supabase: SupabaseClient, table: string, parentCol: string, parentId: string) {
  const rows = check(
    await supabase.from(table).select('sort_order').eq(parentCol, parentId).order('sort_order', { ascending: false }).limit(1)
  ) as { sort_order: number }[] | null;
  return (rows?.[0]?.sort_order ?? 0) + 1;
}

// Swap with the neighbour above or below, then renumber 1..n so gaps and
// duplicate sort orders from older data sort themselves out.
async function move(supabase: SupabaseClient, table: string, parentCol: string, id: string, dir: -1 | 1) {
  const me = check(await supabase.from(table).select(parentCol).eq('id', id).single()) as unknown as Record<string, string>;
  const siblings = (check(
    await supabase.from(table).select('id').eq(parentCol, me[parentCol]).order('sort_order').order('id')
  ) ?? []) as { id: string }[];
  const ids = siblings.map((s) => s.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (const [k, sid] of ids.entries()) {
    check(await supabase.from(table).update({ sort_order: k + 1 }).eq('id', sid));
  }
}

const STAGED =
  'Saved as a change waiting for review. Staff keep the current version until someone approves it on the Check page.';

// Where a lesson sits: is it a video lesson, and is its course live?
async function lessonPlace(supabase: SupabaseClient, lessonId: string) {
  const row = check(
    await supabase.from('lessons').select('kind, modules(courses(published))').eq('id', lessonId).maybeSingle()
  ) as { kind: string; modules: unknown } | null;
  if (!row) fail('That lesson no longer exists.');
  const one = <T,>(rel: T | T[] | null | undefined): T | null => (Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null));
  const mod = one(row.modules as { courses: { published: boolean } | { published: boolean }[] | null } | null);
  return { kind: row.kind, published: Boolean(one(mod?.courses)?.published) };
}

// On a live course, changes to what staff answer wait in lesson_drafts until
// an admin reviews them. A new change builds on any change already waiting,
// or on the live version.
async function stage(
  supabase: SupabaseClient,
  lessonId: string,
  patch: { questions?: QuizQuestion[]; pass_mark?: number; written_prompts?: WrittenPrompt[]; expectancy?: string | null },
  note: string | null = null
) {
  let base = check(
    await supabase
      .from('lesson_drafts')
      .select('pass_mark, questions, written_prompts, expectancy, note')
      .eq('lesson_id', lessonId)
      .maybeSingle()
  ) as { pass_mark: number; questions: QuizQuestion[]; written_prompts: WrittenPrompt[]; expectancy: string | null; note: string | null } | null;
  if (!base) {
    const [quiz, prompts, lesson] = await Promise.all([
      supabase.from('quizzes').select('pass_mark, questions').eq('lesson_id', lessonId).maybeSingle(),
      supabase.from('written_prompts').select('id, prompt, model_answer, max_words').eq('lesson_id', lessonId).order('sort_order'),
      supabase.from('lessons').select('expectancy').eq('id', lessonId).maybeSingle(),
    ]);
    base = {
      pass_mark: Number((check(quiz) as { pass_mark: number } | null)?.pass_mark ?? 0.8),
      questions: ((check(quiz) as { questions: QuizQuestion[] } | null)?.questions ?? []) as QuizQuestion[],
      written_prompts: (check(prompts) ?? []) as WrittenPrompt[],
      expectancy: (check(lesson) as { expectancy: string | null } | null)?.expectancy ?? null,
      note: null,
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  check(
    await supabase.from('lesson_drafts').upsert(
      {
        lesson_id: lessonId,
        pass_mark: patch.pass_mark ?? Number(base.pass_mark),
        questions: patch.questions ?? base.questions,
        written_prompts: (patch.written_prompts ?? base.written_prompts).map((p) => ({
          id: p.id,
          prompt: p.prompt,
          model_answer: p.model_answer ?? null,
          max_words: p.max_words ?? null,
        })),
        expectancy: 'expectancy' in patch ? (patch.expectancy ?? null) : base.expectancy,
        note: note ?? base.note,
        created_by: user?.id ?? null,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'lesson_id' }
    )
  );
}

// Upsert by id and drop the rest. Ids come from the question maker and stay
// stable, so re-importing updates prompts in place; learners' answers are kept
// either way (they don't cascade from prompts).
async function setWrittenPrompts(supabase: SupabaseClient, lessonId: string, prompts: unknown) {
  const problem = writtenPromptsProblem(prompts);
  if (problem) fail(problem);
  const list = prompts as WrittenPrompt[];
  if (list.length) {
    check(
      await supabase.from('written_prompts').upsert(
        list.map((p, i) => ({
          lesson_id: lessonId,
          id: p.id,
          sort_order: i + 1,
          prompt: p.prompt.trim(),
          model_answer: p.model_answer?.trim() || null,
          max_words: p.max_words ?? null,
        })),
        { onConflict: 'lesson_id,id' }
      )
    );
  }
  const existing = check(await supabase.from('written_prompts').select('id').eq('lesson_id', lessonId)) ?? [];
  const keep = new Set(list.map((p) => p.id));
  const drop = (existing as { id: string }[]).map((r) => r.id).filter((x) => !keep.has(x));
  if (drop.length) {
    check(await supabase.from('written_prompts').delete().eq('lesson_id', lessonId).in('id', drop));
  }
}

function friendly(message: string): string {
  const quiz = message.match(/invalid quiz: (.*)/);
  if (quiz) return `The questions weren't saved: ${quiz[1]}.`;
  if (/row-level security|permission denied/i.test(message)) return 'Only admins can change courses.';
  return message;
}

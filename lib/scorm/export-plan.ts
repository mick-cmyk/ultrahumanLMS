// What an in-app SCORM export needs: the course content plus where to fetch
// each video. The admin's browser downloads the videos and zips them (a zip
// with video is far too big to send back from a serverless function), using
// buildPackageZip from ./export, the same code the CLI uses.
//
// Pure, so it can be unit tested. The route reads the course with the admin's
// own session and passes it in.

import type { CourseTree } from '../course-tree';
import type { ExportQuestion } from './export';

export type PlanLesson = {
  id: string;
  title: string;
  /** Video URLs to try in order (best quality first). */
  sources: string[];
  watchThreshold: number;
  script: string | null;
  quiz: { passMark: number; questions: ExportQuestion[] } | null;
};

export type ExportPlan = {
  id: string;
  title: string;
  description: string;
  accent: string;
  accentText: string;
  lessons: PlanLesson[];
  /** Lessons left out, with the reason, so the admin knows before sending it on. */
  skipped: { title: string; reason: string }[];
};

// 720p keeps the zip a sensible size; lower ones are fallbacks for clips that
// were uploaded small.
const BUNNY_QUALITIES = ['720p', '480p', '360p', '240p'];

export function buildExportPlan(
  tree: Pick<CourseTree, 'id' | 'title' | 'description' | 'require_watch' | 'modules'>,
  opts: { cdnHost: string | null; accent: string; accentText: string }
): ExportPlan {
  const lessons: PlanLesson[] = [];
  const skipped: ExportPlan['skipped'] = [];
  const threshold = tree.require_watch ? 0.9 : 0;

  for (const m of tree.modules) {
    for (const l of m.lessons) {
      const title = l.title || 'Untitled lesson';
      if (l.kind === 'scorm') {
        skipped.push({ title, reason: 'It is an imported SCORM package, and a package can\'t hold another one.' });
        continue;
      }
      let sources: string[] = [];
      if (l.bunny_video_id) {
        if (!opts.cdnHost) {
          skipped.push({ title, reason: 'Couldn\'t find where Bunny keeps the video files. Set BUNNY_STREAM_CDN_HOST on the site.' });
          continue;
        }
        sources = BUNNY_QUALITIES.map((q) => `https://${opts.cdnHost}/${l.bunny_video_id}/play_${q}.mp4`);
      } else if (l.sample_video_url && (/^https:\/\//.test(l.sample_video_url) || (l.sample_video_url.startsWith('/') && !l.sample_video_url.includes('..')))) {
        sources = [l.sample_video_url];
      } else {
        skipped.push({ title, reason: 'It has no video yet.' });
        continue;
      }
      const questions = l.quiz?.questions ?? [];
      lessons.push({
        id: l.id,
        title,
        sources,
        watchThreshold: threshold,
        script: l.script ?? null,
        quiz: questions.length
          ? {
              passMark: l.quiz!.pass_mark,
              questions: questions.map((q) => ({
                id: q.id,
                text: q.text,
                options: q.options,
                correct_index: q.correct_index,
                explanation: q.explanation ?? '',
              })),
            }
          : null,
      });
    }
  }

  return {
    id: tree.id,
    title: tree.title,
    description: tree.description ?? '',
    accent: opts.accent,
    accentText: opts.accentText,
    lessons,
    skipped,
  };
}

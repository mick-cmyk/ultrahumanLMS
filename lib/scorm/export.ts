// Builds a self-contained SCORM 1.2 package from a course, for a client to load
// into their own LMS (docs/HANDOVER-CHAT-2026-11-18.md section 2, "Export").
//
// Self-contained means: the videos, a small player and the quizzes are all in
// the zip, and nothing calls back to this app. Consequences, by design:
//   - no week-later re-test (a package can't email anyone days later);
//   - the quiz answers are inside the package (it has to mark answers offline).
//     Anyone who unzips it can read them. Fine for training, not for exams.
//
// Pure: takes the course and the video bytes, returns the files. The CLI
// (scripts/scorm-export.ts) does the fetching and writes the zip.

import { zipSync, strToU8 } from 'fflate';
import { PLAYER_CSS, PLAYER_HTML, PLAYER_JS } from './export-player';

export type ExportQuestion = {
  id: string;
  text: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

export type ExportWritten = {
  id: string;
  prompt: string;
  model_answer: string | null;
  max_words: number | null;
};

export type ExportLesson = {
  id: string;
  title: string;
  /** Path of the video inside the package, e.g. "media/lesson-1.mp4". */
  videoPath: string;
  video: Uint8Array;
  watchThreshold: number; // 0..1
  script?: string | null;
  /** "Before you watch": what to look out for. */
  expectancy?: string | null;
  quiz?: { passMark: number; questions: ExportQuestion[] } | null;
  /** "Explain it in your own words": not marked, shows the model answer after. */
  written?: ExportWritten[];
};

export type ExportCourse = {
  id: string;
  title: string;
  description?: string | null;
  lessons: ExportLesson[];
  /** Accent colour for buttons and bars; six-digit hex. */
  accent: string;
  /** Text colour on the accent (from brands/colour.ts textOn). */
  accentText: string;
};

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const htmlEsc = xmlEsc;

/** Safe for a <script> block: no "</script>" breakout, no U+2028 surprises. */
const jsonForScript = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'course'
  );
}

export function buildManifest(course: ExportCourse, files: string[]): string {
  const id = `octolab-${slug(course.title)}-${course.id.slice(0, 8)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${xmlEsc(id)}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${xmlEsc(course.title)}</title>
      <item identifier="ITEM-1" identifierref="RES-1" isvisible="true">
        <title>${xmlEsc(course.title)}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
${files.map((f) => `      <file href="${xmlEsc(f)}"/>`).join('\n')}
    </resource>
  </resources>
</manifest>
`;
}

/** Everything the player needs, minus the video bytes. */
export function courseData(course: ExportCourse) {
  return {
    title: course.title,
    description: course.description ?? '',
    lessons: course.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      video: l.videoPath,
      threshold: l.watchThreshold,
      script: l.script ?? '',
      expectancy: l.expectancy ?? '',
      quiz: l.quiz && l.quiz.questions.length ? l.quiz : null,
      written: (l.written ?? []).filter((w) => w.prompt.trim()),
    })),
  };
}

/** Returns the zip's files, keyed by path. */
export function buildPackageFiles(course: ExportCourse): Record<string, Uint8Array> {
  if (!course.lessons.length) throw new Error('The course has no lessons to export.');
  const files: Record<string, Uint8Array> = {};

  // Replacer functions, not strings: a "$&" or "$1" in a title or question
  // would otherwise be expanded by String.replace.
  const colour = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#14161a');
  const html = PLAYER_HTML.replace(/__TITLE__/g, () => htmlEsc(course.title))
    .replace('__ACCENT__', () => colour(course.accent))
    .replace('__ACCENT_TEXT__', () => colour(course.accentText))
    .replace('__COURSE_JSON__', () => jsonForScript(courseData(course)));
  files['index.html'] = strToU8(html);
  files['player.js'] = strToU8(PLAYER_JS);
  files['player.css'] = strToU8(PLAYER_CSS);
  for (const l of course.lessons) files[l.videoPath] = l.video;

  const listed = Object.keys(files).sort();
  files['imsmanifest.xml'] = strToU8(buildManifest(course, listed));
  return files;
}

export function buildPackageZip(course: ExportCourse): Uint8Array {
  const files = buildPackageFiles(course);
  // Videos are already compressed; storing them is faster and no bigger.
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [path, data] of Object.entries(files)) {
    entries[path] = [data, { level: /\.(mp4|webm|m4v|mp3)$/i.test(path) ? 0 : 6 }];
  }
  return zipSync(entries);
}

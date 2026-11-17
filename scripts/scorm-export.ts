// Export a course as a self-contained SCORM 1.2 zip, for a client to load into
// their own LMS. Runs on your machine, not on Vercel: zips with video are too
// big for a serverless function.
//
//   npm run scorm:export -- --course <course id>          (from the database)
//   npm run scorm:export -- --seed attach-selling         (the demo course, no database)
//   options: --out <folder> (default "exports"), --accent "#0f766e"
//
// Video comes from each lesson's sample_video_url (a file under public/ or a
// URL) or, for Bunny lessons, the library's MP4 rendition. Bunny needs "MP4
// fallback" turned on in the library and BUNNY_STREAM_CDN_HOST set to the pull
// zone, e.g. vz-abc123.b-cdn.net.
//
// Before a package goes to a customer, test it in SCORM Cloud or Moodle.
// SCORM lessons inside a course are skipped (a package can't contain another).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBrand, getBrandTokens } from '../brands';
import { buildPackageZip, slug, type ExportCourse, type ExportLesson } from '../lib/scorm/export';
import { adminClient, die, must } from './db';

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

async function loadVideo(lesson: { title: string; sample_video_url?: string | null; bunny_video_id?: string | null }) {
  if (lesson.bunny_video_id) {
    const host = process.env.BUNNY_STREAM_CDN_HOST;
    if (!host) die(`"${lesson.title}" is a Bunny video. Set BUNNY_STREAM_CDN_HOST in .env.local (the library's pull zone).`);
    for (const q of ['720p', '480p', '360p', '240p']) {
      const bytes = await fetchBytes(`https://${host}/${lesson.bunny_video_id}/play_${q}.mp4`);
      if (bytes) return bytes;
    }
    die(`No MP4 found for "${lesson.title}". Turn on MP4 fallback in the Bunny library, wait for it to re-encode, then try again.`);
  }
  const src = lesson.sample_video_url;
  if (!src) die(`"${lesson.title}" has no video to export.`);
  if (/^https?:\/\//.test(src)) {
    const bytes = await fetchBytes(src);
    if (!bytes) die(`Couldn't download the video for "${lesson.title}" from ${src}.`);
    return bytes;
  }
  if (src.startsWith('/') && !src.includes('..')) {
    try {
      return new Uint8Array(readFileSync(join(process.cwd(), 'public', src)));
    } catch {
      die(`Video file public${src} for "${lesson.title}" doesn't exist.`);
    }
  }
  die(`Don't know how to fetch the video "${src}" for "${lesson.title}".`);
}

type Accent = { accent: string; accentText: string };

async function fromSeed(name: string, accent: Accent): Promise<ExportCourse> {
  if (name !== 'attach-selling') die(`Unknown seed course "${name}". Try --seed attach-selling.`);
  const c = await import('../seed/content/attach-selling');
  const lessons: ExportLesson[] = [];
  for (const [i, l] of c.LESSONS.entries()) {
    lessons.push({
      id: `lesson-${i + 1}`,
      title: l.title,
      videoPath: `media/lesson-${i + 1}.mp4`,
      video: await loadVideo({ title: l.title, sample_video_url: l.video }),
      watchThreshold: 0.9,
      script: l.script,
      quiz: l.quiz?.length ? { passMark: 0.8, questions: l.quiz } : null,
    });
  }
  return { id: 'seed-attach-selling', title: c.COURSE_TITLE, description: c.COURSE_DESCRIPTION, lessons, ...accent };
}

type Row = Record<string, unknown>;

async function fromDatabase(courseId: string, accent: Accent): Promise<ExportCourse> {
  const db = adminClient();
  const course = (await must(
    db.from('courses').select('id, title, description').eq('id', courseId).maybeSingle(),
    'Reading the course'
  )) as Row | null;
  if (!course) die(`No course with id ${courseId}.`);

  const modules = (await must(
    db.from('modules').select('id, title, sort_order').eq('course_id', courseId).order('sort_order'),
    'Reading modules'
  )) as Row[];
  const moduleIds = modules.map((m) => m.id as string);
  const lessons = moduleIds.length
    ? ((await must(
        db
          .from('lessons')
          .select('id, module_id, title, sort_order, kind, bunny_video_id, sample_video_url, watch_threshold, script')
          .in('module_id', moduleIds),
        'Reading lessons'
      )) as Row[])
    : [];
  const quizzes = lessons.length
    ? ((await must(
        db.from('quizzes').select('lesson_id, pass_mark, questions').in('lesson_id', lessons.map((l) => l.id as string)),
        'Reading quizzes'
      )) as Row[])
    : [];

  const moduleOrder = new Map(moduleIds.map((id, i) => [id, i]));
  lessons.sort(
    (a, b) =>
      (moduleOrder.get(a.module_id as string)! - moduleOrder.get(b.module_id as string)!) ||
      ((a.sort_order as number) - (b.sort_order as number))
  );

  const out: ExportLesson[] = [];
  for (const l of lessons) {
    if (l.kind === 'scorm') {
      console.warn(`  skipping "${l.title}": it's an imported SCORM lesson`);
      continue;
    }
    const n = out.length + 1;
    const qz = quizzes.find((q) => q.lesson_id === l.id);
    process.stdout.write(`  fetching video ${n}: ${l.title}\n`);
    out.push({
      id: l.id as string,
      title: l.title as string,
      videoPath: `media/lesson-${n}.mp4`,
      video: await loadVideo(l as { title: string }),
      watchThreshold: Number(l.watch_threshold) || 0.9,
      script: (l.script as string | null) ?? null,
      quiz: qz ? { passMark: Number(qz.pass_mark), questions: qz.questions as ExportLesson['quiz'] extends infer Q ? Q extends { questions: infer X } ? X : never : never } : null,
    });
  }
  if (!out.length) die('That course has no video lessons to export.');
  return { id: course.id as string, title: course.title as string, description: (course.description as string) ?? '', lessons: out, ...accent };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tokens = getBrandTokens(getBrand());
  const accentHex = args.accent && /^#[0-9a-f]{6}$/i.test(args.accent) ? args.accent : tokens.brand;
  const { textOn } = await import('../brands/colour');
  const accent = { accent: accentHex, accentText: textOn(accentHex) };

  let course: ExportCourse;
  if (args.seed) course = await fromSeed(args.seed, accent);
  else if (args.course) course = await fromDatabase(args.course, accent);
  else die('Pass --course <course id>, or --seed attach-selling for the demo course.');

  const zip = buildPackageZip(course);
  const dir = join(process.cwd(), args.out && args.out !== 'true' ? args.out : 'exports');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug(course.title)}-scorm12.zip`);
  writeFileSync(file, zip);

  const quizzes = course.lessons.filter((l) => l.quiz).length;
  console.log(`\nWrote ${file}`);
  console.log(`  ${course.lessons.length} lessons, ${quizzes} with a quiz, ${(zip.byteLength / 1024 / 1024).toFixed(1)} MB`);
  console.log('  SCORM 1.2, self-contained. No week-later check (a package can\'t send it).');
  console.log('  Test it in SCORM Cloud or Moodle before it goes to a customer.');
}

main();

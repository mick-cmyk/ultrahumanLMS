import { describe, expect, it } from 'vitest';
import {
  parseCsv,
  parseQuestionsCsv,
  questionsProblem,
  questionsToCsv,
  templateCsv,
  type QuizQuestion,
} from '@/lib/quiz-csv';
import { parseBunnyVideo } from '@/lib/bunny';
import { checkCourse, hasErrors, type CheckCourse } from '@/lib/course-check';

const GUID = '0b2f8f7e-1111-4c4c-9d9d-123456789abc';

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, newlines in quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });
  it('reads semicolon files', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('drops blank rows', () => {
    expect(parseCsv('a,b\n,\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseQuestionsCsv', () => {
  it('reads the template it hands out', () => {
    const { questions, errors } = parseQuestionsCsv(templateCsv());
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0].options).toHaveLength(4);
    expect(questions[0].correct_index).toBe(1);
    expect(questions[1].options).toHaveLength(2);
    expect(questionsProblem(questions)).toBeNull();
  });

  it('round-trips through download and upload, keeping ids', () => {
    const first = parseQuestionsCsv(templateCsv()).questions;
    const again = parseQuestionsCsv(questionsToCsv(first), first);
    expect(again.errors).toEqual([]);
    expect(again.questions).toEqual(first);
  });

  it('accepts headers in any case or order and lower-case letters', () => {
    const csv = 'Correct,Question,Answer A,Answer B\nb,Pick two,One,Two\n';
    const { questions, errors } = parseQuestionsCsv(csv);
    expect(errors).toEqual([]);
    expect(questions[0]).toMatchObject({ text: 'Pick two', options: ['One', 'Two'], correct_index: 1 });
    expect(questions[0]).not.toHaveProperty('explanation');
  });

  it('reports each problem with its row number', () => {
    const csv = [
      'question,answer_a,answer_b,answer_c,correct',
      ',a,b,,A',
      'One answer,a,,,A',
      'No correct,a,b,,',
      'Bad letter,a,b,,C',
      'Gap,a,,c,A',
    ].join('\n');
    const { errors } = parseQuestionsCsv(csv);
    expect(errors).toEqual([
      'Row 2: the question is blank.',
      'Row 3: needs at least two answers (answer_a and answer_b).',
      'Row 4: the correct column is blank. Put the letter of the right answer, like B.',
      'Row 5: correct is "C", but that answer is blank or not a letter from A to F.',
      'Row 6: answer C has a blank answer before it. Fill answers in order from A.',
    ]);
  });

  it('refuses a file without the template columns', () => {
    expect(parseQuestionsCsv('foo,bar\n1,2').errors[0]).toMatch(/column names from the template/);
    expect(parseQuestionsCsv('').errors).toEqual(['The file is empty.']);
    expect(parseQuestionsCsv('question,answer_a,answer_b,correct\n').errors).toEqual([
      'There are no questions under the column names.',
    ]);
  });

  it('caps the number of questions', () => {
    const rows = Array.from({ length: 21 }, (_, i) => `Q${i},a,b,A`);
    const { errors } = parseQuestionsCsv(['question,answer_a,answer_b,correct', ...rows].join('\n'));
    expect(errors.at(-1)).toMatch(/21 questions/);
  });
});

describe('questionsProblem (server recheck)', () => {
  const good: QuizQuestion = { id: 'q1', text: 'a', options: ['x', 'y'], correct_index: 0 };
  it.each([
    ['not a list', 'x', /list/],
    ['repeat ids', [good, good], /repeated id/],
    ['one answer', [{ ...good, options: ['x'] }], /2 to 6/],
    ['blank answer', [{ ...good, options: ['x', ' '] }], /blank answer/],
    ['out of range', [{ ...good, correct_index: 2 }], /correct answer/],
    ['fractional', [{ ...good, correct_index: 0.5 }], /correct answer/],
  ])('%s', (_, input, want) => {
    expect(questionsProblem(input)).toMatch(want);
  });
  it('passes good questions', () => expect(questionsProblem([good])).toBeNull());
});

describe('parseBunnyVideo', () => {
  it.each([
    [GUID, { videoId: GUID, libraryId: null }],
    [`  ${GUID.toUpperCase()} `, { videoId: GUID, libraryId: null }],
    [`https://iframe.mediadelivery.net/embed/123456/${GUID}?autoplay=true`, { videoId: GUID, libraryId: '123456' }],
    [`https://iframe.mediadelivery.net/play/123456/${GUID}`, { videoId: GUID, libraryId: '123456' }],
    [
      `<iframe src="https://iframe.mediadelivery.net/embed/99/${GUID}?autoplay=false" loading="lazy"></iframe>`,
      { videoId: GUID, libraryId: '99' },
    ],
    [`https://dash.bunny.net/stream/4321/library/videos?videoId=${GUID}`, { videoId: GUID, libraryId: '4321' }],
  ])('%s', (input, want) => {
    expect(parseBunnyVideo(input)).toEqual(want);
  });
  it.each(['', 'https://youtube.com/watch?v=abc', 'not a video', `${GUID}extra`])('rejects %s', (input) => {
    expect(parseBunnyVideo(input)).toBeNull();
  });
});

describe('checkCourse', () => {
  const q = (n: number): QuizQuestion[] =>
    Array.from({ length: n }, (_, i) => ({ id: `q${i}`, text: 't', options: ['a', 'b'], correct_index: 0 }));
  const lesson = (over = {}) => ({
    id: 'l1',
    title: 'Lesson',
    kind: 'video',
    bunny_video_id: GUID,
    sample_video_url: null,
    duration_seconds: 120,
    quiz: { pass_mark: 0.8, questions: q(3) },
    ...over,
  });
  const course = (over: Partial<CheckCourse> = {}): CheckCourse => ({
    title: 'Course',
    description: 'About it',
    modules: [{ id: 'm1', title: 'Module', intro: 'Why', lessons: [lesson()] }],
    ...over,
  });

  it('a complete course has no issues', () => {
    expect(checkCourse(course(), { bunnyReady: true })).toEqual([]);
  });

  it('blocks a course with no modules or an empty module', () => {
    expect(hasErrors(checkCourse(course({ modules: [] }), { bunnyReady: true }))).toBe(true);
    const empty = course({ modules: [{ id: 'm1', title: 'M', intro: 'x', lessons: [] }] });
    expect(checkCourse(empty, { bunnyReady: true })).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'This module has no lessons.' })
    );
  });

  it('blocks a lesson with no video, or Bunny not connected', () => {
    const noVideo = course({
      modules: [{ id: 'm1', title: 'M', intro: 'x', lessons: [lesson({ bunny_video_id: null })] }],
    });
    expect(hasErrors(checkCourse(noVideo, { bunnyReady: true }))).toBe(true);
    expect(checkCourse(course(), { bunnyReady: false })).toContainEqual(
      expect.objectContaining({ level: 'error', lessonId: 'l1' })
    );
  });

  it('warns, but allows, a watch-only lesson and a thin quiz', () => {
    const watchOnly = course({
      modules: [{ id: 'm1', title: 'M', intro: 'x', lessons: [lesson({ quiz: null })] }],
    });
    const issues = checkCourse(watchOnly, { bunnyReady: true });
    expect(hasErrors(issues)).toBe(false);
    expect(issues.map((i) => i.message).join(' ')).toMatch(/no quick check and no re-test/);

    const thin = course({
      modules: [{ id: 'm1', title: 'M', intro: 'x', lessons: [lesson({ quiz: { pass_mark: 0.8, questions: q(2) } })] }],
    });
    expect(checkCourse(thin, { bunnyReady: true })[0].message).toMatch(/every one right/);
  });

  it('skips video rules for SCORM lessons', () => {
    const scorm = course({
      modules: [
        { id: 'm1', title: 'M', intro: 'x', lessons: [lesson({ kind: 'scorm', bunny_video_id: null, quiz: null, duration_seconds: null })] },
      ],
    });
    expect(checkCourse(scorm, { bunnyReady: false })).toEqual([]);
  });
});

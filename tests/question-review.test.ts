import { describe, expect, it } from 'vitest';
import { checkCourse, hasErrors, type CheckCourse } from '@/lib/course-check';

const lesson = {
  id: 'l1',
  title: 'L1',
  kind: 'video',
  bunny_video_id: null,
  sample_video_url: 'https://example.com/a.mp4',
  duration_seconds: 60,
  quiz: { pass_mark: 0.8, questions: [1, 2, 3].map((n) => ({ id: `q${n}`, text: `Q${n}`, options: ['a', 'b'], correct_index: 0 })) },
};
const course = (l: Partial<CheckCourse['modules'][number]['lessons'][number]>): CheckCourse => ({
  title: 'C',
  description: 'D',
  modules: [{ id: 'm1', title: 'M1', intro: 'Why', lessons: [{ ...lesson, ...l }] }],
});

describe('question review in the course check', () => {
  it('blocks publishing while a lesson is unreviewed', () => {
    const issues = checkCourse(course({ needs_review: true }), { bunnyReady: true });
    expect(hasErrors(issues)).toBe(true);
    expect(issues.find((i) => i.level === 'error')?.message).toMatch(/not reviewed/);
  });
  it('passes once reviewed', () => {
    expect(hasErrors(checkCourse(course({ needs_review: false }), { bunnyReady: true }))).toBe(false);
  });
  it('flags a waiting change without blocking', () => {
    const issues = checkCourse(course({ has_draft: true }), { bunnyReady: true });
    expect(hasErrors(issues)).toBe(false);
    expect(issues.some((i) => /waiting for review/.test(i.message))).toBe(true);
  });
});

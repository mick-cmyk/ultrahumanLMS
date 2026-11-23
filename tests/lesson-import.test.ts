import { describe, expect, it } from 'vitest';
import { parseLessonImport, writtenPromptsProblem } from '@/lib/lesson-import';

const good = {
  format: 'learnforge-lesson',
  version: 1,
  source: { app: 'QuestionForge', set_id: 's1', set_title: 'Why do people stop speaking up?', client: 'Acme', exported_at: '2026-11-23T00:00:00Z', includes_drafts: false },
  lesson: {
    idea: 'People speak up when the cost of being wrong is low.',
    expectancy: 'By the end you will explain to a new starter why one bad meeting changes who talks.',
    questions: [
      { id: 'q1', text: 'What makes someone stay quiet?', options: ['Fear of looking wrong', 'Being tired', 'The agenda'], correct_index: 0, explanation: 'The cost of being wrong.' },
    ],
    written_prompts: [{ id: 'w1', prompt: 'Explain it in one sentence.', model_answer: 'Because being wrong cost too much last time.', max_words: 40 }],
  },
  skipped: [{ id: 'q9', type: 'image_id', stem: 'Which panel is this?', reason: 'Needs a picture.' }],
};

describe('parseLessonImport', () => {
  it('reads a good file', () => {
    const { value, errors } = parseLessonImport(JSON.stringify(good));
    expect(errors).toEqual([]);
    expect(value?.questions).toHaveLength(1);
    expect(value?.written_prompts[0]).toEqual({ id: 'w1', prompt: 'Explain it in one sentence.', model_answer: 'Because being wrong cost too much last time.', max_words: 40 });
    expect(value?.expectancy).toMatch(/new starter/);
    expect(value?.skipped).toHaveLength(1);
  });
  it('refuses something that is not JSON', () => {
    expect(parseLessonImport('question,answer_a').errors[0]).toMatch(/isn't valid JSON/);
  });
  it('points at the right download when given the full export', () => {
    expect(parseLessonImport(JSON.stringify({ schema_version: '1.0', generated_by: 'STRIKE' })).errors[0]).toMatch(/LMS lesson \(JSON\)/);
  });
  it('refuses another version', () => {
    expect(parseLessonImport(JSON.stringify({ ...good, version: 2 })).errors[0]).toMatch(/version 2/);
  });
  it('refuses a bad question', () => {
    const bad = { ...good, lesson: { ...good.lesson, questions: [{ id: 'q1', text: 'x', options: ['a'], correct_index: 0 }] } };
    expect(parseLessonImport(JSON.stringify(bad)).value).toBeNull();
  });
  it('refuses an empty lesson', () => {
    const empty = { ...good, lesson: { questions: [], written_prompts: [] } };
    expect(parseLessonImport(JSON.stringify(empty)).errors.join(' ')).toMatch(/no questions or written prompts/);
  });
});

describe('writtenPromptsProblem', () => {
  it('passes good prompts', () => {
    expect(writtenPromptsProblem([{ id: 'w1', prompt: 'Why?', model_answer: null, max_words: null }])).toBeNull();
  });
  it('wants unique ids', () => {
    expect(writtenPromptsProblem([{ id: 'w1', prompt: 'a' }, { id: 'w1', prompt: 'b' }])).toMatch(/repeated id/);
  });
  it('caps the word limit', () => {
    expect(writtenPromptsProblem([{ id: 'w1', prompt: 'a', max_words: 1000 }])).toMatch(/5 to 300/);
  });
});

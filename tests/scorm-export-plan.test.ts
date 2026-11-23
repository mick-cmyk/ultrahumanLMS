import { describe, expect, it } from 'vitest';
import { buildExportPlan } from '@/lib/scorm/export-plan';

type Tree = Parameters<typeof buildExportPlan>[0];
type L = Tree['modules'][number]['lessons'][number];

const lesson = (over: Partial<L>): L =>
  ({
    id: 'l',
    title: 'Lesson',
    kind: 'video',
    bunny_video_id: null,
    sample_video_url: null,
    script: null,
    quiz: null,
    ...over,
  }) as L;

const tree = (lessons: L[], over: Partial<Tree> = {}): Tree =>
  ({
    id: 'c1',
    title: 'Course',
    description: null,
    require_watch: true,
    modules: [{ id: 'm1', title: 'M', lessons }],
    ...over,
  }) as Tree;

const opts = { cdnHost: 'vz-test.b-cdn.net', accent: '#ED4E05', accentText: '#14161a' };

describe('SCORM export plan', () => {
  it('points Bunny lessons at the MP4 copies, best first', () => {
    const plan = buildExportPlan(tree([lesson({ id: 'a', bunny_video_id: 'vid-1' })]), opts);
    expect(plan.lessons[0].sources[0]).toBe('https://vz-test.b-cdn.net/vid-1/play_720p.mp4');
    expect(plan.lessons[0].sources.at(-1)).toBe('https://vz-test.b-cdn.net/vid-1/play_240p.mp4');
    expect(plan.lessons[0].watchThreshold).toBe(0.9);
  });

  it('uses no watch requirement when the course makes watching optional', () => {
    const plan = buildExportPlan(tree([lesson({ sample_video_url: '/videos/a.mp4' })], { require_watch: false }), opts);
    expect(plan.lessons[0].watchThreshold).toBe(0);
    expect(plan.lessons[0].sources).toEqual(['/videos/a.mp4']);
  });

  it('carries quizzes over with explanations filled in', () => {
    const plan = buildExportPlan(
      tree([
        lesson({
          sample_video_url: '/v.mp4',
          quiz: { pass_mark: 0.8, questions: [{ id: 'q', text: 'T', options: ['a', 'b'], correct_index: 1 }] },
        }),
      ]),
      opts
    );
    expect(plan.lessons[0].quiz).toEqual({
      passMark: 0.8,
      questions: [{ id: 'q', text: 'T', options: ['a', 'b'], correct_index: 1, explanation: '' }],
    });
  });

  it('carries the before-you-watch note and written questions', () => {
    const plan = buildExportPlan(
      tree([
        lesson({
          sample_video_url: '/v.mp4',
          expectancy: '  Look for the need.  ',
          written_prompts: [{ id: 'w', prompt: 'Explain it', model_answer: 'Like this', max_words: 50 }],
        } as Partial<L>),
      ]),
      opts
    );
    expect(plan.lessons[0].expectancy).toBe('Look for the need.');
    expect(plan.lessons[0].written).toEqual([{ id: 'w', prompt: 'Explain it', model_answer: 'Like this', max_words: 50 }]);
  });

  it('leaves out lessons it cannot package, and says why', () => {
    const plan = buildExportPlan(
      tree([
        lesson({ title: 'Pkg', kind: 'scorm' }),
        lesson({ title: 'Empty' }),
        lesson({ title: 'Odd', sample_video_url: 'javascript:alert(1)' }),
        lesson({ title: 'Bunny', bunny_video_id: 'v' }),
      ]),
      { ...opts, cdnHost: null }
    );
    expect(plan.lessons).toEqual([]);
    expect(plan.skipped.map((s) => s.title)).toEqual(['Pkg', 'Empty', 'Odd', 'Bunny']);
  });
});

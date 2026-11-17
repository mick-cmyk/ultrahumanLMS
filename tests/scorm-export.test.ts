import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildPackageFiles, buildPackageZip, slug, type ExportCourse } from '@/lib/scorm/export';
import { parseManifest } from '@/lib/scorm/manifest';

const course = (over: Partial<ExportCourse> = {}): ExportCourse => ({
  id: '12345678-aaaa-bbbb-cccc-1234567890ab',
  title: 'Attach & sell: the $& way </script><script>alert(1)</script>',
  description: 'Short course',
  accent: '#ED4E05',
  accentText: '#14161a',
  lessons: [
    {
      id: 'l1',
      title: 'One',
      videoPath: 'media/lesson-1.mp4',
      video: new Uint8Array([1, 2, 3]),
      watchThreshold: 0.9,
      script: 'line one\nline two',
      quiz: {
        passMark: 0.8,
        questions: [{ id: 'q1', text: 'Pick $1', options: ['a', 'b'], correct_index: 1, explanation: 'Because' }],
      },
    },
    {
      id: 'l2',
      title: 'Two',
      videoPath: 'media/lesson-2.mp4',
      video: new Uint8Array([4, 5]),
      watchThreshold: 0.9,
      quiz: null,
    },
  ],
  ...over,
});

describe('SCORM export', () => {
  it('round-trips through our own importer', () => {
    const files = unzipSync(buildPackageZip(course()));
    const parsed = parseManifest(strFromU8(files['imsmanifest.xml']));
    expect(parsed.version).toBe('1.2');
    expect(parsed.launchHref).toBe('index.html');
    expect(parsed.scoCount).toBe(1);
    expect(parsed.title).toContain('Attach & sell');
    for (const f of ['index.html', 'player.js', 'player.css', 'media/lesson-1.mp4', 'media/lesson-2.mp4']) {
      expect(files[f], f).toBeDefined();
    }
    expect(Array.from(files['media/lesson-1.mp4'])).toEqual([1, 2, 3]);
  });

  it('lists every file in the manifest', () => {
    const files = buildPackageFiles(course());
    const xml = strFromU8(files['imsmanifest.xml']);
    for (const f of Object.keys(files).filter((f) => f !== 'imsmanifest.xml')) {
      expect(xml).toContain(`<file href="${f}"/>`);
    }
  });

  it('keeps course text inert: no script breakout, no $-pattern expansion', () => {
    const html = strFromU8(buildPackageFiles(course())['index.html']);
    // The title appears escaped in <title>/<h1> and as < in the JSON.
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('the $&amp; way');
    expect(html).toContain('Pick $1');
    // The embedded JSON parses back to exactly what went in.
    const json = /window\.COURSE = (.*);<\/script>/.exec(html)![1];
    const data = JSON.parse(json);
    expect(data.title).toBe(course().title);
    expect(data.lessons[0].quiz.questions[0].text).toBe('Pick $1');
    expect(data.lessons[1].quiz).toBeNull();
  });

  it('falls back to safe colours', () => {
    const html = strFromU8(buildPackageFiles(course({ accent: 'red;}body{display:none' }))['index.html']);
    expect(html).toContain('--accent:#14161a');
  });

  it('refuses an empty course', () => {
    expect(() => buildPackageFiles(course({ lessons: [] }))).toThrow(/no lessons/);
  });

  it('slugs titles for file names', () => {
    expect(slug('Attach-Selling: sell the full solution!')).toBe('attach-selling-sell-the-full-solution');
    expect(slug('***')).toBe('course');
  });
});

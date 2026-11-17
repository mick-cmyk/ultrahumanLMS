import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { buildPackageFiles, type ExportCourse } from '@/lib/scorm/export';
import { unpack } from '@/lib/scorm/unpack';

const course: ExportCourse = {
  id: '12345678-aaaa-bbbb-cccc-1234567890ab',
  title: 'Round trip',
  accent: '#0f766e',
  accentText: '#ffffff',
  lessons: [
    { id: 'l1', title: 'One', videoPath: 'media/lesson-1.mp4', video: new Uint8Array([9, 9]), watchThreshold: 0.9 },
  ],
};

const toBuf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe('unpack (admin import)', () => {
  it('accepts a package we exported ourselves', () => {
    const got = unpack(toBuf(zipSync(buildPackageFiles(course))));
    expect(got.manifest.launchHref).toBe('index.html');
    expect(got.files.map((f) => f.path).sort()).toEqual(
      ['imsmanifest.xml', 'index.html', 'media/lesson-1.mp4', 'player.css', 'player.js'].sort()
    );
    expect(got.totalBytes).toBeGreaterThan(0);
  });

  it('handles a zip wrapped in one top folder, and skips Mac junk', () => {
    const inner = buildPackageFiles(course);
    const wrapped: Record<string, Uint8Array> = { '__MACOSX/._index.html': strToU8('junk') };
    for (const [k, v] of Object.entries(inner)) wrapped[`My Course/${k}`] = v;
    const got = unpack(toBuf(zipSync(wrapped)));
    expect(got.files.some((f) => f.path === 'index.html')).toBe(true);
    expect(got.files.some((f) => f.path.includes('MACOSX'))).toBe(false);
  });

  it('refuses a zip-slip path', () => {
    const files = { ...buildPackageFiles(course), '../../evil.js': strToU8('x') };
    expect(() => unpack(toBuf(zipSync(files)))).toThrow(/unsafe path/);
  });

  it('refuses a package whose launch file is missing', () => {
    const files = buildPackageFiles(course);
    delete files['index.html'];
    expect(() => unpack(toBuf(zipSync(files)))).toThrow(/index\.html.*isn't in the zip/);
  });

  it('explains a zip with no manifest, and a file that is not a zip', () => {
    expect(() => unpack(toBuf(zipSync({ 'readme.txt': strToU8('hi') })))).toThrow(/No imsmanifest\.xml/);
    expect(() => unpack(toBuf(strToU8('definitely not a zip')))).toThrow(/isn't a zip/);
  });
});

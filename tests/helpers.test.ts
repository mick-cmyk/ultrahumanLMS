import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/safe-redirect';
import { toCsv } from '@/lib/csv';
import { contrast, deriveTokens, textOn } from '@/brands/colour';
import { contentTypeFor } from '@/lib/scorm/mime';

describe('safeNext (post-login redirect)', () => {
  it.each([
    [null, '/'],
    ['', '/'],
    ['/courses/abc', '/courses/abc'],
    ['/reports?x=1#top', '/reports?x=1#top'],
    ['https://evil.test', '/'],
    ['//evil.test/path', '/'],
    ['/\\evil.test', '/'],
    ['/%0d%0aSet-Cookie', '/%0d%0aSet-Cookie'], // encoded stays a harmless path
    ['/ok\nbad', '/'],
    ['javascript:alert(1)', '/'],
  ])('%s -> %s', (input, want) => {
    expect(safeNext(input)).toBe(want);
  });
});

describe('toCsv', () => {
  it('quotes commas, quotes and newlines and uses CRLF', () => {
    expect(toCsv(['name', 'note'], [['Ava, Jr', 'said "hi"'], ['Bo', 'line1\nline2'], ['Cy', null]])).toBe(
      'name,note\r\n"Ava, Jr","said ""hi"""\r\nBo,"line1\nline2"\r\nCy,'
    );
  });
});

describe('brand colours', () => {
  it('picks readable text on light and dark fills', () => {
    expect(textOn('#FFE600')).toBe('#14161a'); // JB yellow gets ink
    expect(textOn('#0f172a')).toBe('#ffffff');
  });

  it('derived tokens always meet AA where text is involved', () => {
    for (const primary of ['#ED4E05', '#FFE600', '#0f766e', '#2563eb', '#f5f5f5']) {
      const t = deriveTokens(primary);
      expect(contrast(t.brandInk, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.brand, t.brandFg)).toBeGreaterThanOrEqual(3); // large/bold button text
    }
  });
});

describe('contentTypeFor', () => {
  it('serves scripts, styles and media with the right type', () => {
    expect(contentTypeFor('a/b/app.js')).toMatch(/^text\/javascript/);
    expect(contentTypeFor('style.CSS')).toMatch(/^text\/css/);
    expect(contentTypeFor('index.html?x=1')).toMatch(/^text\/html/);
    expect(contentTypeFor('clip.mp4')).toBe('video/mp4');
    expect(contentTypeFor('mystery.bin')).toBe('application/octet-stream');
  });
});

import { describe, expect, it } from 'vitest';
import { isSafePackagePath, ManifestError, parseManifest } from '@/lib/scorm/manifest';

const manifest = (body: string, schemaversion = '1.2') => `<?xml version="1.0"?>
<manifest identifier="MAN1" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>${schemaversion}</schemaversion></metadata>
  ${body}
</manifest>`;

const simple = manifest(`
  <organizations default="ORG1">
    <organization identifier="ORG1">
      <title>Attach-selling basics</title>
      <item identifier="I1" identifierref="RES1">
        <title>Lesson one</title>
        <adlcp:masteryscore>80</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES1" type="webcontent" adlcp:scormtype="sco" href="index_lms.html">
      <file href="index_lms.html"/>
    </resource>
  </resources>`);

describe('parseManifest', () => {
  it('reads title, launch file and mastery score', () => {
    expect(parseManifest(simple)).toEqual({
      version: '1.2',
      title: 'Attach-selling basics',
      launchHref: 'index_lms.html',
      masteryScore: 80,
      scoCount: 1,
    });
  });

  it('uses the default organisation, not just the first', () => {
    const m = manifest(`
      <organizations default="B">
        <organization identifier="A"><title>Wrong</title><item identifier="i" identifierref="RA"/></organization>
        <organization identifier="B"><title>Right</title><item identifier="j" identifierref="RB"/></organization>
      </organizations>
      <resources>
        <resource identifier="RA" adlcp:scormtype="sco" href="a.html"/>
        <resource identifier="RB" adlcp:scormtype="sco" href="b.html"/>
      </resources>`);
    expect(parseManifest(m)).toMatchObject({ title: 'Right', launchHref: 'b.html' });
  });

  it('finds the first launchable item inside nested folders', () => {
    const m = manifest(`
      <organizations default="O">
        <organization identifier="O"><title>T</title>
          <item identifier="folder"><title>Folder</title>
            <item identifier="sco1" identifierref="R1"/>
            <item identifier="sco2" identifierref="R2"/>
          </item>
        </organization>
      </organizations>
      <resources>
        <resource identifier="R1" adlcp:scormtype="sco" href="one.html"/>
        <resource identifier="R2" adlcp:scormtype="sco" href="two.html"/>
      </resources>`);
    expect(parseManifest(m)).toMatchObject({ launchHref: 'one.html', scoCount: 2 });
  });

  it('applies xml:base and item parameters', () => {
    const m = manifest(`
      <organizations default="O"><organization identifier="O"><title>T</title>
        <item identifier="i" identifierref="R" parameters="?lang=en"/>
      </organization></organizations>
      <resources xml:base="content/">
        <resource identifier="R" adlcp:scormtype="sco" xml:base="m1/" href="start.html"/>
      </resources>`);
    expect(parseManifest(m).launchHref).toBe('content/m1/start.html?lang=en');
  });

  it('refuses SCORM 2004', () => {
    expect(() => parseManifest(manifest(simple.slice(0, 0) + '<organizations/>', '2004 4th Edition'))).toThrow(
      /SCORM 2004 4th Edition/
    );
  });

  it('refuses a launch path that leaves the package', () => {
    const m = manifest(`
      <organizations default="O"><organization identifier="O"><title>T</title>
        <item identifier="i" identifierref="R"/></organization></organizations>
      <resources><resource identifier="R" adlcp:scormtype="sco" href="../../secret.html"/></resources>`);
    expect(() => parseManifest(m)).toThrow(ManifestError);
  });

  it('explains a missing resource', () => {
    const m = manifest(`
      <organizations default="O"><organization identifier="O"><title>T</title>
        <item identifier="i" identifierref="NOPE"/></organization></organizations>
      <resources/>`);
    expect(() => parseManifest(m)).toThrow(/NOPE/);
  });

  it('rejects junk', () => {
    expect(() => parseManifest('not xml at all')).toThrow(ManifestError);
  });
});

describe('isSafePackagePath', () => {
  it.each([
    ['index.html', true],
    ['a/b/c.html?x=1', true],
    ['a/b/c.html?next=../x', true], // ".." only matters in the path part
    ['/abs.html', false],
    ['../up.html', false],
    ['a/../../up.html', false],
    ['http://evil.test/x', false],
    ['javascript:alert(1)', false],
    ['a\\b.html', false],
    ['', false],
  ])('%s -> %s', (p, ok) => {
    expect(isSafePackagePath(p)).toBe(ok);
  });
});

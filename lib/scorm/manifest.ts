// Reads a SCORM 1.2 package's imsmanifest.xml and works out what to launch.
// Runs in the browser (admin import page) and in Node (tests, export CLI), so
// it uses fast-xml-parser rather than DOMParser.

import { XMLParser } from 'fast-xml-parser';

export type ParsedManifest = {
  version: '1.2';
  /** Organisation title, else the first item title, else the manifest id. */
  title: string;
  /** Launch file path inside the package, e.g. "res/index.html". */
  launchHref: string;
  /** cmi.student_data.mastery_score (0-100) when the manifest sets one. */
  masteryScore: number | null;
  /** How many SCOs the default organisation lists. Only the first is launched. */
  scoCount: number;
};

export class ManifestError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true, // adlcp:scormtype -> scormtype, xml:base -> base
  isArray: (name) => ['organization', 'item', 'resource', 'file', 'dependency'].includes(name),
  trimValues: true,
});

type XmlNode = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : v && typeof v === 'object' && '#text' in v ? String((v as XmlNode)['#text']) : '';

/**
 * A launch path must stay inside the package: relative, no "..", no scheme,
 * no backslashes. Mirrors the check constraint on scorm_packages.launch_href.
 */
export function isSafePackagePath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(p)) return false;
  return !p.split(/[?#]/)[0].split('/').some((seg) => seg === '..');
}

function joinBase(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p : p.replace(/^\/+/, '')))
    .reduce((acc, p) => (acc && !acc.endsWith('/') ? `${acc}/${p}` : acc + p), '');
}

export function parseManifest(xml: string): ParsedManifest {
  let doc: XmlNode;
  try {
    doc = parser.parse(xml) as XmlNode;
  } catch {
    throw new ManifestError("The package's imsmanifest.xml isn't valid XML.");
  }
  const manifest = doc.manifest as XmlNode | undefined;
  if (!manifest) throw new ManifestError('No <manifest> element in imsmanifest.xml.');

  const metadata = manifest.metadata as XmlNode | undefined;
  const schemaVersion = text(metadata?.schemaversion).trim();
  // SCORM 2004 manifests say "2004 3rd Edition", "CAM 1.3" and so on.
  if (schemaVersion && !/^1\.2$/.test(schemaVersion)) {
    throw new ManifestError(
      `This is a SCORM ${schemaVersion} package. Only SCORM 1.2 can be imported for now.`
    );
  }

  const orgsNode = manifest.organizations as XmlNode | undefined;
  const orgs = asArray(orgsNode?.organization as XmlNode[] | undefined);
  if (orgs.length === 0) throw new ManifestError('The manifest lists no organisation (no course structure).');
  const defaultId = (orgsNode?.['@default'] as string | undefined) ?? '';
  const org = orgs.find((o) => o['@identifier'] === defaultId) ?? orgs[0];

  // Depth-first: the first item that points at a resource is what we launch.
  const scoItems: XmlNode[] = [];
  const walk = (items: XmlNode[]) => {
    for (const it of items) {
      if (it['@identifierref']) scoItems.push(it);
      walk(asArray(it.item as XmlNode[] | undefined));
    }
  };
  walk(asArray(org.item as XmlNode[] | undefined));
  if (scoItems.length === 0) throw new ManifestError('The manifest has no launchable item.');
  const first = scoItems[0];

  const resourcesNode = manifest.resources as XmlNode | undefined;
  const resources = asArray(resourcesNode?.resource as XmlNode[] | undefined);
  const res = resources.find((r) => r['@identifier'] === first['@identifierref']);
  if (!res) throw new ManifestError(`Item points at resource "${first['@identifierref']}", which isn't in the manifest.`);
  const href = res['@href'] as string | undefined;
  if (!href) throw new ManifestError('The launch resource has no href.');

  const manifestBase = (manifest['@base'] as string | undefined) ?? '';
  const resourcesBase = (resourcesNode?.['@base'] as string | undefined) ?? '';
  const resBase = (res['@base'] as string | undefined) ?? '';
  const params = (first['@parameters'] as string | undefined) ?? '';
  let launchHref = joinBase(manifestBase, resourcesBase, resBase, href);
  if (params) launchHref += params.startsWith('?') || params.startsWith('#') ? params : `?${params}`;

  if (!isSafePackagePath(launchHref)) {
    throw new ManifestError(`The launch path "${launchHref}" points outside the package.`);
  }

  const mastery = Number(text(first.masteryscore));
  const title = text(org.title) || text(first.title) || String(manifest['@identifier'] ?? 'SCORM package');

  return {
    version: '1.2',
    title: title.trim(),
    launchHref,
    masteryScore: Number.isFinite(mastery) && text(first.masteryscore) !== '' ? mastery : null,
    scoCount: scoItems.length,
  };
}

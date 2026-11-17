// Unzips a SCORM package in memory and checks it before anything is uploaded.
// Used by the admin import page (in the browser) and by the tests.

import { unzipSync } from 'fflate';
import { isSafePackagePath, ManifestError, parseManifest, type ParsedManifest } from './manifest';

export type Unpacked = {
  manifest: ParsedManifest;
  files: { path: string; data: Uint8Array }[];
  totalBytes: number;
};

const MAX_FILE = 50 * 1024 * 1024; // the 'scorm' bucket's per-file limit
const MAX_TOTAL = 500 * 1024 * 1024;
export const MB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Unzip in memory, find the manifest (at the root or inside one top folder). */
export function unpack(buf: ArrayBuffer): Unpacked {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buf), {
      filter: (f) => !f.name.endsWith('/') && !f.name.startsWith('__MACOSX/') && !f.name.endsWith('.DS_Store'),
    });
  } catch {
    throw new ManifestError("That file isn't a zip we can open.");
  }
  const names = Object.keys(entries);
  const manifestName =
    names.find((n) => n.toLowerCase() === 'imsmanifest.xml') ??
    names.find((n) => /^[^/]+\/imsmanifest\.xml$/i.test(n));
  if (!manifestName) {
    throw new ManifestError('No imsmanifest.xml in the zip. Is this a SCORM package?');
  }
  const prefix = manifestName.slice(0, manifestName.length - 'imsmanifest.xml'.length);
  const manifest = parseManifest(new TextDecoder().decode(entries[manifestName]));

  const files: Unpacked['files'] = [];
  let totalBytes = 0;
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const path = name.slice(prefix.length);
    if (!isSafePackagePath(path)) throw new ManifestError(`The zip contains an unsafe path: ${name}`);
    const data = entries[name];
    if (data.byteLength > MAX_FILE) throw new ManifestError(`${path} is ${MB(data.byteLength)}. Files over 50 MB can't be stored.`);
    totalBytes += data.byteLength;
    files.push({ path, data });
  }
  if (totalBytes > MAX_TOTAL) throw new ManifestError(`The package is ${MB(totalBytes)}. The limit is 500 MB.`);
  const launchPath = manifest.launchHref.split(/[?#]/)[0];
  if (!files.some((f) => f.path === launchPath)) {
    throw new ManifestError(`The manifest launches ${launchPath}, but that file isn't in the zip.`);
  }
  return { manifest, files, totalBytes };
}


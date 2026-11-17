// Content types for files served out of a SCORM package. Browsers refuse to
// run scripts or styles served with the wrong type, so this list matters.

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  xsd: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4v: 'video/mp4',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf',
  swf: 'application/x-shockwave-flash',
  wasm: 'application/wasm',
};

export function contentTypeFor(path: string): string {
  const ext = path.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  return TYPES[ext] ?? 'application/octet-stream';
}

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { contentTypeFor } from '@/lib/scorm/mime';

// Serves a SCORM package's files from this app's own origin. Same origin is
// required: a SCORM 1.2 package finds the run-time API by walking
// window.parent, which the browser blocks across origins.
//
// Access is decided by storage RLS, not here: the download runs as the
// logged-in user, and the 'scorm' bucket's select policy only returns files
// from packages used by a published course the user is assigned
// (20261118000100_scorm.sql). No service role.
//
// Trust note: package files run as same-origin pages, so a package can do what
// app pages can. Only admins can upload packages; treat a package like code
// you're deploying.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string; path: string[] }> }
) {
  const { packageId, path } = await params;
  if (!UUID.test(packageId) || !path?.length) {
    return new NextResponse('Not found', { status: 404 });
  }
  // Next decodes segments; refuse anything that could climb out of the package.
  if (path.some((seg) => !seg || seg === '.' || seg === '..' || seg.includes('\\'))) {
    return new NextResponse('Not found', { status: 404 });
  }
  const objectPath = `${packageId.toLowerCase()}/${path.join('/')}`;

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from('scorm').download(objectPath);
  if (error || !data) {
    return new NextResponse('Not found', { status: 404 });
  }

  const type = contentTypeFor(objectPath);
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };

  // Byte ranges, so videos inside a package can seek.
  const size = data.size;
  const range = request.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    return new NextResponse(data.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }

  return new NextResponse(data, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
}

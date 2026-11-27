import 'server-only';
import { revalidateTag } from 'next/cache';
import { bunnyCdnHost } from './bunny';

// Video thumbnails come from Bunny, where they live with the video:
//  - every video gets an automatic thumbnail plus five frames to choose from
//    (thumbnail_1.jpg to thumbnail_5.jpg);
//  - a custom picture or a chosen frame is uploaded to Bunny, which gives it a
//    new file name (so no cache ever shows the old one);
//  - a frame chosen in Bunny's own dashboard is picked up the same way.
// The current file name for each video comes from one cached call to Bunny's
// video list. Images load straight from Bunny's CDN in the browser, which
// only serves them to the site's own pages (allowed-domain protection), so
// they do not show on localhost for client libraries, just like the videos.

const TAG = 'bunny-videos';
export const FRAME_COUNT = 5;

type BunnyListItem = { guid: string; thumbnailFileName?: string | null; status?: number };

async function listVideos(): Promise<BunnyListItem[]> {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libraryId || !apiKey) return [];
  const items: BunnyListItem[] = [];
  try {
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(
        `https://video.bunnycdn.com/library/${encodeURIComponent(libraryId)}/videos?page=${page}&itemsPerPage=100&orderBy=date`,
        { headers: { AccessKey: apiKey, accept: 'application/json' }, next: { revalidate: 300, tags: [TAG] } }
      );
      if (!res.ok) break;
      const body = (await res.json()) as { items?: BunnyListItem[]; totalItems?: number };
      items.push(...(body.items ?? []));
      if (!body.items?.length || items.length >= (body.totalItems ?? 0)) break;
    }
  } catch {
    // Thumbnails are a nicety: no Bunny, no pictures, nothing breaks.
  }
  return items;
}

/** video id -> thumbnail URL, for every finished video in the library. */
export async function videoThumbnails(): Promise<Map<string, string>> {
  const items = await listVideos();
  const map = new Map<string, string>();
  if (items.length === 0) return map;
  const host = await bunnyCdnHost(items[0].guid);
  if (!host) return map;
  for (const v of items) {
    if (v.status !== 4 || !v.thumbnailFileName) continue;
    map.set(v.guid.toLowerCase(), `https://${host}/${v.guid}/${v.thumbnailFileName}`);
  }
  return map;
}

/** The five frames Bunny made from the video, for "Pick a frame". */
export async function videoFrames(videoId: string): Promise<string[]> {
  const host = await bunnyCdnHost(videoId);
  if (!host) return [];
  return Array.from({ length: FRAME_COUNT }, (_, i) => `https://${host}/${videoId}/thumbnail_${i + 1}.jpg`);
}

/** Forget the cached video list so a new thumbnail shows straight away. */
export function forgetVideoList() {
  revalidateTag(TAG, { expire: 0 });
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

/** Upload an image to Bunny as the video's thumbnail. */
export async function setVideoThumbnail(
  videoId: string,
  image: ArrayBuffer,
  type: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libraryId || !apiKey) return { ok: false, error: 'Bunny is not set up on this site yet.' };
  if (!IMAGE_TYPES.includes(type)) return { ok: false, error: 'Use a JPG, PNG or WebP picture.' };
  if (image.byteLength === 0 || image.byteLength > MAX_THUMBNAIL_BYTES) {
    return { ok: false, error: 'That picture is too big. Try a smaller one.' };
  }
  try {
    const res = await fetch(
      `https://video.bunnycdn.com/library/${encodeURIComponent(libraryId)}/videos/${encodeURIComponent(videoId)}/thumbnail`,
      { method: 'POST', headers: { AccessKey: apiKey, 'content-type': type }, body: image, cache: 'no-store' }
    );
    if (res.status === 404) return { ok: false, error: 'Bunny could not find this video.' };
    if (!res.ok) return { ok: false, error: 'Bunny did not accept the picture. Try again.' };
  } catch {
    return { ok: false, error: 'Could not reach Bunny. Try again.' };
  }
  forgetVideoList();
  return { ok: true };
}

/** Use one of Bunny's five frames (1 to 5) as the thumbnail. */
export async function setVideoFrame(videoId: string, frame: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(frame) || frame < 1 || frame > FRAME_COUNT) return { ok: false, error: 'Pick one of the frames.' };
  const [url] = (await videoFrames(videoId)).slice(frame - 1, frame);
  if (!url) return { ok: false, error: 'Could not find the frames for this video.' };
  // Bunny only serves its files to the site's own pages, so say where we are.
  const site = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  try {
    const res = await fetch(url, { headers: site ? { Referer: `${site}/` } : {}, cache: 'no-store' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return { ok: false, error: 'Could not fetch that frame from Bunny.' };
    return setVideoThumbnail(videoId, await res.arrayBuffer(), 'image/jpeg');
  } catch {
    return { ok: false, error: 'Could not reach Bunny. Try again.' };
  }
}

/** Public URL for a course cover stored in Supabase Storage. */
export function coverUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base) return null;
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/course-covers/${path}`;
}

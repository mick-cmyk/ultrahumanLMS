import { createHash } from 'crypto';

// Signed Bunny Stream embed URL, so videos can't be shared outside the app.
// Token scheme per Bunny docs: SHA256_hex(security_key + video_id + expires).
// Returns null when Bunny isn't configured yet (or the lesson still has a
// placeholder video id) so the lesson page can show a tidy placeholder.
export function signedEmbedUrl(videoId: string | null): string | null {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const securityKey = process.env.BUNNY_STREAM_EMBED_TOKEN_KEY;

  if (!libraryId || !securityKey || !videoId || videoId.startsWith('REPLACE')) {
    return null;
  }

  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 4; // 4 hours
  const token = createHash('sha256')
    .update(securityKey + videoId + expires)
    .digest('hex');

  return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?token=${token}&expires=${expires}&autoplay=false`;
}

// Can this site play Bunny videos at all?
export function bunnyConfigured(): boolean {
  return Boolean(process.env.BUNNY_STREAM_LIBRARY_ID && process.env.BUNNY_STREAM_EMBED_TOKEN_KEY);
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Accepts whatever an admin is likely to paste from Bunny: the bare video ID,
// an embed or play link (iframe.mediadelivery.net/embed/<library>/<video>), a
// dashboard link (...?videoId=<video>), or a whole <iframe> snippet.
export function parseBunnyVideo(input: string): { videoId: string; libraryId: string | null } | null {
  const s = input.trim();
  if (!s) return null;
  const path = s.match(/\/(?:embed|play)\/(\d+)\/([0-9a-f-]{36})/i);
  if (path && GUID.test(path[2])) return { videoId: path[2].toLowerCase(), libraryId: path[1] };
  const query = s.match(/[?&]videoId=([0-9a-f-]{36})/i);
  const lib = s.match(/\/stream\/(\d+)\//) ?? s.match(/\/library\/(\d+)\//);
  if (query && GUID.test(query[1])) return { videoId: query[1].toLowerCase(), libraryId: lib?.[1] ?? null };
  const bare = s.match(GUID);
  if (bare && bare[0].length === s.length) return { videoId: bare[0].toLowerCase(), libraryId: null };
  return null;
}

export type BunnyVideoInfo = {
  title: string;
  lengthSeconds: number;
  // Bunny status 4 = finished encoding, 5 = failed; anything else is still working.
  ready: boolean;
  failed: boolean;
  /** Width / height, when Bunny knows it (portrait clips are below 1). */
  aspect: number | null;
};

// Looks the video up in the library to fill in its length. Needs the library's
// API key (BUNNY_STREAM_API_KEY, server only). Without it the admin types the
// length in instead, so this is a convenience, never a requirement.
export async function fetchBunnyVideo(
  videoId: string
): Promise<{ ok: true; info: BunnyVideoInfo } | { ok: false; reason: 'not-configured' | 'not-found' | 'error' }> {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libraryId || !apiKey) return { ok: false, reason: 'not-configured' };
  try {
    const res = await fetch(
      `https://video.bunnycdn.com/library/${encodeURIComponent(libraryId)}/videos/${encodeURIComponent(videoId)}`,
      { headers: { AccessKey: apiKey, accept: 'application/json' }, cache: 'no-store' }
    );
    if (res.status === 404) return { ok: false, reason: 'not-found' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const v = (await res.json()) as { title?: string; length?: number; status?: number; width?: number; height?: number };
    const aspect = v.width && v.height ? Math.round((v.width / v.height) * 10000) / 10000 : null;
    return {
      ok: true,
      info: {
        title: v.title ?? '',
        lengthSeconds: Math.round(v.length ?? 0),
        ready: v.status === 4,
        failed: v.status === 5,
        aspect: aspect && aspect > 0.2 && aspect < 5 ? aspect : null,
      },
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

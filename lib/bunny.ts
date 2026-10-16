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

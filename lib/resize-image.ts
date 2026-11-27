// Shrink and compress a picture in the browser before it is uploaded, so a
// large phone photo or design file becomes a small, quick-loading image.
// The picture is cropped from the centre to the shape asked for: 16:9 by
// default, or the video's own shape (9:16 for upright phone videos). The
// longer side ends up at most `long` pixels.

export async function resizeToAspect(
  file: File,
  {
    aspect = 16 / 9,
    long = 1280,
    type = 'image/jpeg',
    quality = 0.82,
  }: { aspect?: number; long?: number; type?: 'image/jpeg' | 'image/webp'; quality?: number } = {}
): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture (JPG, PNG or WebP).');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Could not open that picture. Try a JPG or PNG.');
  });
  // Crop the source to the chosen shape around its centre.
  const srcRatio = bitmap.width / bitmap.height;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (srcRatio > aspect) sw = Math.round(sh * aspect);
  else sh = Math.round(sw / aspect);
  const sx = Math.round((bitmap.width - sw) / 2);
  const sy = Math.round((bitmap.height - sh) / 2);

  // Never enlarge a small picture.
  const scale = Math.min(1, long / Math.max(sw, sh));
  const outW = Math.round(sw * scale);
  const outH = Math.round(sh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not prepare the picture.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // Some browsers quietly fall back to PNG for formats they can't write.
  if (!blob || blob.type !== type) throw new Error('Your browser could not prepare the picture.');
  return new File([blob], type === 'image/webp' ? 'picture.webp' : 'picture.jpg', { type });
}

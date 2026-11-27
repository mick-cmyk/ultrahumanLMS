// Shrink and compress a picture in the browser before it is uploaded, so a
// large phone photo or design file becomes a small, quick-loading 16:9 image.
// The picture is cropped to fill 16:9 from the centre.

export async function resizeTo16x9(
  file: File,
  { width = 1280, type = 'image/jpeg', quality = 0.82 }: { width?: number; type?: 'image/jpeg' | 'image/webp'; quality?: number } = {}
): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture (JPG, PNG or WebP).');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Could not open that picture. Try a JPG or PNG.');
  });
  // Crop the source to 16:9 around its centre.
  const srcRatio = bitmap.width / bitmap.height;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (srcRatio > 16 / 9) sw = Math.round(sh * (16 / 9));
  else sh = Math.round(sw * (9 / 16));
  const sx = Math.round((bitmap.width - sw) / 2);
  const sy = Math.round((bitmap.height - sh) / 2);

  // Never enlarge a small picture.
  const outW = Math.min(width, sw);
  const outH = Math.round((outW * 9) / 16);

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

import sharp from 'sharp';

export async function normalizePhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('invalid-image');
  const source = sharp(bytes, { limitInputPixels: 25_000_000, failOn: 'warning' });
  const metadata = await source.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) !== 1) throw new Error('invalid-image');
  // Decode and re-encode: no EXIF/location or original filename leaves the backend.
  return source.rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

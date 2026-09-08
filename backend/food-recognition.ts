import { readFileSync } from 'node:fs';
import { detectionSchema, rankFoodCandidates } from '../shared/food-recognition';
import { normalizePhoto } from './photo-image';

export { rankFoodCandidates };
export async function recognizePhoto(bytes: Buffer) {
  const image = await normalizePhoto(bytes);
  // Fixed loopback endpoint reached through authenticated SSH reverse forwarding.
  // Neither callers nor model output can supply URLs or model names.
  const tokenFile = process.env.NUTRI_VISION_TOKEN_FILE;
  if (!tokenFile) throw new Error('unavailable');
  const token = readFileSync(tokenFile, 'utf8').trim();
  const response = await fetch('http://127.0.0.1:11435/recognize', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: new Uint8Array(image), signal: AbortSignal.timeout(95_000), redirect: 'error',
  });
  if (!response.ok) throw new Error('unavailable');
  const body = await response.text();
  if (body.length > 12000) throw new Error('unavailable');
  return detectionSchema.parse(JSON.parse(body));
}

import { readFileSync } from 'node:fs';
import { detectionSchema, rerankSchema, type DetectedFood } from '../shared/food-recognition';
export { deduplicateDetections, decideMatch, detectedMeatFamily, foodMatchesMeatFamily, MATCH_THRESHOLDS, needsMeatConfirmation, needsMeatFamilyConfirmation, rankFoodCandidates, rankSemanticFoodCandidates, recognitionFoodName, refineMeatFamily, resolveFoodCandidates, selectDistinctFoodCandidates } from '../shared/food-recognition';

export type VisionTelemetry={model:string;reasoningEffort:string;latencyMs:number;inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;totalTokens:number|null};
function credentials(){const path=process.env.NUTRI_VISION_TOKEN_FILE;if(!path)throw new Error('unavailable');return readFileSync(path,'utf8').trim()}
async function request(path:string,body:BodyInit,contentType:string,timeout=95_000){const response=await fetch(`http://127.0.0.1:11435${path}`,{method:'POST',headers:{Authorization:`Bearer ${credentials()}`,'Content-Type':contentType},body,signal:AbortSignal.timeout(timeout),redirect:'error'});if(!response.ok)throw new Error('unavailable');const text=await response.text();if(text.length>16000)throw new Error('unavailable');return JSON.parse(text) as unknown}

export async function recognizePhoto(bytes:Buffer){const raw=await request('/recognize',new Uint8Array(bytes),'image/jpeg') as {detection:unknown;telemetry:VisionTelemetry};return{detection:detectionSchema.parse(raw.detection),telemetry:raw.telemetry}}
export async function rerankPhoto(image:Buffer,detected:DetectedFood,candidates:string[]){const raw=await request('/rerank',JSON.stringify({image:image.toString('base64'),detected,candidates}),'application/json') as {decision:unknown;telemetry:VisionTelemetry};return{decision:rerankSchema.parse(raw.decision),telemetry:raw.telemetry}}

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { closeDatabase } from '../../backend/db';
import { tbcaCandidatesForDetection,tbcaCandidatesForMeatFamily } from '../../backend/food-identity-repository';
import { normalizePhoto } from '../../backend/photo-image';
import {
  canonicalQueries,
  deduplicateDetections,
  detectionSchema,
  foodMatchesMeatFamily,
  needsMeatFamilyConfirmation,
  refineMeatFamily,
  resolveFoodCandidates,
  type MeatFamily,
} from '../../shared/food-recognition';

type ManifestCase = {
  image: string;
  required?: string[][];
  forbidden?: string[][];
  minimumComponents?: number;
  meatFamilyExpectation?: { direct: string[]; ambiguous: string[]; family: MeatFamily };
};

type Manifest = { cases: ManifestCase[] };

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function semanticText(item: { name: string; preparation?: string | null; visibleDetails: string[] }) {
  return normalize([item.name, item.preparation ?? '', ...item.visibleDetails].join(' '));
}

function matchesAny(text: string, alternatives: string[]) {
  return alternatives.some((alternative) => text.includes(normalize(alternative)));
}

const directoryArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--') && argument !== option('--output') && argument !== option('--manifest'));
if (!directoryArgument) throw new Error('Uso: npm run vision:test-real -- <diretório> [--manifest arquivo.json] [--output resultado.json]');

const imageDirectory = resolve(directoryArgument);
const outputPath = resolve(option('--output') ?? `.codex-local/food-vision-real/${Date.now()}-result.json`);
const manifestPath = option('--manifest') ? resolve(option('--manifest')!) : null;
const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest : null;
const tokenPath = resolve(process.env.NUTRI_VISION_TOKEN_FILE ?? '.codex-local/vision-token');
const token = readFileSync(tokenPath, 'utf8').trim();
const endpoint = process.env.NUTRI_VISION_URL ?? 'http://127.0.0.1:11435';
const imageFiles = readdirSync(imageDirectory)
  .filter((file) => ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(file).toLowerCase()))
  .sort((left, right) => left.localeCompare(right, 'pt-BR'));

if (!imageFiles.length) throw new Error(`Nenhuma imagem encontrada em ${imageDirectory}`);

const cases: Array<Record<string, unknown>> = [];
try {
  for (const file of imageFiles) {
    const source = readFileSync(resolve(imageDirectory, file));
    const image = await normalizePhoto(source);
    const totalStarted = performance.now();
    const visionStarted = performance.now();
    const response = await fetch(`${endpoint}/recognize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
      body: new Uint8Array(image),
      signal: AbortSignal.timeout(100_000),
    });
    if (!response.ok) throw new Error(`${file}: gateway HTTP ${response.status} ${await response.text()}`);
    const raw = await response.json() as { detection: unknown; telemetry: unknown };
    const visionMs = performance.now() - visionStarted;
    const parsed = detectionSchema.parse(raw.detection);
    const deduplicated = deduplicateDetections(parsed.items);
    const items = [];
    let retrievalMs = 0;
    let matcherMs = 0;
    for (const item of deduplicated) {
      const retrievalStarted = performance.now();
      const foods = await tbcaCandidatesForDetection(item);
      retrievalMs += performance.now() - retrievalStarted;
      const matcherStarted = performance.now();
      const resolution = resolveFoodCandidates(item, foods);
      matcherMs += performance.now() - matcherStarted;
      items.push({
        detected: item,
        matcherQueries: canonicalQueries(item),
        retrievedFoods: foods.length,
        decision: resolution.decision,
        candidates: resolution.candidates.map((match) => ({
          code: match.food.source_code,
          name: match.food.displayName,
          score: match.matchConfidence,
          contradictions: match.contradictions,
          materialUnknowns: match.materialUnknowns,
        })),
        rankedTop5: resolution.ranked.slice(0, 5).map((match) => ({
          code: match.food.source_code,
          name: match.food.displayName,
          score: match.matchConfidence,
        })),
      });
    }

    const expectation = manifest?.cases.find((entry) => entry.image === file);
    let meatFamilyCheck:Record<string,unknown>|null=null;
    if(expectation?.meatFamilyExpectation){
      const expected=expectation.meatFamilyExpectation;
      const direct=deduplicated.some(item=>matchesAny(semanticText(item),expected.direct));
      const ambiguous=deduplicated.find(item=>needsMeatFamilyConfirmation(item)&&matchesAny(semanticText(item),expected.ambiguous));
      if(direct)meatFamilyCheck={acceptable:true,path:'direct'};
      else if(ambiguous){
        const refined=refineMeatFamily(ambiguous,expected.family);
        const retrieved=(await tbcaCandidatesForMeatFamily(expected.family)).filter(food=>foodMatchesMeatFamily(food,expected.family));
        const resolution=resolveFoodCandidates(refined,retrieved);
        const candidates=resolution.candidates.map(match=>({code:match.food.source_code,name:match.food.displayName,score:match.matchConfidence}));
        meatFamilyCheck={acceptable:candidates.length>0&&candidates.length<=3&&resolution.candidates.every(match=>foodMatchesMeatFamily(match.food,expected.family)),path:'ASK_MEAT_FAMILY',family:expected.family,state:resolution.decision.state,candidates};
      }else meatFamilyCheck={acceptable:false,path:'missing_component'};
    }

    const texts = deduplicated.map(semanticText);
    const checks = expectation ? {
      minimumComponents: deduplicated.length >= (expectation.minimumComponents ?? 0),
      required: (expectation.required ?? []).map((alternatives) => ({ alternatives, found: texts.some((text) => matchesAny(text, alternatives)) })),
      forbidden: (expectation.forbidden ?? []).map((alternatives) => ({ alternatives, absent: texts.every((text) => !matchesAny(text, alternatives)) })),
      meatFamily:meatFamilyCheck,
    } : null;
    const passed = checks == null || (
      checks.minimumComponents
      && checks.required.every((entry) => entry.found)
      && checks.forbidden.every((entry) => entry.absent)
      && (checks.meatFamily==null||checks.meatFamily.acceptable===true)
    );

    cases.push({
      image: file,
      sha256: createHash('sha256').update(source).digest('hex'),
      sourceBytes: source.length,
      normalizedBytes: image.length,
      rawDetection: raw.detection,
      telemetry: raw.telemetry,
      deduplicated,
      items,
      checks,
      passed,
      timingMs: {
        visionRequest: Number(visionMs.toFixed(1)),
        retrieval: Number(retrievalMs.toFixed(1)),
        matcher: Number(matcherMs.toFixed(1)),
        total: Number((performance.now() - totalStarted).toFixed(1)),
      },
    });
  }
} finally {
  await closeDatabase();
}

const result = {
  generatedAt: new Date().toISOString(),
  sourceDirectory: imageDirectory,
  manifest: manifestPath ? basename(manifestPath) : null,
  providerCalls: imageFiles.length,
  cases,
  passed: cases.every((test) => test.passed === true),
};
mkdirSync(resolve(outputPath, '..'), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, providerCalls: result.providerCalls, passed: result.passed, cases: cases.map((test) => ({ image: test.image, passed: test.passed, timingMs: test.timingMs })) }, null, 2));
if (!result.passed) process.exitCode = 1;

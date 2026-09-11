import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { closeDatabase } from '../../backend/db';
import { tbcaCandidatesForDetection } from '../../backend/food-identity-repository';
import { deduplicateDetections, detectionSchema, resolveFoodCandidates } from '../../shared/food-recognition';

type StoredPredictions = {
  variant?: string;
  model?: string;
  cases: Array<{
    id: string;
    items: Array<{ detected: unknown }>;
  }>;
};

function percentile(values: number[], percentileValue: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)] ?? 0;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

const predictionsArgument = process.argv.find((argument) => !argument.startsWith('--') && argument !== process.argv[0] && argument !== process.argv[1]);
if (!predictionsArgument) throw new Error('Informe o arquivo de predições: npm run vision:replay-matcher -- caminho/predictions.json');

const includeDetails = process.argv.includes('--details');
const predictionsPath = resolve(predictionsArgument);
const predictions = JSON.parse(readFileSync(predictionsPath, 'utf8')) as StoredPredictions;
if (!Array.isArray(predictions.cases)) throw new Error('Arquivo de predições inválido: cases ausente.');

const retrievalLatency: number[] = [];
const matcherLatency: number[] = [];
const rows: Array<Record<string, unknown>> = [];

try {
  for (const test of predictions.cases) {
    const parsed = detectionSchema.parse({ items: test.items.map((entry) => entry.detected) });
    const detections = deduplicateDetections(parsed.items);
    for (const item of detections) {
      const retrievalStarted = performance.now();
      const foods = await tbcaCandidatesForDetection(item);
      retrievalLatency.push(performance.now() - retrievalStarted);

      const matcherStarted = performance.now();
      const resolution = resolveFoodCandidates(item, foods);
      matcherLatency.push(performance.now() - matcherStarted);

      rows.push({
        caseId: test.id,
        label: item.name,
        preparation: item.preparation,
        state: resolution.decision.state,
        candidateCount: resolution.candidates.length,
        candidates: resolution.candidates.map((match) => ({
          code: match.food.source_code,
          name: match.food.displayName,
          score: match.matchConfidence,
        })),
      });
    }
  }

  const states = Object.fromEntries(
    [...new Set(rows.map((row) => String(row.state)))].sort().map((state) => [state, rows.filter((row) => row.state === state).length]),
  );
  const candidateLimitViolations = rows.filter((row) => Number(row.candidateCount) > 3);
  const report = {
    apiCalls: 0,
    purpose: 'technical_replay_without_accuracy_calibration',
    source: { path: predictionsPath, variant: predictions.variant ?? null, model: predictions.model ?? null },
    cases: predictions.cases.length,
    detections: rows.length,
    states,
    maxCandidateCount: Math.max(0, ...rows.map((row) => Number(row.candidateCount))),
    candidateLimitViolations: candidateLimitViolations.length,
    casesWithMultipleDetections: new Set(rows.map((row) => String(row.caseId)).filter((caseId) => rows.filter((row) => row.caseId === caseId).length > 1)).size,
    retrievalMs: {
      mean: Number(mean(retrievalLatency).toFixed(3)),
      p50: Number(percentile(retrievalLatency, 0.5).toFixed(3)),
      p95: Number(percentile(retrievalLatency, 0.95).toFixed(3)),
    },
    matcherMs: {
      mean: Number(mean(matcherLatency).toFixed(3)),
      p50: Number(percentile(matcherLatency, 0.5).toFixed(3)),
      p95: Number(percentile(matcherLatency, 0.95).toFixed(3)),
    },
    ...(includeDetails ? { items: rows } : {}),
  };
  console.log(JSON.stringify(report, null, 2));
  if (candidateLimitViolations.length) process.exitCode = 1;
} finally {
  await closeDatabase();
}

import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { closeDatabase, migrate } from '../../backend/db';
import { tbcaCandidatesForDetection } from '../../backend/food-identity-repository';
import { decideMatch, rankSemanticFoodCandidates } from '../../shared/food-recognition';

const root = 'tests/food-vision-benchmark/datasets/synthetic-v2-pilot-20';
const audit = JSON.parse(readFileSync(`${root}/ground-truth.audit.json`, 'utf8'));
const predictions = JSON.parse(readFileSync(`${root}/predictions-luna-baseline.json`, 'utf8'));
const association: Record<string, (number | null)[]> = {
  'food-001': [0], 'food-002': [0], 'food-003': [0], 'food-004': [0], 'food-005': [0],
  'food-006': [0], 'food-007': [0], 'food-008': [2, 0, 1, 3, 4, 5], 'food-009': [null],
  'food-010': [0, 1, 2, 3, 4, 5], 'food-011': [0], 'food-012': [0], 'food-013': [0],
  'food-014': [0], 'food-015': [0], 'food-016': [0], 'food-017': [0], 'food-018': [0, 1, 2],
  'food-019': [0], 'food-020': [0],
};

function percentile(values: number[], percentileValue: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)] ?? 0;
}

await migrate();
try {
  const rows: any[] = [];
  const retrievalLatency: number[] = [];
  const matcherLatency: number[] = [];
  for (const test of audit.cases) {
    const prediction = predictions.cases.find((entry: any) => entry.id === test.id);
    for (const [index, expected] of test.expectedFoods.entries()) {
      const predictionIndex = association[test.id][index];
      if (predictionIndex == null) {
        rows.push({ id: test.id, expectedLabel: expected.expectedLabel, resolved: Boolean(expected.tbcaCode), missing: true, state: 'MISSING', top1Acceptable: false, top3Acceptable: false, top5Acceptable: false, autoCorrect: false });
        continue;
      }
      const item = prediction.items[predictionIndex].detected;
      const retrievalStarted = performance.now();
      const foods = await tbcaCandidatesForDetection(item);
      retrievalLatency.push(performance.now() - retrievalStarted);
      const matcherStarted = performance.now();
      const matches = rankSemanticFoodCandidates(item, foods, 5);
      matcherLatency.push(performance.now() - matcherStarted);
      const decision = decideMatch(item, matches);
      const allowed = new Set(expected.tbcaCode ? [expected.tbcaCode, ...expected.acceptableCodes] : []);
      rows.push({
        id: test.id,
        expectedLabel: expected.expectedLabel,
        resolved: Boolean(expected.tbcaCode),
        state: decision.state,
        policy: decision.policy,
        topCodes: matches.map((match) => match.food.source_code),
        top1Acceptable: Boolean(expected.tbcaCode && allowed.has(matches[0]?.food.source_code)),
        top3Acceptable: Boolean(expected.tbcaCode && matches.slice(0, 3).some((match) => allowed.has(match.food.source_code))),
        top5Acceptable: Boolean(expected.tbcaCode && matches.some((match) => allowed.has(match.food.source_code))),
        autoCorrect: decision.state === 'AUTOSELECT' && allowed.has(matches[0]?.food.source_code),
        retrieved: foods.length,
      });
    }
  }
  const resolved = rows.filter((row) => row.resolved);
  const ambiguous = rows.filter((row) => row.resolved === false);
  const report = {
    apiCalls: 0,
    matcherRevision: 'semantic-identity-v2-working-tree',
    denominators: { expectedVisual: 32, resolvedTbca: resolved.length, ambiguousVisualOnly: ambiguous.length },
    retrieval: {
      meanMs: retrievalLatency.reduce((sum, value) => sum + value, 0) / retrievalLatency.length,
      p95Ms: percentile(retrievalLatency, 0.95),
    },
    matcher: {
      meanMs: matcherLatency.reduce((sum, value) => sum + value, 0) / matcherLatency.length,
      p95Ms: percentile(matcherLatency, 0.95),
    },
    results: {
      top1Acceptable: resolved.filter((row) => row.top1Acceptable).length,
      top3Acceptable: resolved.filter((row) => row.top3Acceptable).length,
      top5Acceptable: resolved.filter((row) => row.top5Acceptable).length,
      autoselect: resolved.filter((row) => row.state === 'AUTOSELECT').length,
      autoselectCorrect: resolved.filter((row) => row.autoCorrect).length,
      rerank: resolved.filter((row) => row.state === 'RERANK').length,
      ambiguousAbstained: ambiguous.filter((row) => row.state === 'NO_EXACT_TBCA_MATCH').length,
      missingVisual: rows.filter((row) => row.missing).length,
    },
    rows,
  };
  writeFileSync(`${root}/report-semantic-identity-v2-db.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ denominators: report.denominators, retrieval: report.retrieval, matcher: report.matcher, results: report.results }, null, 2));
} finally {
  await closeDatabase();
}

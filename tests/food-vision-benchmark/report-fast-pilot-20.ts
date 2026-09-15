import { readFileSync, writeFileSync } from 'node:fs';

const root = 'tests/food-vision-benchmark/datasets/synthetic-v2-pilot-20';
const audit = JSON.parse(readFileSync(`${root}/ground-truth.audit.json`, 'utf8'));
const predictions = JSON.parse(readFileSync(`${root}/predictions-luna-fast-none-low.json`, 'utf8'));
const association: Record<string, (number | null)[]> = {
  'food-001':[0], 'food-002':[0], 'food-003':[0], 'food-004':[0], 'food-005':[0],
  'food-006':[0], 'food-007':[0], 'food-008':[2,0,1,3,null,null], 'food-009':[0],
  'food-010':[0,1,2,3,4,5], 'food-011':[0], 'food-012':[0], 'food-013':[0],
  'food-014':[0], 'food-015':[0], 'food-016':[0], 'food-017':[0], 'food-018':[0,1,2],
  'food-019':[0], 'food-020':[0],
};
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const percent = (count: number, denominator: number) => denominator ? Number((count / denominator * 100).toFixed(2)) : 0;
const latency = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const pick = (p: number) => Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0);
  return { meanMs: Math.round(sum(values) / (values.length || 1)), p50Ms: pick(.5), p95Ms: pick(.95), maxMs: Math.round(Math.max(0, ...values)) };
};

let visualMatched = 0;
let visualMissing = 0;
let extras = 0;
const components: any[] = [];
for (const test of audit.cases) {
  const result = predictions.cases.find((entry: any) => entry.id === test.id);
  const links = association[test.id];
  if (!result || !links || links.length !== test.expectedFoods.length) throw new Error(`Associação inválida: ${test.id}`);
  const used = new Set<number>();
  for (const [expectedIndex, expected] of test.expectedFoods.entries()) {
    const predictionIndex = links[expectedIndex];
    const item = predictionIndex == null ? null : result.items[predictionIndex];
    if (predictionIndex == null) visualMissing += 1;
    else {
      if (used.has(predictionIndex)) throw new Error(`Predição reutilizada: ${test.id}/${predictionIndex}`);
      used.add(predictionIndex);
      visualMatched += 1;
    }
    const allowed = new Set(expected.tbcaCode ? [expected.tbcaCode, ...expected.acceptableCodes] : []);
    components.push({
      id: test.id,
      expectedLabel: expected.expectedLabel,
      resolved: Boolean(expected.tbcaCode),
      predictionIndex,
      detectedName: item?.detected?.name ?? null,
      state: item?.state ?? 'MISSING',
      selectedCode: item?.selectedCode ?? null,
      topCodes: item?.topCodes ?? [],
      top1Acceptable: Boolean(expected.tbcaCode && allowed.has(item?.topCodes?.[0])),
      top3Acceptable: Boolean(expected.tbcaCode && item?.topCodes?.slice(0, 3).some((code: string) => allowed.has(code))),
      top5Acceptable: Boolean(expected.tbcaCode && item?.topCodes?.some((code: string) => allowed.has(code))),
      autoCorrect: Boolean(expected.tbcaCode && item?.state === 'AUTOSELECT' && allowed.has(item?.selectedCode)),
    });
  }
  extras += result.items.length - used.size;
}
const resolved = components.filter((item) => item.resolved);
const auto = resolved.filter((item) => item.state === 'AUTOSELECT');
const needsChoice = resolved.filter((item) => ['ASK_ATTRIBUTE', 'ASK_IDENTITY'].includes(item.state));
const telemetries = predictions.cases.map((entry: any) => entry.telemetry);
const report = {
  configuration: { variant: predictions.variant, model: predictions.model, reasoningEffort: predictions.reasoningEffort, imageDetail: predictions.imageDetail, store: predictions.store, images: predictions.cases.length, technicalFailures: predictions.cases.filter((entry: any) => entry.error).length },
  denominators: { expectedVisual: components.length, resolvedTbca: resolved.length, ambiguousVisualOnly: components.length - resolved.length },
  visual: { matched: visualMatched, missing: visualMissing, extras, recallPercent: percent(visualMatched, components.length), precisionPercent: percent(visualMatched, visualMatched + extras) },
  tbca: {
    top1Acceptable: { count: resolved.filter((item) => item.top1Acceptable).length, denominator: resolved.length },
    top3Acceptable: { count: resolved.filter((item) => item.top3Acceptable).length, denominator: resolved.length },
    top5Acceptable: { count: resolved.filter((item) => item.top5Acceptable).length, denominator: resolved.length },
    autoSelect: { count: auto.length, correct: auto.filter((item) => item.autoCorrect).length, precisionPercent: percent(auto.filter((item) => item.autoCorrect).length, auto.length), coveragePercent: percent(auto.length, resolved.length) },
    userChoice: { count: needsChoice.length, expectedInTop5: needsChoice.filter((item) => item.top5Acceptable).length },
  },
  usage: { inputTokens: sum(telemetries.map((item: any) => item.inputTokens ?? 0)), outputTokens: sum(telemetries.map((item: any) => item.outputTokens ?? 0)), reasoningTokens: sum(telemetries.map((item: any) => item.reasoningTokens ?? 0)) },
  costUsd: { total: sum(predictions.cases.map((entry: any) => entry.costUsd)), averagePerImage: sum(predictions.cases.map((entry: any) => entry.costUsd)) / predictions.cases.length },
  latency: { provider: latency(telemetries.map((item: any) => item.latencyMs)), pipeline: latency(predictions.cases.map((entry: any) => entry.latencyMs)) },
  components,
};
writeFileSync(`${root}/report-luna-fast-none-low.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, components: undefined }, null, 2));

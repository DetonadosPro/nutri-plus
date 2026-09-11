import { performance } from 'node:perf_hooks';

const target = new URL(process.argv[2] || 'http://127.0.0.1:3002/');
const iterations = Number(process.argv[3] || 100);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 500) throw new Error('Iterações inválidas.');

async function timedFetch(url, timeoutMs = 15_000) {
  const started = performance.now();
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { response, milliseconds: performance.now() - started };
}

const runs = [];
let firstHtml = '';
for (let index = 0; index < iterations; index += 1) {
  const url = new URL(target);
  url.searchParams.set('boot-run', String(index));
  try {
    const { response, milliseconds } = await timedFetch(url);
    const html = await response.text();
    if (!firstHtml) firstHtml = html;
    runs.push({
      index,
      ok: response.ok && /<html[\s>]/i.test(html) && html.length > 1_000,
      status: response.status,
      milliseconds: Number(milliseconds.toFixed(1)),
      bytes: Buffer.byteLength(html),
    });
  } catch (error) {
    runs.push({ index, ok: false, status: 0, milliseconds: null, bytes: 0, error: error instanceof Error ? error.name : 'Error' });
  }
}

const assetPaths = [...firstHtml.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css|woff2))[^\"]*"/gi)]
  .map((match) => match[1])
  .filter((value, index, values) => values.indexOf(value) === index);
const assets = [];
for (const path of assetPaths) {
  const url = new URL(path, target);
  try {
    const { response, milliseconds } = await timedFetch(url);
    const contentType = response.headers.get('content-type') || '';
    const body = await response.arrayBuffer();
    const expectedType = path.endsWith('.js')
      ? /javascript/
      : path.endsWith('.css')
        ? /text\/css/
        : /font|octet-stream/;
    assets.push({ path, ok: response.ok && expectedType.test(contentType) && body.byteLength > 0, status: response.status, contentType, bytes: body.byteLength, milliseconds: Number(milliseconds.toFixed(1)) });
  } catch (error) {
    assets.push({ path, ok: false, status: 0, error: error instanceof Error ? error.name : 'Error' });
  }
}

const successfulTimes = runs.filter((run) => run.ok && run.milliseconds != null).map((run) => run.milliseconds).sort((a, b) => a - b);
const percentile = (values, value) => values[Math.min(values.length - 1, Math.floor(values.length * value))] ?? null;
const report = {
  target: target.origin,
  iterations,
  successful: runs.filter((run) => run.ok).length,
  failed: runs.filter((run) => !run.ok),
  milliseconds: {
    minimum: successfulTimes[0] ?? null,
    average: successfulTimes.length ? Number((successfulTimes.reduce((sum, value) => sum + value, 0) / successfulTimes.length).toFixed(1)) : null,
    p95: percentile(successfulTimes, 0.95),
    maximum: successfulTimes.at(-1) ?? null,
  },
  assets: {
    total: assets.length,
    successful: assets.filter((asset) => asset.ok).length,
    failed: assets.filter((asset) => !asset.ok),
  },
};

console.log(JSON.stringify(report, null, 2));
if (report.successful !== iterations || report.assets.failed.length) process.exitCode = 1;

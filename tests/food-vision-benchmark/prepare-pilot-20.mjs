import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import sharp from 'sharp';

const root = 'tests/food-vision-benchmark/datasets/synthetic-v2-pilot-20';
const sourcePath = join(root, 'labels.review.json');
const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const catalog = JSON.parse(readFileSync('backend/data/tbca/tbca completa normalizada.json', 'utf8'));
const catalogByCode = new Map(catalog.map((food) => [food.codigo, food]));

// These decisions are manual catalog review, not recognition output.
const resolved = {
  'Arroz branco cozido': ['BRC0018A'],
  'Arroz integral cozido': ['BRC0016A'],
  'Feijão carioca cozido': ['BRC0001T'],
  'Feijão preto cozido': ['BRC0258T', 'BRC0008T'],
  'Ovo frito': ['BRC0028J', 'BRC0015J'],
  'Ovo de galinha cozido': ['BRC0023J', 'BRC0010J'],
  'Peito de frango grelhado': ['BRC0230F'],
  // A cultivar não é estável pela foto; as variantes cruas são equivalências aceitáveis.
  'Alface crua': ['BRC0009B', 'BRC0060B', 'BRC0061B', 'BRC0062B', 'BRC0063B'],
  'Tomate cru': ['BRC0035B'],
  'Cebola crua': ['BRC0018B'],
  'Coxa de frango assada': ['BRC0842F', 'BRC0108F'],
  'Filé de peixe grelhado': ['BRC0104E', 'BRC0105E'],
  'Mandioca cozida': ['BRC0908B', 'BRC0053B'],
  'Batata inglesa cozida': ['BRC0117B', 'BRC0041B'],
  'Batata inglesa frita': ['BRC0118B', 'BRC0048B'],
  'Espaguete ao molho de tomate': ['BRC0218A', 'BRC0217A'],
  'Lasanha à bolonhesa': ['BRC0395A'],
  'Pepino cru': ['BRC0030B'],
};

const pending = {
  'Omelete simples': 'A TBCA não possui omelete simples; todos os candidatos acrescentam queijo, vegetais, frios ou carne invisíveis na foto.',
  'Bife bovino grelhado': 'A TBCA exige corte/classe bovina; a foto não permite distinguir com segurança.',
  'Farofa': 'A TBCA exige farinha/receita/ingredientes; a aparência não determina a composição.',
  'Filé de peixe empanado': 'O único registro genérico encontrado força pescada e fritura; espécie e método não são observáveis com segurança.',
  'Queijo muçarela': 'Muçarela é a intenção de geração, mas a variedade não pode ser confirmada visualmente.',
};

const hashLines = readFileSync(join(root, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/);
const expectedHashes = new Map(hashLines.map((line) => { const [hash, file] = line.trim().split(/\s+\*?/); return [basename(file), hash]; }));
const imageFiles = source.cases.map((test) => basename(test.image));
if (source.imageCount !== 20 || source.cases.length !== 20 || new Set(imageFiles).size !== 20) throw new Error('O manifesto deve conter 20 casos únicos.');
if (source.expectedComponentCount !== 32) throw new Error('O manifesto deve declarar 32 componentes.');

for (const test of source.cases) {
  const path = join(root, test.image);
  const buffer = readFileSync(path);
  const metadata = await sharp(buffer).metadata();
  const hash = createHash('sha256').update(buffer).digest('hex');
  if (metadata.format !== 'png' || metadata.width !== 1448 || metadata.height !== 1086) throw new Error(`${test.id}: formato ou dimensão inválida.`);
  if (hash !== expectedHashes.get(basename(path)) || hash !== test.source.sha256) throw new Error(`${test.id}: SHA-256 divergente.`);
}

let resolvedCount = 0;
let pendingCount = 0;
const reviewedCases = source.cases.map((test) => ({
  ...test,
  visualReviewStatus: 'reviewed',
  expectedFoods: test.expectedFoods.map((food) => {
    const codes = resolved[food.expectedLabel];
    if (!codes) {
      const reason = pending[food.expectedLabel];
      if (!reason) throw new Error(`Sem decisão para ${food.expectedLabel}`);
      pendingCount++;
      return { ...food, tbcaCode: null, acceptableCodes: [], catalogReviewStatus: 'pending', catalogReviewReason: reason };
    }
    for (const code of codes) if (!catalogByCode.has(code)) throw new Error(`Código ausente do catálogo: ${code}`);
    resolvedCount++;
    return { ...food, tbcaCode: codes[0], acceptableCodes: codes.slice(1), catalogReviewStatus: 'reviewed', catalogNames: codes.map((code) => catalogByCode.get(code).nome_exibicao) };
  }),
}));
if (resolvedCount + pendingCount !== 32) throw new Error('A contagem revisada deve totalizar 32 componentes.');

const audit = {
  datasetId: source.datasetId,
  sourceManifest: 'labels.review.json',
  status: pendingCount ? 'awaiting_ambiguity_rule_and_paid_run_approval' : 'awaiting_paid_run_approval',
  validation: { images: 20, uniqueCases: 20, components: 32, png: 20, dimensions: '1448x1086', hashesMatched: 20, catalogFoods: catalog.length },
  scoringProposal: { tbcaCodeMetrics: resolvedCount, visualDetectionOnly: pendingCount, rule: 'Componentes sem código visualmente defensável não entram silenciosamente no denominador de exact/acceptable TBCA.' },
  cases: reviewedCases,
};
writeFileSync(join(root, 'ground-truth.audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({ images: 20, components: 32, resolved: resolvedCount, pending: pendingCount, output: join(root, 'ground-truth.audit.json') }, null, 2));

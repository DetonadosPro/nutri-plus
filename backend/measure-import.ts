import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { db, transaction, migrate, closeDatabase, projectPath } from './db';

export const reviewedMeasure = z.object({
  foodSource: z.enum(['TBCA','TACO']), foodCode: z.string().min(1), key: z.string().trim().min(1),
  kind: z.enum(['volume','count','household']), name: z.string().trim().min(1), plural: z.string().trim().min(1),
  quantity: z.number().positive().finite(), grams: z.number().positive().finite(),
  source: z.enum(['TBCA','TACO','density','internal','manual']), reference: z.string().trim().min(1),
  isDefault: z.boolean(), reviewed: z.literal(true),
}).strict().refine(m => m.kind !== 'volume' || (m.name === 'mL' && m.plural === 'mL'), 'Volume deve ser normalizado em mL com massa documentada.');

export type ReviewedMeasure = z.infer<typeof reviewedMeasure>;

export async function validateMeasureCatalog(data: unknown) {
  const rows = z.array(reviewedMeasure).parse(data);
  const keys = new Map<string, number>();
  const names = new Map<string, number>();
  const defaults = new Map<string, number>();
  const duplicateKeys: string[] = [];
  const duplicateNames: string[] = [];
  const duplicateDefaults: string[] = [];
  const foodIdentities = new Map<string, { foodSource: string; foodCode: string }>();
  rows.forEach((row, index) => {
    const food = `${row.foodSource}:${row.foodCode}`;
    foodIdentities.set(food, { foodSource: row.foodSource, foodCode: row.foodCode });
    const key = `${food}:${row.key}`;
    const name = `${food}:${row.name.trim().toLocaleLowerCase('pt-BR')}`;
    if (keys.has(key)) duplicateKeys.push(`${key} (linhas ${keys.get(key)! + 1} e ${index + 1})`);
    else keys.set(key, index);
    if (names.has(name)) duplicateNames.push(`${name} (linhas ${names.get(name)! + 1} e ${index + 1})`);
    else names.set(name, index);
    if (row.isDefault) {
      if (defaults.has(food)) duplicateDefaults.push(`${food} (linhas ${defaults.get(food)! + 1} e ${index + 1})`);
      else defaults.set(food, index);
    }
  });
  if (duplicateKeys.length || duplicateNames.length || duplicateDefaults.length) {
    throw new Error(JSON.stringify({ duplicateKeys, duplicateNames, duplicateDefaults }, null, 2));
  }
  const identities = [...foodIdentities.values()];
  const matched = identities.length
    ? await db.prepare(`SELECT f.id,f.source,f.source_code FROM foods f JOIN jsonb_to_recordset(?::jsonb) x(source text,source_code text)
        ON f.source=x.source AND f.source_code=x.source_code`).all<{ id: number; source: string; source_code: string }>(
        JSON.stringify(identities.map(({ foodSource: source, foodCode: source_code }) => ({ source, source_code }))),
      )
    : [];
  const matchedIdentities = new Set(matched.map(row => `${row.source}:${row.source_code}`));
  const notFound = [...foodIdentities.keys()].filter(identity => !matchedIdentities.has(identity));
  const foodIds = new Map(matched.map(row => [`${row.source}:${row.source_code}`, row.id]));
  const existing = await db.prepare(`SELECT f.source AS food_source,f.source_code AS food_code,m.key,m.kind,m.name,m.plural,
    m.quantity,m.grams,m.source,m.reference,m.is_default
    FROM food_measures m JOIN foods f ON f.id=m.food_id`).all<Record<string, unknown>>();
  const catalogByIdentity = new Map(rows.map(row => [`${row.foodSource}:${row.foodCode}:${row.key}`, row]));
  const existingByIdentity = new Map(existing.map(row => [`${row.food_source}:${row.food_code}:${row.key}`, row]));
  const changedMeasures: string[] = [];
  let unchangedMeasures = 0;
  for (const [identity, row] of catalogByIdentity) {
    const current = existingByIdentity.get(identity);
    if (!current) continue;
    const unchanged = current.kind === row.kind && current.name === row.name && current.plural === row.plural
      && Number(current.quantity) === row.quantity && Number(current.grams) === row.grams
      && current.source === row.source && current.reference === row.reference
      && Boolean(current.is_default) === row.isDefault;
    if (unchanged) unchangedMeasures++;
    else changedMeasures.push(identity);
  }
  const missingFromCatalog = [...existingByIdentity.keys()].filter(identity => !catalogByIdentity.has(identity));
  return {
    rows,
    foodIds,
    report: {
      records: rows.length,
      distinctFoodCodes: identities.length,
      matchedFoodCodes: matchedIdentities.size,
      notFound,
      duplicateKeys: 0,
      duplicateNames: 0,
      conflictingDefaults: 0,
      invalidWeights: 0,
      invalidQuantities: 0,
      invalidKinds: 0,
      missingReferences: 0,
      unreviewed: 0,
      kinds: Object.fromEntries([...new Set(rows.map(row => row.kind))].sort().map(kind => [kind, rows.filter(row => row.kind === kind).length])),
      sources: Object.fromEntries([...new Set(rows.map(row => row.source))].sort().map(source => [source, rows.filter(row => row.source === source).length])),
      defaults: rows.filter(row => row.isDefault).length,
      existingMeasures: existing.length,
      unchangedMeasures,
      changedMeasures,
      newMeasures: rows.length - unchangedMeasures - changedMeasures.length,
      existingMissingFromCatalog: missingFromCatalog,
    },
  };
}

export async function importMeasures(data: unknown) {
  const { rows, foodIds, report } = await validateMeasureCatalog(data);
  if (report.notFound.length) throw new Error(`Alimentos inexistentes: ${report.notFound.join(', ')}`);
  await transaction(async () => {
    const records = rows.map(row => ({
      food_id: foodIds.get(`${row.foodSource}:${row.foodCode}`), key: row.key, kind: row.kind,
      name: row.name, plural: row.plural, quantity: row.quantity, grams: row.grams,
      source: row.source, reference: row.reference, is_default: row.isDefault,
    }));
    for (let offset = 0; offset < records.length; offset += 1000) {
      await db.prepare(`INSERT INTO food_measures(food_id,key,kind,name,plural,quantity,grams,source,reference,is_default)
        SELECT x.food_id,x.key,x.kind,x.name,x.plural,x.quantity,x.grams,x.source,x.reference,x.is_default
        FROM jsonb_to_recordset(?::jsonb) x(food_id bigint,key text,kind text,name text,plural text,quantity numeric,grams numeric,source text,reference text,is_default boolean)
        ON CONFLICT(food_id,key) DO UPDATE SET kind=excluded.kind,name=excluded.name,plural=excluded.plural,quantity=excluded.quantity,grams=excluded.grams,source=excluded.source,reference=excluded.reference,is_default=excluded.is_default`).run(JSON.stringify(records.slice(offset, offset + 1000)));
    }
  });
  return { measuresProcessed: rows.length, foodsMatched: report.matchedFoodCodes, codesNotFound: report.notFound };
}
if (process.argv[1] === import.meta.filename) {
  try {
    await migrate();
    const fileArgument = process.argv.slice(2).find(argument => !argument.startsWith('--'));
    const data = JSON.parse(readFileSync(fileArgument || projectPath('data','food-measures.reviewed.json'),'utf8'));
    if (process.argv.includes('--check')) console.log(JSON.stringify((await validateMeasureCatalog(data)).report, null, 2));
    else console.log(await importMeasures(data));
  } finally { await closeDatabase(); }
}

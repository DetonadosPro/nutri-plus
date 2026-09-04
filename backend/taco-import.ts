import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { closeDatabase, db, migrate, projectPath, transaction } from './db';

export type NutrientStatus = 'numeric' | 'trace' | 'missing';

type NutrientDefinition = {
  code: string;
  name: string;
  unit: string;
  group: 'energy' | 'macro' | 'mineral' | 'vitamin' | 'other';
  sort_order: number;
};

type NutrientValue = {
  numeric_value: number | null;
  raw_value: string;
  status: NutrientStatus;
};

type TacoFood = {
  source_code: string;
  description: string;
  group: string;
  nutrients: Record<string, NutrientValue>;
  pdf_pages: [number, number];
};

type TacoDataset = {
  metadata: { source: 'TACO'; edition: string; reference_amount: 100; reference_unit: 'g'; audit: { foods: number } };
  nutrients: NutrientDefinition[];
  foods: TacoFood[];
};

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function validateTacoDataset(dataset: TacoDataset) {
  if (dataset.metadata?.source !== 'TACO' || dataset.metadata.reference_amount !== 100 || dataset.metadata.reference_unit !== 'g') throw new Error('Metadados TACO inválidos.');
  if (dataset.foods?.length !== 597 || dataset.metadata.audit?.foods !== 597) throw new Error('A TACO deve conter exatamente 597 alimentos.');
  if (dataset.nutrients?.length !== 26) throw new Error('A TACO deve conter exatamente 26 nutrientes.');
  const codes = new Set(dataset.foods.map((food) => food.source_code));
  if (codes.size !== 597 || [...codes].some((code) => !/^([1-9]|[1-9]\d|[1-5]\d\d)$/.test(code))) throw new Error('Códigos TACO inválidos ou duplicados.');
  const nutrientCodes = new Set(dataset.nutrients.map((item) => item.code));
  for (const food of dataset.foods) {
    if (!food.description.trim() || !food.group.trim() || Object.keys(food.nutrients).length !== 26) throw new Error(`Estrutura incompleta no alimento TACO ${food.source_code}.`);
    for (const [code, value] of Object.entries(food.nutrients)) {
      if (!nutrientCodes.has(code)) throw new Error(`Nutriente desconhecido ${code} no alimento ${food.source_code}.`);
      if (!['numeric', 'trace', 'missing'].includes(value.status)) throw new Error(`Estado inválido em ${food.source_code}/${code}.`);
      if ((value.status === 'numeric') !== (typeof value.numeric_value === 'number' && Number.isFinite(value.numeric_value))) throw new Error(`Valor incompatível com o estado em ${food.source_code}/${code}.`);
    }
  }
  return dataset;
}

export async function importTaco(filePath = projectPath('data', 'taco', 'taco_normalizada.json')) {
  await migrate();
  const dataset = validateTacoDataset(JSON.parse(readFileSync(filePath, 'utf8')) as TacoDataset);
  const existingFoods = new Set((await db.prepare(`SELECT source_code FROM foods WHERE source = 'TACO'`).all<{ source_code: string }>()).map((row) => row.source_code));
  const existingValues = Number((await db.prepare(`SELECT COUNT(*)::int AS count FROM food_nutrients fn JOIN foods f ON f.id = fn.food_id WHERE f.source = 'TACO'`).get<{ count: number }>())?.count ?? 0);
  const report = {
    foodsProcessed: dataset.foods.length,
    foodsCreated: dataset.foods.filter((food) => !existingFoods.has(food.source_code)).length,
    foodsUpdated: dataset.foods.filter((food) => existingFoods.has(food.source_code)).length,
    nutrients: dataset.nutrients.length,
    values: dataset.foods.length * dataset.nutrients.length,
    valuesCreated: existingValues ? 0 : dataset.foods.length * dataset.nutrients.length,
    valuesUpdated: existingValues ? dataset.foods.length * dataset.nutrients.length : 0,
    missing: 0,
    trace: 0,
    zero: 0,
    errors: 0,
  };

  await transaction(async () => {
    await db.prepare(`INSERT INTO nutrients (code, name, tagname, unit, nutrient_group, sort_order)
      SELECT x.code, x.name, x.code, x.unit, x.nutrient_group, x.sort_order
      FROM jsonb_to_recordset(?::jsonb) AS x(code text, name text, unit text, nutrient_group text, sort_order int)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, tagname=excluded.tagname, unit=excluded.unit, nutrient_group=excluded.nutrient_group, sort_order=excluded.sort_order`).run(JSON.stringify(dataset.nutrients.map((item) => ({ ...item, nutrient_group: item.group }))));

    await db.prepare(`INSERT INTO foods (source, source_code, description, normalized_name, category, source_url, active, updated_at)
      SELECT 'TACO', x.source_code, x.description, x.normalized_name, x.category, x.source_url, true, CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(?::jsonb) AS x(source_code text, description text, normalized_name text, category text, source_url text)
      ON CONFLICT(source, source_code) DO UPDATE SET description=excluded.description, normalized_name=excluded.normalized_name, category=excluded.category, source_url=excluded.source_url, active=true, updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(dataset.foods.map((food) => ({
        source_code: food.source_code,
        description: food.description,
        normalized_name: normalizeSearch(food.description),
        category: food.group,
        source_url: `taco_4_edicao.pdf#page=${food.pdf_pages[0]}`,
      }))));

    const ids = new Map((await db.prepare(`SELECT id, source_code FROM foods WHERE source = 'TACO'`).all<{ id: number; source_code: string }>()).map((row) => [row.source_code, row.id]));
    const rows: Array<Record<string, unknown>> = [];
    for (const food of dataset.foods) {
      for (const [nutrientCode, value] of Object.entries(food.nutrients)) {
        if (value.status === 'missing') report.missing++;
        if (value.status === 'trace') report.trace++;
        if (value.status === 'numeric' && value.numeric_value === 0) report.zero++;
        rows.push({ food_id: ids.get(food.source_code), nutrient_code: nutrientCode, numeric_value: value.numeric_value, raw_value: value.raw_value, status: value.status });
      }
    }
    for (let offset = 0; offset < rows.length; offset += 2_000) {
      await db.prepare(`INSERT INTO food_nutrients (food_id, nutrient_code, numeric_value, raw_value, status, updated_at)
        SELECT x.food_id, x.nutrient_code, x.numeric_value, x.raw_value, x.status, CURRENT_TIMESTAMP
        FROM jsonb_to_recordset(?::jsonb) AS x(food_id bigint, nutrient_code text, numeric_value double precision, raw_value text, status text)
        ON CONFLICT(food_id, nutrient_code) DO UPDATE SET numeric_value=excluded.numeric_value, raw_value=excluded.raw_value, status=excluded.status, updated_at=CURRENT_TIMESTAMP`).run(JSON.stringify(rows.slice(offset, offset + 2_000)));
    }

    await db.prepare(`DELETE FROM food_nutrients fn USING foods f WHERE fn.food_id=f.id AND f.source='TACO' AND NOT (fn.nutrient_code = ANY(?::text[]))`).run(dataset.nutrients.map((item) => item.code));
    await db.prepare(`INSERT INTO nutrition_import_runs (source, source_file, source_size, foods_processed, foods_created, foods_updated, nutrients_created, values_created, values_updated, missing_values, trace_values, zero_values, errors)
      VALUES ('TACO', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(basename(filePath), statSync(filePath).size, report.foodsProcessed, report.foodsCreated, report.foodsUpdated, report.nutrients, report.valuesCreated, report.valuesUpdated, report.missing, report.trace, report.zero, report.errors);
  });
  return report;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  importTaco().then((report) => console.log(JSON.stringify(report, null, 2))).finally(() => closeDatabase());
}

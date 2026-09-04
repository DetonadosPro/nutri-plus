import { readSheet } from 'read-excel-file/node';
import { basename } from 'node:path';
import { closeDatabase, db, migrate, projectPath, transaction } from './db';

const EXPECTED_HEADERS = ['numero_alimento', 'ig', 'ig_status', 'observacao'] as const;
const EXPECTED_ROWS = 597;
const EXPECTED_NUMERIC = 233;
const EXPECTED_NULL = 364;

export type GlycemicIndexRow = {
  sourceCode: string;
  glycemicIndex: number | null;
  status: 'VALOR' | 'NULL';
  observation: string | null;
};

export type GlycemicIndexFileAudit = {
  sourceFile: string;
  rowsProcessed: number;
  numericValues: number;
  nullValues: number;
  duplicateIds: string[];
  invalidRows: Array<{ row: number; reason: string }>;
};

function scalar(value: unknown): string | number | boolean | Date | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  return String(value);
}

function text(value: unknown) {
  const result = scalar(value);
  return result == null ? '' : String(result).trim();
}

export async function readGlycemicIndexWorkbook(filePath: string): Promise<{ rows: GlycemicIndexRow[]; audit: GlycemicIndexFileAudit }> {
  const worksheet = await readSheet(filePath, 'IG_TACO');
  if (!worksheet.length) throw new Error('A planilha obrigatória IG_TACO não foi encontrada ou está vazia.');
  const headers = EXPECTED_HEADERS.map((_, index) => text(worksheet[0]?.[index]));
  if (headers.some((header, index) => header !== EXPECTED_HEADERS[index])) {
    throw new Error(`Cabeçalhos inválidos em IG_TACO: esperado ${EXPECTED_HEADERS.join(', ')}, recebido ${headers.join(', ')}.`);
  }

  const rows: GlycemicIndexRow[] = [];
  const invalidRows: Array<{ row: number; reason: string }> = [];
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  for (let rowNumber = 2; rowNumber <= worksheet.length; rowNumber += 1) {
    const values = [0, 1, 2, 3].map((column) => worksheet[rowNumber - 1]?.[column]);
    if (values.every((value) => text(value) === '')) continue;
    const sourceCodeRaw = scalar(values[0]);
    const igRaw = scalar(values[1]);
    const statusRaw = text(values[2]).toUpperCase();
    const observation = text(values[3]) || null;
    const sourceCodeNumber = typeof sourceCodeRaw === 'number' ? sourceCodeRaw : Number(text(values[0]));

    if (!Number.isInteger(sourceCodeNumber) || sourceCodeNumber < 1) {
      invalidRows.push({ row: rowNumber, reason: `numero_alimento inválido: ${String(sourceCodeRaw)}` });
      continue;
    }
    const sourceCode = String(sourceCodeNumber);
    if (seen.has(sourceCode)) duplicateIds.add(sourceCode);
    seen.add(sourceCode);

    if (statusRaw === 'NULL') {
      if (igRaw != null && text(values[1]) !== '') invalidRows.push({ row: rowNumber, reason: `IG deve estar vazio quando ig_status é NULL (ID ${sourceCode}).` });
      rows.push({ sourceCode, glycemicIndex: null, status: 'NULL', observation });
      continue;
    }

    if (statusRaw === 'VALOR') {
      const glycemicIndex = typeof igRaw === 'number' ? igRaw : Number(text(values[1]));
      if (!Number.isInteger(glycemicIndex) || glycemicIndex < 0 || glycemicIndex > 200) {
        invalidRows.push({ row: rowNumber, reason: `IG numérico inválido para o ID ${sourceCode}: ${String(igRaw)}` });
      } else {
        rows.push({ sourceCode, glycemicIndex, status: 'VALOR', observation });
      }
      continue;
    }

    invalidRows.push({ row: rowNumber, reason: `ig_status deve ser VALOR ou NULL (ID ${sourceCode}).` });
  }

  const audit: GlycemicIndexFileAudit = {
    sourceFile: basename(filePath),
    rowsProcessed: rows.length,
    numericValues: rows.filter((row) => row.glycemicIndex != null).length,
    nullValues: rows.filter((row) => row.glycemicIndex == null).length,
    duplicateIds: [...duplicateIds].sort((a, b) => Number(a) - Number(b)),
    invalidRows,
  };
  const problems = [
    audit.rowsProcessed !== EXPECTED_ROWS && `linhas=${audit.rowsProcessed} (esperado ${EXPECTED_ROWS})`,
    audit.numericValues !== EXPECTED_NUMERIC && `IG numérico=${audit.numericValues} (esperado ${EXPECTED_NUMERIC})`,
    audit.nullValues !== EXPECTED_NULL && `IG NULL=${audit.nullValues} (esperado ${EXPECTED_NULL})`,
    audit.duplicateIds.length > 0 && `IDs duplicados=${audit.duplicateIds.join(', ')}`,
    audit.invalidRows.length > 0 && `linhas inválidas=${JSON.stringify(audit.invalidRows)}`,
  ].filter(Boolean);
  if (problems.length) throw new Error(`Importação de IG bloqueada: ${problems.join('; ')}.`);
  return { rows, audit };
}

export async function importGlycemicIndexes(filePath = projectPath('data', 'taco', 'ig_taco_597_alimentos.xlsx')) {
  await migrate();
  const { rows, audit } = await readGlycemicIndexWorkbook(filePath);
  const databaseFoods = await db.prepare(`SELECT source_code FROM foods WHERE source = 'TACO' ORDER BY source_code::int`).all<{ source_code: string }>();
  const databaseIds = new Set(databaseFoods.map((food) => food.source_code));
  const inputIds = new Set(rows.map((row) => row.sourceCode));
  const notFoundIds = rows.filter((row) => !databaseIds.has(row.sourceCode)).map((row) => row.sourceCode);
  const databaseIdsMissingFromFile = databaseFoods.filter((food) => !inputIds.has(food.source_code)).map((food) => food.source_code);

  if (databaseFoods.length !== EXPECTED_ROWS || notFoundIds.length || databaseIdsMissingFromFile.length) {
    throw new Error(`Importação de IG bloqueada: alimentos TACO no banco=${databaseFoods.length}; IDs não encontrados=${notFoundIds.join(', ') || 'nenhum'}; IDs ausentes no arquivo=${databaseIdsMissingFromFile.join(', ') || 'nenhum'}.`);
  }

  const beforeFoodCount = Number((await db.prepare(`SELECT COUNT(*)::int AS count FROM foods`).get<{ count: number }>())?.count ?? 0);
  const beforeNutrientCount = Number((await db.prepare(`SELECT COUNT(*)::int AS count FROM food_nutrients`).get<{ count: number }>())?.count ?? 0);
  let changedRows = 0;

  await transaction(async () => {
    const result = await db.prepare(`UPDATE foods AS f
      SET glycemic_index = x.glycemic_index, updated_at = CURRENT_TIMESTAMP
      FROM jsonb_to_recordset(?::jsonb) AS x(source_code text, glycemic_index smallint)
      WHERE f.source = 'TACO' AND f.source_code = x.source_code
        AND f.glycemic_index IS DISTINCT FROM x.glycemic_index`).run(JSON.stringify(rows.map((row) => ({ source_code: row.sourceCode, glycemic_index: row.glycemicIndex }))));
    changedRows = result.changes;

    const validation = await db.prepare(`SELECT
      COUNT(*)::int AS total,
      COUNT(glycemic_index)::int AS numeric,
      COUNT(*) FILTER (WHERE glycemic_index IS NULL)::int AS nulls
      FROM foods WHERE source = 'TACO'`).get<{ total: number; numeric: number; nulls: number }>();
    const afterFoodCount = Number((await db.prepare(`SELECT COUNT(*)::int AS count FROM foods`).get<{ count: number }>())?.count ?? 0);
    const afterNutrientCount = Number((await db.prepare(`SELECT COUNT(*)::int AS count FROM food_nutrients`).get<{ count: number }>())?.count ?? 0);
    if (!validation || validation.total !== EXPECTED_ROWS || validation.numeric !== EXPECTED_NUMERIC || validation.nulls !== EXPECTED_NULL || afterFoodCount !== beforeFoodCount || afterNutrientCount !== beforeNutrientCount) {
      throw new Error(`Validação pós-importação falhou: ${JSON.stringify({ validation, beforeFoodCount, afterFoodCount, beforeNutrientCount, afterNutrientCount })}`);
    }
  });

  return {
    ...audit,
    foodsFound: rows.length,
    foodsNotFound: notFoundIds.length,
    foodsCreated: 0,
    changedRows,
    databaseIdsMissingFromFile,
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  importGlycemicIndexes(process.argv[2]).then((report) => console.log(JSON.stringify(report, null, 2))).finally(() => closeDatabase());
}

import { calculateGlycemicLoad } from "../../shared/glycemic";

export { calculateGlycemicLoad } from "../../shared/glycemic";

export type GlycemicEntry = {
  glycemicIndex: number | null | undefined;
  carbohydrateGrams: number | null | undefined;
};

export type GlycemicClassification = "excelente" | "boa" | "moderada" | "elevada" | "muito elevada";

export type NormalizedGlycemicLoad = {
  rawGL: number | null;
  totalKcal: number | null;
  normalizedGL: number | null;
  per1000Kcal: number | null;
  classification: GlycemicClassification | null;
};

function finiteOrNull(value: number | null | undefined) {
  return value != null && Number.isFinite(value) ? value : null;
}

export function classifyNormalizedGlycemicLoad(
  value: number | null | undefined,
): GlycemicClassification | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value < 40) return "excelente";
  if (value < 50) return "boa";
  if (value < 60) return "moderada";
  if (value < 75) return "elevada";
  return "muito elevada";
}

/**
 * Normaliza somente o agregado diário (ou de um período). A CG bruta continua
 * sendo calculada separadamente pela regra IG x carboidrato disponível / 100.
 */
export function calculateNormalizedGlycemicLoad(
  totalGL: number | null | undefined,
  totalKcal: number | null | undefined,
): NormalizedGlycemicLoad {
  const rawGL = finiteOrNull(totalGL);
  const kcal = finiteOrNull(totalKcal);
  const validKcal = kcal != null && kcal > 0 ? kcal : null;
  const normalizedGL = rawGL != null && validKcal != null ? (rawGL / validKcal) * 1000 : null;
  return {
    rawGL,
    totalKcal: kcal,
    normalizedGL,
    per1000Kcal: normalizedGL,
    classification: classifyNormalizedGlycemicLoad(normalizedGL),
  };
}

export type GlycemicDay = {
  load?: number | null;
  rawGL?: number | null;
  totalKcal?: number | null;
  coveredEntries?: number;
  unavailableEntries?: number;
};

/**
 * Agrega dias pela relação dos totais, nunca pela média simples dos índices
 * diários. Dias sem CG ou kcal válidas ficam fora do denominador.
 */
export function periodGlycemicSummary(days: GlycemicDay[]) {
  let rawGL = 0;
  let totalKcal = 0;
  let coveredDays = 0;
  let unavailableDays = 0;
  let coveredEntries = 0;
  let unavailableEntries = 0;

  for (const day of days) {
    const raw = finiteOrNull(day.rawGL ?? day.load);
    const kcal = finiteOrNull(day.totalKcal);
    coveredEntries += day.coveredEntries ?? 0;
    unavailableEntries += day.unavailableEntries ?? 0;
    if (raw != null && kcal != null && kcal > 0) {
      rawGL += raw;
      totalKcal += kcal;
      coveredDays += 1;
    } else if ((day.coveredEntries ?? 0) > 0 || (day.unavailableEntries ?? 0) > 0) {
      unavailableDays += 1;
    }
  }

  const normalized = calculateNormalizedGlycemicLoad(
    coveredDays > 0 ? rawGL : null,
    coveredDays > 0 ? totalKcal : null,
  );
  return {
    index: null,
    load: normalized.rawGL,
    ...normalized,
    coveredEntries,
    unavailableEntries,
    coveredDays,
    unavailableDays,
  };
}

export function dailyGlycemicSummary(entries: GlycemicEntry[], totalKcal?: number | null) {
  let carbohydrateGrams = 0;
  let glycemicLoad = 0;
  let unavailableEntries = 0;
  let coveredEntries = 0;

  for (const entry of entries) {
    if (entry.carbohydrateGrams == null || !Number.isFinite(entry.carbohydrateGrams)) {
      unavailableEntries += 1;
      continue;
    }
    if (entry.carbohydrateGrams <= 0) continue;
    if (entry.glycemicIndex == null || !Number.isFinite(entry.glycemicIndex)) {
      unavailableEntries += 1;
      continue;
    }
    carbohydrateGrams += entry.carbohydrateGrams;
    glycemicLoad += calculateGlycemicLoad(entry.glycemicIndex, entry.carbohydrateGrams) ?? 0;
    coveredEntries += 1;
  }

  const load = carbohydrateGrams > 0 ? glycemicLoad : null;
  const normalized = calculateNormalizedGlycemicLoad(load, totalKcal);
  return {
    index: carbohydrateGrams > 0 ? (glycemicLoad * 100) / carbohydrateGrams : null,
    load,
    ...normalized,
    coveredEntries,
    unavailableEntries,
  };
}

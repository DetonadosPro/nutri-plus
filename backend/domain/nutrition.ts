export type NutrientMap = Record<string, number | null | undefined>;
export type MacroDistribution = {
  carbohydratePercent: number;
  proteinPercent: number;
  fatPercent: number;
};

export type ScaledNutrients = {
  values: Record<string, number | null>;
  unavailable: string[];
};

export function scaleNutrients(basePer100g: NutrientMap, grams: number): ScaledNutrients {
  if (!Number.isFinite(grams) || grams < 0)
    throw new Error("A quantidade deve ser um número não negativo.");
  const factor = grams / 100;
  const values: Record<string, number | null> = {};
  const unavailable: string[] = [];

  for (const [code, value] of Object.entries(basePer100g)) {
    if (value == null || !Number.isFinite(value)) {
      unavailable.push(code);
      values[code] = null;
    } else values[code] = value * factor;
  }
  return { values, unavailable };
}

export function sumNutrientSets(sets: ScaledNutrients[]): ScaledNutrients {
  const values: Record<string, number | null> = {};
  const unavailable = new Set<string>();
  for (const set of sets) {
    for (const [code, value] of Object.entries(set.values)) {
      if (value == null || values[code] === null) values[code] = null;
      else values[code] = (values[code] ?? 0) + value;
    }
    for (const code of set.unavailable) unavailable.add(code);
  }
  for (const code of unavailable) values[code] = null;
  return { values, unavailable: [...unavailable].sort() };
}

export function macroEnergy(values: NutrientMap) {
  const carbohydrateKcal = (values.carboidrato_g ?? 0) * 4;
  const proteinKcal = (values.proteina_g ?? 0) * 4;
  const fatKcal = (values.lipideos_g ?? 0) * 9;
  const calculatedKcal = carbohydrateKcal + proteinKcal + fatKcal;
  const directKcal = values.energia_kcal ?? null;
  const percent = (value: number) => (calculatedKcal > 0 ? (value / calculatedKcal) * 100 : 0);
  return {
    carbohydrateKcal,
    proteinKcal,
    fatKcal,
    calculatedKcal,
    directKcal,
    differenceKcal: directKcal == null ? null : directKcal - calculatedKcal,
    carbohydratePercent: percent(carbohydrateKcal),
    proteinPercent: percent(proteinKcal),
    fatPercent: percent(fatKcal),
  };
}

export function proteinPerKg(
  proteinGrams: number | null | undefined,
  weightKg: number | null | undefined,
) {
  if (proteinGrams == null || weightKg == null || weightKg <= 0) return null;
  return proteinGrams / weightKg;
}

export function waterGoalMl(weightKg: number | null | undefined) {
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  return weightKg * 40;
}

export function macroGoalsFromEnergy(
  energyKcal: number | null | undefined,
  distribution: MacroDistribution,
) {
  if (energyKcal == null || !Number.isFinite(energyKcal) || energyKcal <= 0)
    return { carbohydrateG: null, proteinG: null, fatG: null };
  const percentages = [
    distribution.carbohydratePercent,
    distribution.proteinPercent,
    distribution.fatPercent,
  ];
  if (
    percentages.some((value) => !Number.isFinite(value) || value < 0 || value > 100) ||
    Math.abs(percentages.reduce((sum, value) => sum + value, 0) - 100) > 0.001
  )
    throw new Error("A distribuição dos macronutrientes deve totalizar 100%.");
  return {
    carbohydrateG: (energyKcal * (distribution.carbohydratePercent / 100)) / 4,
    proteinG: (energyKcal * (distribution.proteinPercent / 100)) / 4,
    fatG: (energyKcal * (distribution.fatPercent / 100)) / 9,
  };
}

export function proteinGoalRange(
  weightKg: number | null | undefined,
  minGKg: number | null | undefined,
  maxGKg: number | null | undefined,
) {
  if (weightKg == null || weightKg <= 0 || minGKg == null || maxGKg == null) return null;
  return { minGrams: weightKg * minGKg, maxGrams: weightKg * maxGKg };
}

export function patientMetrics(input: {
  weightKg: number | null | undefined;
  heightCm: number | null | undefined;
  age: number | null | undefined;
  sex: string | null | undefined;
}) {
  const { weightKg, heightCm, age, sex } = input;
  const bmi =
    weightKg != null && weightKg > 0 && heightCm != null && heightCm > 0
      ? weightKg / (heightCm / 100) ** 2
      : null;
  // Mifflin-St Jeor: 10*peso(kg) + 6,25*altura(cm) - 5*idade + constante sexual.
  // A constante validada é +5 para homens e -161 para mulheres; nos demais casos
  // o basal fica indisponível para não inventar uma aproximação clínica.
  const sexConstant = sex === "male" ? 5 : sex === "female" ? -161 : null;
  const basalKcal =
    weightKg != null &&
    weightKg > 0 &&
    heightCm != null &&
    heightCm > 0 &&
    age != null &&
    age >= 0 &&
    sexConstant != null
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + sexConstant
      : null;
  return { bmi, basalKcal, formula: "Mifflin-St Jeor" as const };
}

export function progressPercent(
  consumed: number | null | undefined,
  goal: number | null | undefined,
) {
  if (consumed == null || goal == null || goal <= 0) return null;
  return (consumed / goal) * 100;
}

export function periodAverage(days: Array<NutrientMap>, code: string) {
  const available = days
    .map((day) => day[code])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!available.length) return null;
  return available.reduce((sum, value) => sum + value, 0) / available.length;
}

export function round(value: number | null | undefined, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

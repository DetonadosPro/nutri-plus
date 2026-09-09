export const ENERGY_VERSION = "nutri-energy-1";
export const ACTIVITY_FACTORS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};
export type EnergyMode = "habitual_includes_exercise" | "base_plus_net";
export const TEF_RATES = {
  protein: 0.25,
  carbohydrate: 0.075,
  fat: 0.015,
} as const;
export const STRENGTH_CALCULATION_VERSION = "strength-density-1";
export const REST_DENSITY_POINTS = [
  [30, 1.15],
  [60, 1.1],
  [90, 1.05],
  [120, 1],
  [180, 0.95],
  [240, 0.9],
  [300, 0.85],
] as const;

export function calculateRestDensityFactor(restSeconds: number | null) {
  if (restSeconds == null) return 1;
  if (!Number.isFinite(restSeconds) || restSeconds <= 0)
    throw new Error("Intervalo entre séries inválido.");
  const bounded = Math.min(300, restSeconds);
  if (bounded <= REST_DENSITY_POINTS[0][0]) return REST_DENSITY_POINTS[0][1];
  for (let index = 1; index < REST_DENSITY_POINTS.length; index++) {
    const [rightSeconds, rightFactor] = REST_DENSITY_POINTS[index];
    if (bounded <= rightSeconds) {
      const [leftSeconds, leftFactor] = REST_DENSITY_POINTS[index - 1];
      const position = (bounded - leftSeconds) / (rightSeconds - leftSeconds);
      return leftFactor + (rightFactor - leftFactor) * position;
    }
  }
  return REST_DENSITY_POINTS.at(-1)![1];
}

export function calculateStrengthTrainingCalories(
  base: { grossKcal: number; netKcal: number },
  restSeconds: number | null,
) {
  if (![base.grossKcal, base.netKcal].every((value) => Number.isFinite(value) && value >= 0))
    throw new Error("Gasto base da musculação inválido.");
  const restDensityFactor = calculateRestDensityFactor(restSeconds);
  return {
    grossKcal: base.grossKcal * restDensityFactor,
    netKcal: base.netKcal * restDensityFactor,
    baseGrossKcal: base.grossKcal,
    baseNetKcal: base.netKcal,
    restDensityFactor,
    strengthCalculationVersion: STRENGTH_CALCULATION_VERSION,
  };
}

/**
 * Estimates TEF from the energy carried by each recorded macronutrient.
 * The daily factor represents non-exercise routine only, so TEF is added here
 * exactly once. Midpoints of the published ranges are used (P 20-30%, C 5-10%, F 0-3%).
 */
export function thermicEffectOfFood(macros: {
  proteinG: number | null;
  carbohydrateG: number | null;
  fatG: number | null;
}) {
  const proteinKcal = (macros.proteinG ?? 0) * 4;
  const carbohydrateKcal = (macros.carbohydrateG ?? 0) * 4;
  const fatKcal = (macros.fatG ?? 0) * 9;
  return (
    proteinKcal * TEF_RATES.protein +
    carbohydrateKcal * TEF_RATES.carbohydrate +
    fatKcal * TEF_RATES.fat
  );
}
export function metEnergy(met: number, weightKg: number, minutes: number) {
  if (![met, weightKg, minutes].every((v) => Number.isFinite(v) && v > 0))
    throw new Error("MET, peso e duração devem ser positivos.");
  return {
    grossKcal: (met * weightKg * minutes) / 60,
    netKcal: ((met - 1) * weightKg * minutes) / 60,
  };
}
export function manualEnergy(
  kcal: number,
  kind: "gross" | "net" | "unknown",
  weight: number | null,
  minutes: number,
) {
  if (!Number.isFinite(kcal) || kcal < 0) throw new Error("Gasto inválido.");
  return {
    grossKcal: kind === "gross" ? kcal : null,
    netKcal:
      kind === "net"
        ? kcal
        : kind === "gross" && weight != null
          ? kcal - (weight * minutes) / 60
          : null,
  };
}
export function energyBalance(
  intake: number | null,
  base: number | null,
  tef: number,
  mode: EnergyMode,
  sessions: Array<{
    outside_base: boolean;
    snapshot: { grossKcal: number | null; netKcal: number | null };
  }>,
) {
  const eligible = mode === "base_plus_net" ? sessions.filter((s) => s.outside_base) : [];
  const values = eligible.map((s) => s.snapshot.grossKcal ?? s.snapshot.netKcal);
  const additionalKcal = values.some((value) => value == null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const totalKcal = base == null || additionalKcal == null ? null : base + tef + additionalKcal;
  const balanceKcal = intake == null || totalKcal == null ? null : intake - totalKcal;
  return {
    additionalKcal,
    totalKcal,
    balanceKcal,
    label:
      balanceKcal == null
        ? "Indisponível"
        : Math.abs(balanceKcal) < 0.5
          ? "Neutro estimado"
          : balanceKcal > 0
            ? "Superávit estimado"
            : "Déficit estimado",
  };
}

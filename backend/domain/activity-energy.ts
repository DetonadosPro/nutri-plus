export const ENERGY_VERSION = "nutri-energy-1";
export const ACTIVITY_FACTORS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};
export type EnergyMode = "habitual_includes_exercise" | "base_plus_net";
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
  mode: EnergyMode,
  sessions: Array<{ outside_base: boolean; snapshot: { netKcal: number | null } }>,
) {
  const eligible = mode === "base_plus_net" ? sessions.filter((s) => s.outside_base) : [];
  const additionalKcal = eligible.some((s) => s.snapshot.netKcal == null)
    ? null
    : eligible.reduce((sum, s) => sum + s.snapshot.netKcal!, 0);
  const totalKcal = base == null || additionalKcal == null ? null : base + additionalKcal;
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

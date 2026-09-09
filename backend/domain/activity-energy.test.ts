import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  calculateRestDensityFactor,
  calculateStrengthTrainingCalories,
  energyBalance,
  manualEnergy,
  metEnergy,
  thermicEffectOfFood,
} from "./activity-energy";
describe("gasto e balanço estimados", () => {
  it("preserva códigos e METs da fonte oficial versionada", () => {
    const catalog = JSON.parse(
      readFileSync(new URL("../data/activities/catalog-2024-pt-BR.json", import.meta.url), "utf8"),
    );
    const source = JSON.parse(
      readFileSync(new URL("../data/activities/source-2024.json", import.meta.url), "utf8"),
    );
    expect(new Set(catalog.map((c: any) => c.code)).size).toBe(catalog.length);
    for (const c of catalog) {
      expect(source.find((s: any) => s.code === c.code)?.met).toBe(c.met);
      expect(c.aliases.length).toBeGreaterThan(0);
      expect(c.source.startsWith("https://pacompendium.com/")).toBe(true);
    }
  });
  it("converte minutos e distingue bruto de líquido", () => {
    expect(metEnergy(4, 70, 30)).toEqual({ grossKcal: 140, netKcal: 105 });
    expect(metEnergy(1, 70, 60).netKcal).toBe(0);
  });
  it("rejeita dados inválidos sem converter ausência em zero", () => {
    for (const n of [NaN, 0, -1, Infinity]) expect(() => metEnergy(4, n, 30)).toThrow();
  });
  it("não soma treino ao fator que já inclui atividade", () => {
    expect(
      energyBalance(2300, 2500, 0, "habitual_includes_exercise", [
        { outside_base: true, snapshot: { grossKcal: 600, netKcal: 500 } },
      ]).balanceKcal,
    ).toBe(-200);
  });
  it("soma o gasto bruto completo fora da base", () => {
    expect(
      energyBalance(2300, 2000, 0, "base_plus_net", [
        { outside_base: true, snapshot: { grossKcal: 300, netKcal: 200 } },
        { outside_base: false, snapshot: { grossKcal: 600, netKcal: 500 } },
      ]).balanceKcal,
    ).toBe(0);
  });
  it("mantém balanço neutro, positivo e negativo com rótulos", () => {
    expect(energyBalance(2000, 2000, 0, "base_plus_net", []).label).toBe("Neutro estimado");
    expect(energyBalance(2100, 2000, 0, "base_plus_net", []).label).toBe("Superávit estimado");
    expect(energyBalance(1900, 2000, 0, "base_plus_net", []).label).toBe("Déficit estimado");
  });
  it("não inventa gasto ou ingestão ausentes", () => {
    expect(energyBalance(null, 2000, 0, "base_plus_net", []).balanceKcal).toBeNull();
    expect(energyBalance(2000, null, 0, "base_plus_net", []).totalKcal).toBeNull();
    expect(
      energyBalance(2000, 2000, 0, "base_plus_net", [
        { outside_base: true, snapshot: { grossKcal: null, netKcal: null } },
      ]).balanceKcal,
    ).toBeNull();
  });
  it("calcula o TEF pelos macronutrientes registrados e o soma ao gasto", () => {
    expect(thermicEffectOfFood({ proteinG: 100, carbohydrateG: 200, fatG: 50 })).toBeCloseTo(166.75);
    expect(energyBalance(2300, 2000, 100, "base_plus_net", []).totalKcal).toBe(2100);
  });
  it("ajusta musculação de forma suave e limitada pelo descanso", () => {
    expect(calculateRestDensityFactor(30)).toBeGreaterThan(calculateRestDensityFactor(120));
    expect(calculateRestDensityFactor(120)).toBeGreaterThan(calculateRestDensityFactor(240));
    expect(calculateRestDensityFactor(1)).toBe(1.05);
    expect(calculateRestDensityFactor(1200)).toBe(0.95);
    expect(calculateRestDensityFactor(75)).toBeCloseTo(1.025);
  });
  it("rejeita descansos inválidos sem produzir NaN", () => {
    for (const value of [0, -1, NaN, Infinity])
      expect(() => calculateRestDensityFactor(value)).toThrow();
  });
  it("preserva zero e responde a peso, duração e intensidade antes do ajuste secundário", () => {
    expect(calculateStrengthTrainingCalories({ grossKcal: 0, netKcal: 0 }, 30).grossKcal).toBe(0);
    expect(() => calculateStrengthTrainingCalories({ grossKcal: -1, netKcal: 0 }, 30)).toThrow();
    const light30 = calculateStrengthTrainingCalories({ grossKcal: 210, netKcal: 150 }, 30).grossKcal;
    const light120 = calculateStrengthTrainingCalories({ grossKcal: 210, netKcal: 150 }, 120).grossKcal;
    const light240 = calculateStrengthTrainingCalories({ grossKcal: 210, netKcal: 150 }, 240).grossKcal;
    const doubleDuration = calculateStrengthTrainingCalories({ grossKcal: 420, netKcal: 300 }, 120).grossKcal;
    const heavier = calculateStrengthTrainingCalories({ grossKcal: 240, netKcal: 170 }, 120).grossKcal;
    const intense = calculateStrengthTrainingCalories({ grossKcal: 360, netKcal: 300 }, 120).grossKcal;
    expect(light30).toBeGreaterThan(light120);
    expect(light120).toBeGreaterThan(light240);
    expect(doubleDuration).toBeGreaterThan(light30);
    expect(heavier).toBeGreaterThan(light120);
    expect(intense).toBeGreaterThan(light30);
  });
  it("usa exatamente 3,0, 3,5, 4,0 e 6,0 MET na musculação", () => {
    const baseAt35Met = { grossKcal: 245, netKcal: 175 };
    expect(calculateStrengthTrainingCalories(baseAt35Met, 120, "light", 3.5).grossKcal).toBe(210);
    expect(calculateStrengthTrainingCalories(baseAt35Met, 120, "moderate", 3.5).grossKcal).toBe(245);
    expect(calculateStrengthTrainingCalories(baseAt35Met, 120, "intense", 3.5).grossKcal).toBe(280);
    const baseAt6Met = { grossKcal: 420, netKcal: 350 };
    expect(calculateStrengthTrainingCalories(baseAt6Met, 120, "vigorous", 6).grossKcal).toBe(420);
  });
  it("mantém progressões seguras na matriz de musculação", () => {
    const rests = [30, 60, 90, 120, 180, 240, 300];
    for (const intensity of ["light", "moderate", "intense", "vigorous"] as const) {
      const met = { light: 3, moderate: 3.5, intense: 4, vigorous: 6 }[intensity];
      const values = rests.map((rest) =>
        calculateStrengthTrainingCalories(metEnergy(met, 85, 60), rest, intensity, met).grossKcal,
      );
      expect(values.every(Number.isFinite)).toBe(true);
      expect(values.every((value) => value >= 0 && value < 2_000)).toBe(true);
      for (let index = 1; index < values.length; index++)
        expect(values[index - 1]).toBeGreaterThan(values[index]);
    }
    for (const minutes of [30, 60, 90])
      expect(metEnergy(3.5, 85, minutes).grossKcal).toBe(3.5 * 85 * minutes / 60);
    expect(metEnergy(3.5, 90, 60).grossKcal).toBeGreaterThan(metEnergy(3.5, 85, 60).grossKcal);
  });
  it("não desconta repouso duas vezes de calorias ativas manuais", () => {
    expect(manualEnergy(100, "net", 70, 60)).toEqual({ netKcal: 100, grossKcal: null });
    expect(manualEnergy(170, "gross", 70, 60).netKcal).toBe(100);
    expect(manualEnergy(170, "gross", null, 60).netKcal).toBeNull();
    expect(manualEnergy(170, "unknown", 70, 60).netKcal).toBeNull();
  });
});

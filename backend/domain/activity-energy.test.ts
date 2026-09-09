import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { energyBalance, manualEnergy, metEnergy, thermicEffectOfFood } from "./activity-energy";
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
        { outside_base: true, snapshot: { netKcal: 500 } },
      ]).balanceKcal,
    ).toBe(-200);
  });
  it("soma só líquido fora da base", () => {
    expect(
      energyBalance(2300, 2000, 0, "base_plus_net", [
        { outside_base: true, snapshot: { netKcal: 200 } },
        { outside_base: false, snapshot: { netKcal: 500 } },
      ]).balanceKcal,
    ).toBe(100);
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
        { outside_base: true, snapshot: { netKcal: null } },
      ]).balanceKcal,
    ).toBeNull();
  });
  it("calcula o TEF pelos macronutrientes registrados e o soma ao gasto", () => {
    expect(thermicEffectOfFood({ proteinG: 100, carbohydrateG: 200, fatG: 50 })).toBeCloseTo(166.75);
    expect(energyBalance(2300, 2000, 100, "base_plus_net", []).totalKcal).toBe(2100);
  });
  it("não desconta repouso duas vezes de calorias ativas manuais", () => {
    expect(manualEnergy(100, "net", 70, 60)).toEqual({ netKcal: 100, grossKcal: null });
    expect(manualEnergy(170, "gross", 70, 60).netKcal).toBe(100);
    expect(manualEnergy(170, "gross", null, 60).netKcal).toBeNull();
    expect(manualEnergy(170, "unknown", 70, 60).netKcal).toBeNull();
  });
});

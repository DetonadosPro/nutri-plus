import { describe, expect, it } from "vitest";
import { validateTacoDataset } from "../taco-import";
import {
  macroEnergy,
  macroGoalsFromEnergy,
  patientMetrics,
  scaleNutrients,
  sumNutrientSets,
  waterGoalMl,
} from "./nutrition";

describe("validação TACO", () => {
  const nutrient = {
    code: "energia_kcal",
    name: "Energia",
    unit: "kcal",
    group: "energy" as const,
    sort_order: 1,
  };
  it("rejeita um conjunto incompleto", () => {
    expect(() =>
      validateTacoDataset({
        metadata: {
          source: "TACO",
          edition: "4ª",
          reference_amount: 100,
          reference_unit: "g",
          audit: { foods: 0 },
        },
        nutrients: [nutrient],
        foods: [],
      }),
    ).toThrow(/597/);
  });
});

describe("cálculos centralizados por porção", () => {
  const base = {
    energia_kcal: 100,
    energia_kj: 420,
    proteina_g: 7,
    carboidrato_g: 20,
    lipideos_g: 2,
    fibra_g: 3,
  };
  it("mantém os valores em 100 g", () =>
    expect(scaleNutrients(base, 100).values.proteina_g).toBe(7));
  it("calcula corretamente 150 g", () =>
    expect(scaleNutrients(base, 150).values.proteina_g).toBeCloseTo(10.5));
  it("preserva zero real", () =>
    expect(scaleNutrients({ sodio_mg: 0 }, 250).values.sodio_mg).toBe(0));
  it("soma vários alimentos e refeições com a mesma regra", () => {
    const meal = sumNutrientSets([scaleNutrients(base, 150), scaleNutrients(base, 50)]);
    const day = sumNutrientSets([meal, scaleNutrients(base, 100)]);
    expect(meal.values.proteina_g).toBeCloseTo(14);
    expect(day.values.proteina_g).toBeCloseTo(21);
    expect(day.values.energia_kcal).toBeCloseTo(300);
  });
  it("soma os valores disponíveis sem transformar o parcial em indisponível", () => {
    const total = sumNutrientSets([
      scaleNutrients({ vitamina_c_mg: 10 }, 100),
      scaleNutrients({ vitamina_c_mg: null }, 100),
    ]);
    expect(total.values.vitamina_c_mg).toBe(10);
    expect(total.unavailable).toContain("vitamina_c_mg");
  });
  it("mantém o total indisponível quando nenhum valor é conhecido", () => {
    const total = sumNutrientSets([
      scaleNutrients({ vitamina_c_mg: null }, 100),
      scaleNutrients({ vitamina_c_mg: null }, 50),
    ]);
    expect(total.values.vitamina_c_mg).toBeNull();
    expect(total.unavailable).toContain("vitamina_c_mg");
  });
  it("calcula distribuição energética uma única vez no backend", () => {
    const energy = macroEnergy({
      proteina_g: 10,
      carboidrato_g: 20,
      lipideos_g: 5,
      energia_kcal: 170,
    });
    expect(energy.calculatedKcal).toBe(165);
    expect(energy.proteinPercent + energy.carbohydratePercent + energy.fatPercent).toBeCloseTo(100);
  });
  it("calcula a meta de água como 40 ml por kg", () => {
    expect(waterGoalMl(80)).toBe(3200);
    expect(waterGoalMl(65.4)).toBeCloseTo(2616);
    expect(waterGoalMl(null)).toBeNull();
    expect(waterGoalMl(0)).toBeNull();
  });
  it("deriva os três macros das kcal e dos percentuais individuais", () => {
    expect(
      macroGoalsFromEnergy(2000, {
        carbohydratePercent: 45,
        proteinPercent: 30,
        fatPercent: 25,
      }),
    ).toEqual({
      carbohydrateG: 225,
      proteinG: 150,
      fatG: (2000 * 0.25) / 9,
    });
  });
  it("rejeita uma distribuição que não totaliza 100%", () => {
    expect(() =>
      macroGoalsFromEnergy(2000, {
        carbohydratePercent: 45,
        proteinPercent: 30,
        fatPercent: 30,
      }),
    ).toThrow(/100%/);
  });
  it("calcula IMC e metabolismo basal por Mifflin-St Jeor", () => {
    expect(patientMetrics({ weightKg: 80, heightCm: 180, age: 35, sex: "male" })).toMatchObject({
      bmi: 24.691358024691358,
      basalKcal: 1755,
      formula: "Mifflin-St Jeor",
    });
  });
});

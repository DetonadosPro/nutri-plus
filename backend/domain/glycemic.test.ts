import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readGlycemicIndexWorkbook } from "../ig-import";
import {
  calculateGlycemicLoad as calculateBackendGlycemicLoad,
  calculateNormalizedGlycemicLoad,
  dailyGlycemicSummary,
  periodGlycemicSummary,
} from "./glycemic";
import {
  calculateGlycemicLoad,
  displayGlycemicValue,
  glycemicIndexLevel,
  glycemicLoadLevel,
} from "../../frontend/lib/glycemic";

describe("planilha de índice glicêmico TACO", () => {
  const workbookPath = resolve(
    import.meta.dirname,
    "..",
    "data",
    "taco",
    "ig_taco_597_alimentos.xlsx",
  );

  it("valida as 597 linhas por numero_alimento sem duplicatas", async () => {
    const { rows, audit } = await readGlycemicIndexWorkbook(workbookPath);
    expect(audit).toMatchObject({
      rowsProcessed: 597,
      numericValues: 233,
      nullValues: 364,
      duplicateIds: [],
      invalidRows: [],
    });
    expect(new Set(rows.map((row) => row.sourceCode)).size).toBe(597);
  });

  it("preserva IG numérico e IG ausente como null real", async () => {
    const { rows } = await readGlycemicIndexWorkbook(workbookPath);
    expect(rows.find((row) => row.sourceCode === "1")?.glycemicIndex).toBe(65);
    expect(rows.find((row) => row.sourceCode === "2")?.glycemicIndex).toBeNull();
    expect(
      JSON.stringify({ glycemicIndex: rows.find((row) => row.sourceCode === "2")?.glycemicIndex }),
    ).toBe('{"glycemicIndex":null}');
  });
});

describe("carga glicêmica", () => {
  it("normaliza a CG por 1.000 kcal e classifica todos os limites", () => {
    const cases = [
      [100, 2000, 50, "moderada"],
      [40, 1000, 40, "boa"],
      [149, 2000, 74.5, "elevada"],
      [150, 2000, 75, "muito elevada"],
      [0, 2000, 0, "excelente"],
    ] as const;
    for (const [rawGL, totalKcal, normalizedGL, classification] of cases) {
      expect(calculateNormalizedGlycemicLoad(rawGL, totalKcal)).toMatchObject({
        rawGL,
        totalKcal,
        normalizedGL,
        per1000Kcal: normalizedGL,
        classification,
      });
    }
  });

  it("não divide por zero nem inventa normalização sem energia", () => {
    expect(calculateNormalizedGlycemicLoad(100, 0)).toMatchObject({
      rawGL: 100,
      totalKcal: 0,
      normalizedGL: null,
      per1000Kcal: null,
      classification: null,
    });
    expect(calculateNormalizedGlycemicLoad(100, null).normalizedGL).toBeNull();
    expect(calculateNormalizedGlycemicLoad(0, 2000).normalizedGL).toBe(0);
  });

  it("calcula CG pela porção quando IG e carboidrato existem", () => {
    expect(calculateGlycemicLoad(65, 20, 150)).toBeCloseTo(19.5);
    expect(calculateBackendGlycemicLoad(65, 30)).toBeCloseTo(19.5);
    expect(calculateBackendGlycemicLoad(65, 20, 150)).toBeCloseTo(19.5);
  });

  it("propaga IG ausente para CG ausente, sem converter em zero", () => {
    expect(calculateGlycemicLoad(null, 20, 150)).toBeNull();
    expect(calculateBackendGlycemicLoad(null, 20)).toBeNull();
    expect(calculateGlycemicLoad(65, null, 150)).toBeNull();
    expect(displayGlycemicValue(null)).toBe("—");
    expect(displayGlycemicValue(0)).toBe("0");
    expect(displayGlycemicValue(Number.NaN)).toBe("—");
    expect(glycemicIndexLevel(Number.NaN)).toBeNull();
  });

  it("classifica IG e CG nos limites baixo, médio e alto", () => {
    expect([glycemicIndexLevel(55), glycemicIndexLevel(56), glycemicIndexLevel(70)]).toEqual([
      "Baixo",
      "Médio",
      "Alto",
    ]);
    expect([glycemicLoadLevel(10), glycemicLoadLevel(11), glycemicLoadLevel(20)]).toEqual([
      "Baixo",
      "Médio",
      "Alto",
    ]);
  });

  it("calcula IG ponderado e CG total do dia", () => {
    expect(
      dailyGlycemicSummary([
        { glycemicIndex: 50, carbohydrateGrams: 20 },
        { glycemicIndex: 70, carbohydrateGrams: 10 },
      ]),
    ).toEqual({
      index: 56.666666666666664,
      load: 17,
      rawGL: 17,
      totalKcal: null,
      normalizedGL: null,
      per1000Kcal: null,
      classification: null,
      coveredEntries: 2,
      unavailableEntries: 0,
    });
  });

  it("normaliza a CG diária somente quando há energia positiva", () => {
    expect(
      dailyGlycemicSummary([{ glycemicIndex: 50, carbohydrateGrams: 20 }], 1000),
    ).toMatchObject({
      load: 10,
      rawGL: 10,
      totalKcal: 1000,
      normalizedGL: 10,
      per1000Kcal: 10,
      classification: "excelente",
    });
  });

  it("ignora somente o alimento sem IG e mantém o resumo dos alimentos cobertos", () => {
    expect(
      dailyGlycemicSummary([
        { glycemicIndex: 50, carbohydrateGrams: 20 },
        { glycemicIndex: null, carbohydrateGrams: 10 },
      ]),
    ).toEqual({
      index: 50,
      load: 10,
      rawGL: 10,
      totalKcal: null,
      normalizedGL: null,
      per1000Kcal: null,
      classification: null,
      coveredEntries: 1,
      unavailableEntries: 1,
    });
  });

  it("calcula o período pela relação dos agregados, não pela média simples", () => {
    expect(
      periodGlycemicSummary([
        { load: 100, totalKcal: 1000, coveredEntries: 1, unavailableEntries: 0 },
        { load: 100, totalKcal: 3000, coveredEntries: 1, unavailableEntries: 0 },
      ]),
    ).toMatchObject({
      rawGL: 200,
      load: 200,
      totalKcal: 4000,
      normalizedGL: 50,
      per1000Kcal: 50,
      classification: "moderada",
      coveredDays: 2,
      unavailableDays: 0,
    });
  });
});

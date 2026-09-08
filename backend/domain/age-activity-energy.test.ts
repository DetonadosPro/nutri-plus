import { describe, expect, it } from "vitest";
import { ageSpecificEnergy, referenceForAge, schofieldRestingKcal } from "./age-activity-energy";

describe("referências de atividade por idade", () => {
  it("seleciona METy por uma das quatro faixas juvenis", () => {
    expect(referenceForAge("17190", 3.8, 8)?.met).toBe(3.8);
    expect(referenceForAge("17190", 3.8, 11)?.met).toBe(4.1);
    expect(referenceForAge("17190", 3.8, 14)?.met).toBe(4.3);
    expect(referenceForAge("17190", 3.8, 17)?.met).toBe(4.5);
  });
  it("mantém o adulto e troca para MET60+ quando há equivalência", () => {
    expect(referenceForAge("17190", 3.8, 30)?.referenceKind).toBe("adult-met");
    expect(referenceForAge("17190", 3.8, 65)).toMatchObject({ met: 5.3, referenceCode: "1719060" });
    expect(referenceForAge("18290", 8, 65)).toBeNull();
  });
  it("usa Schofield e a fórmula oficial METy vezes basal por minuto", () => {
    const resting = schofieldRestingKcal(40, 14, "male")!;
    const ref = referenceForAge("17190", 3.8, 14)!;
    const result = ageSpecificEnergy(ref, 40, 30, resting);
    expect(result.grossKcal).toBeCloseTo(ref.met * (resting / 1440) * 30);
  });
  it("usa o repouso MET60+ de 2,7 ml por kg por minuto", () => {
    const ref = referenceForAge("17190", 3.8, 65)!;
    expect(ageSpecificEnergy(ref, 70, 60, null).grossKcal).toBeCloseTo(5.3 * 2.7 * 70 * 60 * 5 / 1000);
  });
});

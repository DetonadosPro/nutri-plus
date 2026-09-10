export type Sex = "male" | "female";

export type ActivityReference = {
  met: number;
  referenceCode: string;
  referenceKind: "adult-met" | "youth-mety";
  ageBand: string;
  source: string;
  notes: string;
};

const YOUTH_SOURCE = "https://www.nccor.org/tools-youthcompendium/met-view-by-individual-category/";
// Explicit crosswalks only: each Adult Compendium activity below has a directly
// comparable entry in the Youth Compendium. Unsupported youth activities stay out
// of the age-specific catalog instead of borrowing an arbitrary MET.
const youth: Record<string, [string, number, number, number, number]> = {
  "02054": ["85100X", 3.0, 3.0, 2.9, 2.9],
  "02056": ["30300X", 3.9, 4.0, 4.0, 4.1],
  "02020": ["30200X", 4.0, 4.1, 4.1, 4.2],
  "02022": ["30200X", 4.0, 4.1, 4.1, 4.2],
  "02024": ["30200X", 4.0, 4.1, 4.1, 4.2],
  "02000": ["40100X", 3.6, 4.1, 4.5, 4.8],
  "02005": ["40100X", 3.6, 4.1, 4.5, 4.8],
  "02006": ["40100X", 3.6, 4.1, 4.5, 4.8],
  "17151": ["80120X", 2.5, 2.6, 2.7, 2.8],
  "17152": ["80160X", 2.8, 3.0, 3.2, 3.4],
  "17170": ["80180X", 3.3, 3.5, 3.6, 3.7],
  "17190": ["80200X", 3.8, 4.1, 4.3, 4.5],
  "17200": ["80220X", 4.6, 5.0, 5.3, 5.5],
  "17220": ["80240X", 4.8, 5.2, 5.6, 6.0],
  "17160": ["80320X", 3.6, 3.9, 4.2, 4.4],
  "12020": ["60140X", 6.8, 7.4, 7.9, 8.4],
  "12028": ["60200X", 6.5, 7.2, 7.7, 8.3],
  "12030": ["60240X", 7.2, 8.0, 8.6, 9.3],
  "12050": ["60280X", 8.2, 9.1, 9.8, 10.5],
  "12060": ["60320X", 9.3, 10.2, 11.0, 11.8],
  "01015": ["25160X", 3.7, 3.9, 4.0, 4.2],
  "01016": ["25120X", 4.7, 5.3, 5.8, 6.4],
  "01017": ["25100X", 6.5, 6.5, 7.3, 8.1],
  "18240": ["75180X", 9.5, 9.1, 8.9, 8.6],
  "18290": ["75120X", 9.7, 9.4, 9.1, 8.8],
  "18230": ["75160X", 10.6, 10.4, 10.2, 10.1],
  "15040": ["65100X", 6.7, 7.0, 7.2, 7.5],
  "15050": ["65120X", 5.9, 6.2, 6.4, 6.6],
  "15605": ["65480X", 7.7, 8.1, 8.4, 8.7],
  "15610": ["65480X", 7.7, 8.1, 8.4, 8.7],
  "15711": ["65560X", 5.0, 5.1, 5.2, 5.3],
  "15720": ["65560X", 5.0, 5.1, 5.2, 5.3],
  "15675": ["65520X", 6.1, 6.3, 6.5, 6.7],
  "15690": ["65520X", 6.1, 6.3, 6.5, 6.7],
  "15110": ["65180X", 4.9, 5.0, 5.0, 5.1],
  "15660": ["65500X", 4.2, 4.2, 4.2, 4.2],
  "03010": ["40100X", 3.6, 4.1, 4.5, 4.8],
  "03012": ["40100X", 3.6, 4.1, 4.5, 4.8],
  "05011": ["45320X", 3.6, 3.5, 3.3, 3.2],
  "05012": ["45320X", 3.6, 3.5, 3.3, 3.2],
  "05025": ["45220X", 4.2, 4.0, 3.9, 3.8],
  "05026": ["45220X", 4.2, 4.0, 3.9, 3.8],
  "05027": ["45220X", 4.2, 4.0, 3.9, 3.8],
  "05043": ["45340X", 3.9, 3.7, 3.6, 3.4],
  "22240": ["15100X", 3.8, 4.1, 4.4, 4.6],
  "22320": ["15140X", 5.4, 5.8, 6.2, 6.5],
};

export function referenceForAge(code: string, adultMet: number, age: number | null): ActivityReference | null {
  if (age == null || age < 6) return null;
  if (age <= 18) {
    const row = youth[code];
    if (!row) return null;
    const index = age <= 9 ? 1 : age <= 12 ? 2 : age <= 15 ? 3 : 4;
    return { met: row[index], referenceCode: row[0], referenceKind: "youth-mety", ageBand: age <= 9 ? "6–9" : age <= 12 ? "10–12" : age <= 15 ? "13–15" : "16–18", source: YOUTH_SOURCE, notes: "Youth Compendium: METy suavizado para a faixa etária." };
  }
  return { met: adultMet, referenceCode: code, referenceKind: "adult-met", ageBand: "19+", source: "https://pacompendium.com/adult-compendium/", notes: "Compendium of Physical Activities 2024 para adultos." };
}

export function schofieldRestingKcal(weightKg: number, age: number, sex: Sex) {
  if (weightKg <= 0 || age < 6 || age > 18) return null;
  if (sex === "male") return age < 10 ? 22.706 * weightKg + 504.3 : 17.686 * weightKg + 658.2;
  return age < 10 ? 20.315 * weightKg + 485.9 : 13.384 * weightKg + 692.6;
}

export function ageSpecificEnergy(reference: ActivityReference, weightKg: number, minutes: number, restingKcal: number | null) {
  if (![weightKg, minutes, reference.met].every((v) => Number.isFinite(v) && v > 0)) throw new Error("Referência, peso e duração devem ser positivos.");
  if (reference.referenceKind === "youth-mety") {
    if (restingKcal == null) throw new Error("O cálculo juvenil exige gasto de repouso disponível.");
    const rest = (restingKcal / 1440) * minutes;
    return { grossKcal: reference.met * rest, netKcal: (reference.met - 1) * rest };
  }
  const rest = (weightKg * minutes) / 60;
  return { grossKcal: reference.met * rest, netKcal: (reference.met - 1) * rest };
}

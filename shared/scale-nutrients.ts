export function scaleNutrients(basePer100g: Record<string, number | null | undefined>, grams: number) {
  if (!Number.isFinite(grams) || grams < 0) throw new Error('A quantidade deve ser um número não negativo.');
  const values: Record<string, number | null> = {};
  const unavailable: string[] = [];
  for (const [code, value] of Object.entries(basePer100g)) {
    if (value == null || !Number.isFinite(value)) { values[code] = null; unavailable.push(code); }
    else values[code] = value * (grams / 100);
  }
  return { values, unavailable };
}

/** CG absoluta de uma porção: (IG x carboidrato disponível) / 100. */
export function calculateGlycemicLoad(
  glycemicIndex: number | null | undefined,
  carbohydratePer100g: number | null | undefined,
  grams?: number,
) {
  if (
    glycemicIndex == null ||
    carbohydratePer100g == null ||
    !Number.isFinite(glycemicIndex) ||
    !Number.isFinite(carbohydratePer100g) ||
    glycemicIndex < 0 ||
    carbohydratePer100g < 0 ||
    (grams != null && (!Number.isFinite(grams) || grams < 0))
  )
    return null;
  const carbohydrateGrams =
    grams == null ? carbohydratePer100g : (carbohydratePer100g * grams) / 100;
  return (glycemicIndex * carbohydrateGrams) / 100;
}

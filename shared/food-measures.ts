export type FoodMeasure = {
  id: number;
  kind: 'mass' | 'volume' | 'count' | 'household';
  name: string;
  plural: string;
  quantity: number;
  grams: number;
  source: string;
  reference: string;
  isDefault: boolean;
};

export const gramMeasure: FoodMeasure = { id: 0, kind: 'mass', name: 'g', plural: 'g', quantity: 1, grams: 1, source: 'SI', reference: 'Massa em gramas', isDefault: false };
export function measureGrams(quantity: number, measure: FoodMeasure) {
  if (![quantity, measure.quantity, measure.grams].every(n => Number.isFinite(n) && n > 0)) throw new Error('Quantidade ou conversão inválida.');
  const grams = quantity * (measure.grams / measure.quantity);
  if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) throw new Error('Informe uma quantidade equivalente a até 5.000 g.');
  return grams;
}
export function measureLabel(quantity: number, measure: Pick<FoodMeasure, 'name' | 'plural'>) {
  return quantity === 1 ? measure.name : measure.plural;
}
export function formatServing(entry: { amount: number; unit: string; grams_equivalent: number; measure_snapshot?: FoodMeasure | null }) {
  const quantity = entry.measure_snapshot ? entry.amount : entry.unit === 'ml' ? entry.amount : entry.grams_equivalent;
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(quantity)} ${entry.measure_snapshot ? measureLabel(quantity, entry.measure_snapshot) : entry.unit === 'ml' ? 'mL' : 'g'}`;
}

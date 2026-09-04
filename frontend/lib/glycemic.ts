export { calculateGlycemicLoad } from '../../shared/glycemic';

export function displayGlycemicValue(
  value: number | null | undefined,
  formatter: (value: number) => string = String,
) {
  return value == null || !Number.isFinite(value) ? '—' : formatter(value);
}

export type GlycemicLevel = 'Baixo' | 'Médio' | 'Alto';

export type NormalizedGlycemicClassification =
  | 'excelente'
  | 'boa'
  | 'moderada'
  | 'elevada'
  | 'muito elevada';

export const normalizedGlycemicClassificationLabel: Record<
  NormalizedGlycemicClassification,
  string
> = {
  excelente: 'Excelente',
  boa: 'Boa',
  moderada: 'Moderada',
  elevada: 'Elevada',
  'muito elevada': 'Muito elevada',
};

export const normalizedGlycemicClassificationDescription: Record<
  NormalizedGlycemicClassification,
  string
> = {
  excelente: 'Carga glicêmica baixa em relação à energia consumida.',
  boa: 'Boa relação entre carga glicêmica e ingestão energética.',
  moderada: 'Carga glicêmica moderada em relação à energia consumida.',
  elevada: 'Carga glicêmica relativamente elevada.',
  'muito elevada': 'Carga glicêmica alta em relação à energia consumida.',
};

export function glycemicIndexLevel(
  value: number | null | undefined,
): GlycemicLevel | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= 55) return 'Baixo';
  if (value <= 69) return 'Médio';
  return 'Alto';
}

export function glycemicLoadLevel(
  value: number | null | undefined,
): GlycemicLevel | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= 10) return 'Baixo';
  if (value <= 19) return 'Médio';
  return 'Alto';
}

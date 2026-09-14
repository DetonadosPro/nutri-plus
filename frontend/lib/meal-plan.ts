import type { MealPlan, NutrientMap } from '../app/types';

export const PLAN_MACROS = [
  'energia_kcal',
  'proteina_g',
  'carboidrato_g',
  'lipideos_g',
  'fibra_alimentar_g',
] as const;
export function nutrientValue(values: NutrientMap, code: string) {
  return typeof values[code] === 'number' ? values[code]! : 0;
}
export function goalPercent(value: number, goal: number | null | undefined) {
  return goal && goal > 0 ? (value / goal) * 100 : null;
}
export function moveId(ids: number[], id: number, direction: -1 | 1) {
  const index = ids.indexOf(id),
    target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function preferredPlan(
  plans: Array<Pick<MealPlan, 'status' | 'version' | 'id'>>,
) {
  return (
    [...plans].sort(
      (a, b) =>
        (a.status === 'draft' ? 0 : a.status === 'active' ? 1 : 2) -
          (b.status === 'draft' ? 0 : b.status === 'active' ? 1 : 2) ||
        b.version - a.version,
    )[0] ?? null
  );
}

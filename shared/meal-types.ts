export const MEAL_TYPE_VALUES = [
  'breakfast',
  'morning_snack',
  'lunch',
  'afternoon_snack',
  'dinner',
  'supper',
  'other',
] as const;

export type MealType = (typeof MEAL_TYPE_VALUES)[number];

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Café da manhã',
  morning_snack: 'Lanche da manhã',
  lunch: 'Almoço',
  afternoon_snack: 'Lanche da tarde',
  dinner: 'Jantar',
  supper: 'Ceia',
  other: 'Outra refeição',
};

export const MEAL_TYPE_ORDER = Object.fromEntries(
  MEAL_TYPE_VALUES.map((value, index) => [value, index]),
) as Record<MealType, number>;

export function isMealType(value: string): value is MealType {
  return MEAL_TYPE_VALUES.includes(value as MealType);
}

import { Coffee, Cookie, Moon, Soup, Sun, Sunset, Utensils } from 'lucide-react';
import {
  MEAL_TYPE_LABELS,
  MEAL_TYPE_ORDER,
  MEAL_TYPE_VALUES,
  type MealType,
} from '../../shared/meal-types';

export { MEAL_TYPE_LABELS, MEAL_TYPE_ORDER, MEAL_TYPE_VALUES };
export type { MealType };

export const MEAL_TYPES = [
  { value: MEAL_TYPE_VALUES[0], label: MEAL_TYPE_LABELS.breakfast, short: 'Café', icon: Coffee },
  { value: MEAL_TYPE_VALUES[1], label: MEAL_TYPE_LABELS.morning_snack, short: 'Lanche manhã', icon: Cookie },
  { value: MEAL_TYPE_VALUES[2], label: MEAL_TYPE_LABELS.lunch, short: 'Almoço', icon: Sun },
  { value: MEAL_TYPE_VALUES[3], label: MEAL_TYPE_LABELS.afternoon_snack, short: 'Lanche tarde', icon: Sunset },
  { value: MEAL_TYPE_VALUES[4], label: MEAL_TYPE_LABELS.dinner, short: 'Jantar', icon: Soup },
  { value: MEAL_TYPE_VALUES[5], label: MEAL_TYPE_LABELS.supper, short: 'Ceia', icon: Moon },
  { value: MEAL_TYPE_VALUES[6], label: MEAL_TYPE_LABELS.other, short: 'Outra', icon: Utensils },
] as const;

export const mealDefinition = (value: string) => MEAL_TYPES.find((item) => item.value === value) ?? MEAL_TYPES[6];

import { Coffee, Cookie, Moon, Soup, Sun, Sunset, Utensils } from 'lucide-react';

export const MEAL_TYPES = [
  { value: 'breakfast', label: 'Café da manhã', short: 'Café', icon: Coffee },
  { value: 'morning_snack', label: 'Lanche da manhã', short: 'Lanche manhã', icon: Cookie },
  { value: 'lunch', label: 'Almoço', short: 'Almoço', icon: Sun },
  { value: 'afternoon_snack', label: 'Lanche da tarde', short: 'Lanche tarde', icon: Sunset },
  { value: 'dinner', label: 'Jantar', short: 'Jantar', icon: Soup },
  { value: 'supper', label: 'Ceia', short: 'Ceia', icon: Moon },
  { value: 'other', label: 'Outra refeição', short: 'Outra', icon: Utensils },
] as const;

export type MealType = (typeof MEAL_TYPES)[number]['value'];

export const mealDefinition = (value: string) => MEAL_TYPES.find((item) => item.value === value) ?? MEAL_TYPES[6];

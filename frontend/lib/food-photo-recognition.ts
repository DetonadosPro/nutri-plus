import type { Food } from '../app/types';
import { foodDisplayName } from './food-name';

export type MeatFamily = 'chicken' | 'pork' | 'beef';

export const MEAT_FAMILY_OPTIONS: ReadonlyArray<{ value: MeatFamily; label: string }> = [
  { value: 'chicken', label: 'Frango' },
  { value: 'pork', label: 'Porco' },
  { value: 'beef', label: 'Carne bovina' },
];

export function recognitionFoodLabel(food: Food) {
  return food.recognitionName?.trim() || foodDisplayName(food);
}

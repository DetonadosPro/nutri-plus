import { z } from 'zod';
import { db } from './db';
import { gramMeasure, measureGrams, type FoodMeasure } from '../shared/food-measures';

export const quantityInput = z.object({
  grams: z.number().positive().max(5000).optional(),
  quantity: z.number().positive().optional(),
  measureId: z.number().int().nonnegative().optional(),
}).refine(v => v.grams != null ? v.quantity == null && v.measureId == null : v.quantity != null && v.measureId != null, 'Informe gramas ou quantidade e medida.');

export async function measuresForFoods(ids: number[]) {
  const rows = ids.length ? await db.prepare(`SELECT id,food_id,kind,name,plural,quantity,grams,source,reference,is_default AS "isDefault" FROM food_measures WHERE food_id=ANY(?::bigint[]) ORDER BY is_default DESC,id`).all<FoodMeasure & {food_id:number}>(ids) : [];
  return new Map(ids.map(id => [id, [...rows.filter(r => r.food_id === id).map(({food_id: _, ...m}) => m), gramMeasure]]));
}
export async function resolveQuantity(foodId: number, input: z.infer<typeof quantityInput>, snapshot?: FoodMeasure | null) {
  quantityInput.parse(input);
  if (input.grams != null) return { amount: input.grams, unit: 'g', grams: input.grams, snapshot: null };
  const measure = input.measureId === 0 ? gramMeasure : snapshot?.id === input.measureId ? snapshot : (await measuresForFoods([foodId])).get(foodId)?.find(m => m.id === input.measureId);
  if (!measure) throw new Error('Medida indisponível para este alimento.');
  return { amount: input.quantity!, unit: measure.name, grams: measureGrams(input.quantity!, measure), snapshot: measure.id === 0 ? null : measure };
}

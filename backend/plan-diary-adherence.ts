import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from './db';
import type { AuthUser } from './auth';
import { addCalendarDays, inclusiveDaysBetween, isCalendarDate } from './domain/datetime';
import { MEAL_TYPE_ORDER, MEAL_TYPE_VALUES, type MealType } from '../shared/meal-types';

export const ADHERENCE_VERSION = 'plan-diary-adherence-v1';
export const QUANTITY_TOLERANCE = {
  withinPercent: 0.1,
  withinAbsoluteGrams: 5,
  nearPercent: 0.25,
  nearAbsoluteGrams: 10,
} as const;

export type QuantityAlignment = 'within_target' | 'near_target' | 'outside_target' | 'not_evaluable';
export type AdherenceItemState = 'matched_original' | 'matched_substitution' | 'matched_quantity_difference' | 'planned_not_recorded' | 'extra_recorded';
export type AdherenceMealState = 'aligned' | 'mostly_aligned' | 'different' | 'not_evaluable';

type PlannedItem = { id: number; foodId: number; name: string; amount: number; unit: string; grams: number | null; position: number; substitutions: Array<{ foodId: number; name: string; amount: number; unit: string; grams: number | null }> };
type DiaryItem = { id: number; foodId: number; name: string; amount: number; unit: string; grams: number | null; position: number };
export type AdherenceItem = {
  state: AdherenceItemState;
  planned: null | { name: string; amount: number; unit: string; grams: number | null };
  recorded: null | { name: string; amount: number; unit: string; grams: number | null };
  approvedSubstitution: boolean;
  quantity: QuantityAlignment;
  differenceGrams: number | null;
  differencePercent: number | null;
};

function publicItem(item: PlannedItem | DiaryItem) {
  return { name: item.name, amount: item.amount, unit: item.unit, grams: item.grams };
}

export function quantityAlignment(planned: number | null, recorded: number | null) {
  if (!(planned && planned > 0) || !(recorded && recorded > 0)) return { status: 'not_evaluable' as const, differenceGrams: null, differencePercent: null };
  const differenceGrams = Math.abs(recorded - planned);
  const differencePercent = differenceGrams / planned;
  const within = differenceGrams <= QUANTITY_TOLERANCE.withinAbsoluteGrams || differencePercent <= QUANTITY_TOLERANCE.withinPercent;
  const near = differenceGrams <= QUANTITY_TOLERANCE.nearAbsoluteGrams || differencePercent <= QUANTITY_TOLERANCE.nearPercent;
  return { status: within ? 'within_target' as const : near ? 'near_target' as const : 'outside_target' as const, differenceGrams, differencePercent };
}

function hungarian(cost: number[][]) {
  const n = cost.length;
  if (!n) return [] as number[];
  const m = cost[0].length;
  const u = Array(n + 1).fill(0), v = Array(m + 1).fill(0), p = Array(m + 1).fill(0), way = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(m + 1).fill(Number.POSITIVE_INFINITY), used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY, j1 = 0;
      for (let j = 1; j <= m; j += 1) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j += 1) used[j] ? (u[p[j]] += delta, v[j] -= delta) : (minv[j] -= delta);
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 !== 0);
  }
  const assignment = Array(n).fill(-1);
  for (let j = 1; j <= m; j += 1) if (p[j]) assignment[p[j] - 1] = j - 1;
  return assignment;
}

export function matchMealItems(planned: PlannedItem[], diary: DiaryItem[]) {
  if (!diary.length) return planned.map<AdherenceItem>((item) => ({ state: 'planned_not_recorded', planned: publicItem(item), recorded: null, approvedSubstitution: false, quantity: 'not_evaluable', differenceGrams: null, differencePercent: null }));
  const size = Math.max(planned.length, diary.length);
  const FORBIDDEN = 1e12, UNMATCHED = 1e9;
  const cost = Array.from({ length: size }, (_, plannedIndex) => Array.from({ length: size }, (_, diaryIndex) => {
    if (plannedIndex >= planned.length) return 0;
    if (diaryIndex >= diary.length) return UNMATCHED + plannedIndex;
    const source = planned[plannedIndex], target = diary[diaryIndex];
    const substitution = source.substitutions.find((entry) => entry.foodId === target.foodId);
    if (source.foodId !== target.foodId && !substitution) return FORBIDDEN;
    const expected = substitution?.grams ?? source.grams;
    const difference = expected && target.grams ? Math.abs(target.grams - expected) / expected : 1;
    return (substitution ? 1e6 : 0) + Math.round(difference * 100_000) + diaryIndex * 10 + plannedIndex;
  }));
  const assignment = hungarian(cost), used = new Set<number>(), result: AdherenceItem[] = [];
  for (let index = 0; index < planned.length; index += 1) {
    const diaryIndex = assignment[index];
    if (diaryIndex < 0 || diaryIndex >= diary.length || cost[index][diaryIndex] >= UNMATCHED) {
      result.push({ state: 'planned_not_recorded', planned: publicItem(planned[index]), recorded: null, approvedSubstitution: false, quantity: 'not_evaluable', differenceGrams: null, differencePercent: null });
      continue;
    }
    used.add(diaryIndex);
    const source = planned[index], target = diary[diaryIndex];
    const substitution = source.substitutions.find((entry) => entry.foodId === target.foodId);
    const quantity = quantityAlignment(substitution?.grams ?? source.grams, target.grams);
    result.push({ state: quantity.status === 'outside_target' ? 'matched_quantity_difference' : substitution ? 'matched_substitution' : 'matched_original', planned: publicItem(source), recorded: publicItem(target), approvedSubstitution: Boolean(substitution), quantity: quantity.status, differenceGrams: quantity.differenceGrams, differencePercent: quantity.differencePercent });
  }
  diary.forEach((item, index) => { if (!used.has(index)) result.push({ state: 'extra_recorded', planned: null, recorded: publicItem(item), approvedSubstitution: false, quantity: 'not_evaluable', differenceGrams: null, differencePercent: null }); });
  return result;
}

export function mealState(items: AdherenceItem[]): AdherenceMealState {
  if (!items.some((item) => item.recorded)) return 'not_evaluable';
  const matches = items.filter((item) => item.state.startsWith('matched_'));
  if (!matches.length) return 'different';
  const complete = items.every((item) => item.state !== 'planned_not_recorded') && matches.every((item) => item.quantity !== 'outside_target');
  return complete ? 'aligned' : 'mostly_aligned';
}

type PlanRow = { plan_id: number; version: number; effective_date: string; published_at: string; meal_id: number; meal_type: MealType; item_id: number; food_id: number; display_name: string; amount: number; unit: string; grams_equivalent: number | null; position: number };
type SubstitutionRow = { item_id: number; food_id: number; display_name: string; amount: number; unit: string; grams_equivalent: number | null };
type DiaryRow = { log_date: string; meal_id: number; meal_type: MealType; entry_id: number; food_id: number; display_name: string; amount: number; unit: string; grams_equivalent: number | null; position: number };

export async function adherenceForPeriod(patientId: number, from: string, to: string) {
  const started = performance.now();
  const plans = await db.prepare(`SELECT p.id plan_id,p.version,to_char((p.published_at AT TIME ZONE 'America/Sao_Paulo')::date + 1,'YYYY-MM-DD') effective_date,p.published_at,
    m.id meal_id,m.meal_type,i.id item_id,i.food_id,COALESCE(f.display_name,f.description) display_name,i.amount,i.unit,i.grams_equivalent,i.position
    FROM meal_plans p JOIN meal_plan_meals m ON m.meal_plan_id=p.id JOIN meal_plan_items i ON i.meal_plan_meal_id=m.id JOIN foods f ON f.id=i.food_id
    WHERE p.patient_id=? AND p.published_at IS NOT NULL AND (p.published_at AT TIME ZONE 'America/Sao_Paulo')::date<=?::date ORDER BY p.published_at,p.id,m.position,i.position,i.id`).all<PlanRow>(patientId, to);
  const planIds = [...new Set(plans.map((row) => row.plan_id))];
  const substitutions = planIds.length ? await db.prepare(`SELECT i.id item_id,s.food_id,COALESCE(f.display_name,f.description) display_name,s.amount,s.unit,s.grams_equivalent
    FROM meal_plan_item_substitutions s JOIN meal_plan_items i ON i.id=s.meal_plan_item_id JOIN meal_plan_meals m ON m.id=i.meal_plan_meal_id JOIN foods f ON f.id=s.food_id
    WHERE m.meal_plan_id=ANY(?::bigint[]) ORDER BY i.id,s.position,s.id`).all<SubstitutionRow>(planIds) : [];
  const diary = await db.prepare(`SELECT dl.log_date,m.id meal_id,m.meal_type,e.id entry_id,e.food_id,COALESCE(f.display_name,f.description) display_name,e.amount,e.unit,e.grams_equivalent,
    row_number() OVER(PARTITION BY m.id ORDER BY COALESCE(e.consumed_at,e.created_at),e.id)::int-1 position
    FROM daily_logs dl JOIN meals m ON m.daily_log_id=dl.id JOIN meal_entries e ON e.meal_id=m.id JOIN foods f ON f.id=e.food_id
    WHERE dl.patient_id=? AND dl.log_date BETWEEN ? AND ? ORDER BY dl.log_date,m.id,position`).all<DiaryRow>(patientId, from, to);
  const substitutionsByItem = new Map<number, PlannedItem['substitutions']>();
  for (const row of substitutions) { const values = substitutionsByItem.get(row.item_id) ?? []; values.push({ foodId: row.food_id, name: row.display_name, amount: row.amount, unit: row.unit, grams: row.grams_equivalent }); substitutionsByItem.set(row.item_id, values); }
  const versions = [...new Map(plans.map((row) => [row.plan_id, { id: row.plan_id, version: row.version, effectiveDate: row.effective_date, publishedAt: row.published_at }])).values()];
  const days = [];
  for (let date = from; date <= to; date = addCalendarDays(date, 1)) {
    const version = [...versions].reverse().find((entry) => entry.effectiveDate <= date) ?? null;
    const diaryForDate = diary.filter((row) => row.log_date === date);
    if (!version) { days.push({ date, state: 'no_plan' as const, plan: null, meals: [], recordedItems: diaryForDate.length }); continue; }
    const planRows = plans.filter((row) => row.plan_id === version.id);
    const mealTypes = [...new Set([...planRows.map((row) => row.meal_type), ...diaryForDate.map((row) => row.meal_type)])];
    const meals = mealTypes.sort((a, b) => MEAL_TYPE_ORDER[a] - MEAL_TYPE_ORDER[b]).map((mealType) => {
      const plannedItems = planRows.filter((row) => row.meal_type === mealType).map<PlannedItem>((row) => ({ id: row.item_id, foodId: row.food_id, name: row.display_name, amount: row.amount, unit: row.unit, grams: row.grams_equivalent, position: row.position, substitutions: substitutionsByItem.get(row.item_id) ?? [] }));
      const diaryItems = diaryForDate.filter((row) => row.meal_type === mealType).map<DiaryItem>((row) => ({ id: row.entry_id, foodId: row.food_id, name: row.display_name, amount: row.amount, unit: row.unit, grams: row.grams_equivalent, position: row.position }));
      const items = matchMealItems(plannedItems, diaryItems);
      return { mealType, planned: plannedItems.length > 0, state: mealState(items), items };
    });
    days.push({ date, state: meals.some((meal) => meal.state !== 'not_evaluable') ? 'evaluable' as const : 'not_evaluable' as const, plan: version, meals, recordedItems: diaryForDate.length });
  }
  const meals = days.flatMap((day) => day.meals), items = meals.flatMap((meal) => meal.items);
  const compatible = items.filter((item) => item.state.startsWith('matched_'));
  const recordedEvaluable = items.filter((item) => item.recorded);
  const quantityEvaluable = compatible.filter((item) => item.quantity !== 'not_evaluable');
  const summary = {
    eligiblePlannedItems: items.filter((item) => item.planned).length,
    coveredPlannedItems: compatible.length,
    eligibleMeals: meals.filter((meal) => meal.planned).length,
    evaluableMeals: meals.filter((meal) => meal.planned && meal.state !== 'not_evaluable').length,
    alignedMeals: meals.filter((meal) => meal.planned && meal.state === 'aligned').length,
    compatibleItems: compatible.length,
    evaluableRecordedItems: recordedEvaluable.length,
    substitutionsUsed: compatible.filter((item) => item.approvedSubstitution).length,
    quantityAlignedItems: quantityEvaluable.filter((item) => item.quantity !== 'outside_target').length,
    quantityEvaluableItems: quantityEvaluable.length,
    relevantQuantityDifferences: compatible.filter((item) => item.quantity === 'outside_target').length,
    extraRecordedItems: items.filter((item) => item.state === 'extra_recorded').length,
    plannedWithoutRecord: items.filter((item) => item.state === 'planned_not_recorded').length,
    noPlanDays: days.filter((day) => day.state === 'no_plan').length,
  };
  const planChangedDuringPeriod = new Set(days.map((day) => day.plan?.id).filter(Boolean)).size > 1;
  const publicDays = days.map((day) => ({ ...day, plan: day.plan ? { version: day.plan.version, effectiveDate: day.plan.effectiveDate, publishedAt: day.plan.publishedAt } : null }));
  return { version: ADHERENCE_VERSION, from, to, timezone: 'America/Sao_Paulo', planChangedDuringPeriod, summary, days: publicDays, performance: { queries: 3, milliseconds: Number((performance.now() - started).toFixed(2)) } };
}

type Dependencies = { authUser: (req: Request, res: Response) => Promise<AuthUser | null>; patientAccess: (user: AuthUser, patientId?: number) => Promise<Record<string, any> | null> };
const rangeSchema = z.object({ from: z.string().refine(isCalendarDate), to: z.string().refine(isCalendarDate) }).refine((value) => value.from <= value.to && inclusiveDaysBetween(value.from, value.to) <= 90, 'Período inválido ou maior que 90 dias.');

export function adherenceRouter({ authUser, patientAccess }: Dependencies) {
  const router = express.Router();
  async function respond(req: Request, res: Response, requestedPatientId?: number) {
    const user = await authUser(req, res); if (!user) return;
    const patient = await patientAccess(user, requestedPatientId); if (!patient) { res.status(404).json({ error: 'Paciente não encontrado.' }); return; }
    if (user.role === 'patient' && requestedPatientId != null) { res.status(404).json({ error: 'Paciente não encontrado.' }); return; }
    const parsed = rangeSchema.safeParse(req.query); if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Período inválido.' }); return; }
    const { performance: _performance, ...payload } = await adherenceForPeriod(Number(patient.id), parsed.data.from, parsed.data.to);
    res.json(payload);
  }
  function safelyRespond(req: Request, res: Response, requestedPatientId?: number) {
    void respond(req, res, requestedPatientId).catch((error) => {
      console.error('[plan-diary-adherence]', error);
      if (!res.headersSent) res.status(500).json({ error: 'Não foi possível carregar a aderência agora.' });
    });
  }
  router.get('/patient/adherence', (req, res) => safelyRespond(req, res));
  router.get('/nutritionist/patients/:patientId/adherence', (req, res) => safelyRespond(req, res, Number(req.params.patientId)));
  return router;
}

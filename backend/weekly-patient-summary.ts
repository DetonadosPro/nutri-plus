import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from './auth';
import { db } from './db';
import { addCalendarDays, inclusiveDaysBetween, isCalendarDate } from './domain/datetime';
import { adherenceForPeriod } from './plan-diary-adherence';
import { MEAL_TYPE_ORDER, type MealType } from '../shared/meal-types';

export const WEEKLY_PATIENT_SUMMARY_VERSION = 'weekly-patient-summary-v1';

type WeeklyAdherenceInput = {
  from: string;
  to: string;
  planChangedDuringPeriod: boolean;
  summary: {
    eligiblePlannedItems: number;
    coveredPlannedItems: number;
    relevantQuantityDifferences: number;
  };
  days: Array<{
    recordedItems: number;
    meals: Array<{
      mealType: MealType;
      planned: boolean;
      items: Array<{
        state: string;
        planned: unknown | null;
        recorded: unknown | null;
      }>;
    }>;
  }>;
};

type ActivitySummary = { sessions: number; days: number };
type WeightPoint = { weighed_at: string; weight_kg: number };

export type WeeklyMealSignal = {
  mealType: MealType;
  coveredItems: number;
  plannedItems: number;
  coveragePercent: number;
};

function percentage(covered: number, total: number) {
  return total > 0 ? Math.round((covered / total) * 100) : null;
}

export function buildWeeklyPatientSummary(
  adherence: WeeklyAdherenceInput,
  activity: ActivitySummary,
  weights: WeightPoint[],
) {
  const meals = new Map<MealType, { coveredItems: number; plannedItems: number }>();
  for (const day of adherence.days) {
    for (const meal of day.meals) {
      if (!meal.planned) continue;
      const current = meals.get(meal.mealType) ?? { coveredItems: 0, plannedItems: 0 };
      current.plannedItems += meal.items.filter((item) => item.planned).length;
      current.coveredItems += meal.items.filter((item) => item.state.startsWith('matched_')).length;
      meals.set(meal.mealType, current);
    }
  }

  const mealSignals = [...meals.entries()]
    .map<WeeklyMealSignal>(([mealType, value]) => ({
      mealType,
      ...value,
      coveragePercent: percentage(value.coveredItems, value.plannedItems) ?? 0,
    }))
    .filter((meal) => meal.plannedItems > 0);
  const strongestMeal = [...mealSignals].sort(
    (a, b) =>
      b.coveragePercent - a.coveragePercent ||
      b.coveredItems - a.coveredItems ||
      MEAL_TYPE_ORDER[a.mealType] - MEAL_TYPE_ORDER[b.mealType],
  )[0] ?? null;
  const attentionMeal = [...mealSignals].sort(
    (a, b) =>
      a.coveragePercent - b.coveragePercent ||
      b.plannedItems - a.plannedItems ||
      MEAL_TYPE_ORDER[a.mealType] - MEAL_TYPE_ORDER[b.mealType],
  )[0] ?? null;

  const latestWeight = weights[0] ?? null;
  const previousWeight = weights[1] ?? null;
  const weightUpdatedInPeriod = Boolean(
    latestWeight && latestWeight.weighed_at >= adherence.from && latestWeight.weighed_at <= adherence.to,
  );

  return {
    version: WEEKLY_PATIENT_SUMMARY_VERSION,
    from: adherence.from,
    to: adherence.to,
    timezone: 'America/Sao_Paulo' as const,
    registration: {
      recordedDays: adherence.days.filter((day) => day.recordedItems > 0).length,
      totalDays: inclusiveDaysBetween(adherence.from, adherence.to),
    },
    plan: {
      available: adherence.summary.eligiblePlannedItems > 0,
      coveredItems: adherence.summary.coveredPlannedItems,
      plannedItems: adherence.summary.eligiblePlannedItems,
      coveragePercent: percentage(
        adherence.summary.coveredPlannedItems,
        adherence.summary.eligiblePlannedItems,
      ),
      strongestMeal,
      attentionMeal,
      quantityDifferences: adherence.summary.relevantQuantityDifferences,
      changedDuringPeriod: adherence.planChangedDuringPeriod,
    },
    activity: {
      sessions: Number(activity.sessions),
      days: Number(activity.days),
    },
    weight: {
      updatedInPeriod: weightUpdatedInPeriod,
      latestKg: latestWeight ? Number(latestWeight.weight_kg) : null,
      weighedAt: latestWeight?.weighed_at ?? null,
      changeKg:
        weightUpdatedInPeriod && previousWeight
          ? Number((Number(latestWeight!.weight_kg) - Number(previousWeight.weight_kg)).toFixed(2))
          : null,
    },
  };
}

export async function weeklyPatientSummary(patientId: number, to: string) {
  const from = addCalendarDays(to, -6);
  const [adherence, activity, weights] = await Promise.all([
    adherenceForPeriod(patientId, from, to),
    db
      .prepare(
        `SELECT COUNT(*)::int sessions, COUNT(DISTINCT activity_date)::int days
         FROM activity_sessions WHERE patient_id=? AND activity_date BETWEEN ? AND ?`,
      )
      .get<ActivitySummary>(patientId, from, to),
    db
      .prepare(
        `SELECT weighed_at, weight_kg FROM weight_history
         WHERE patient_id=? AND weighed_at<=? ORDER BY weighed_at DESC, id DESC LIMIT 2`,
      )
      .all<WeightPoint>(patientId, to),
  ]);
  return buildWeeklyPatientSummary(adherence, activity ?? { sessions: 0, days: 0 }, weights);
}

type Dependencies = {
  authUser: (req: Request, res: Response) => Promise<AuthUser | null>;
  patientAccess: (user: AuthUser, patientId?: number) => Promise<Record<string, any> | null>;
};

const querySchema = z.object({ to: z.string().refine(isCalendarDate) });

export function weeklyPatientSummaryRouter({ authUser, patientAccess }: Dependencies) {
  const router = express.Router();
  router.get('/nutritionist/patients/:patientId/weekly-summary', (req, res) => {
    void (async () => {
      const user = await authUser(req, res);
      if (!user) return;
      if (user.role !== 'nutritionist') {
        res.status(403).json({ error: 'Área exclusiva do nutricionista.' });
        return;
      }
      const patient = await patientAccess(user, Number(req.params.patientId));
      if (!patient) {
        res.status(404).json({ error: 'Paciente não encontrado.' });
        return;
      }
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Informe uma data final válida.' });
        return;
      }
      res.json(await weeklyPatientSummary(Number(patient.id), parsed.data.to));
    })().catch((error) => {
      console.error('[weekly-patient-summary]', error);
      if (!res.headersSent)
        res.status(500).json({ error: 'Não foi possível carregar o resumo semanal agora.' });
    });
  });
  return router;
}

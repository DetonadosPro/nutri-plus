import express, { type Request, type Response } from "express";
import { z } from "zod";
import { db, transaction } from "./db";
import type { AuthUser } from "./auth";
import { quantityInput, resolveQuantity } from "./food-measures";
import { measuresForFoods } from "./food-measures";
import { gramMeasure } from "../shared/food-measures";
import { macroGoalsFromEnergy, scaleNutrients, sumNutrientSets } from "./domain/nutrition";
import {
  MEAL_TYPE_ORDER,
  MEAL_TYPE_VALUES,
  type MealType,
} from "../shared/meal-types";
import {
  automaticSubstitutionSuggestions,
  equivalenceMetadata,
  manualSubstitutionEquivalence,
  SUBSTITUTION_ALGORITHM_VERSION,
} from "./smart-substitutions";

type Dependencies = {
  authUser: (req: Request, res: Response) => Promise<AuthUser | null>;
  patientAccess: (user: AuthUser, patientId?: number) => Promise<Record<string, any> | null>;
};

class MealPlanError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const id = z.coerce.number().int().positive();
const planPatch = z
  .object({
    title: z.string().trim().min(1).max(120).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    lockVersion: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "lockVersion"),
    "Informe ao menos uma alteração.",
  );
const mealPayload = z.object({
  mealType: z.enum(MEAL_TYPE_VALUES),
  notes: z.string().max(2000).nullable().optional(),
});
const mealPatch = z
  .object({
    mealType: z.enum(MEAL_TYPE_VALUES).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteração.");
const itemPayload = quantityInput.safeExtend({
  foodId: z.number().int().positive(),
  notes: z.string().max(1000).nullable().optional(),
});
const itemPatch = z
  .object({
    grams: z.number().positive().max(5000).optional(),
    quantity: z.number().positive().optional(),
    measureId: z.number().int().nonnegative().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteração.")
  .refine((value) => {
    const hasQuantity = value.quantity != null || value.measureId != null || value.grams != null;
    return (
      !hasQuantity ||
      (value.grams != null
        ? value.quantity == null && value.measureId == null
        : value.quantity != null && value.measureId != null)
    );
  }, "Informe gramas ou quantidade e medida.");
const substitutionQuantity = z
  .object({
    grams: z.number().positive().max(5000).optional(),
    quantity: z.number().positive().optional(),
    measureId: z.number().int().nonnegative().optional(),
  })
  .refine((value) => {
    const supplied = value.grams != null || value.quantity != null || value.measureId != null;
    return !supplied || (value.grams != null
      ? value.quantity == null && value.measureId == null
      : value.quantity != null && value.measureId != null);
  }, "Informe gramas ou quantidade e medida.");
const substitutionPayload = substitutionQuantity.extend({
  foodId: z.number().int().positive(),
  origin: z.enum(["suggestion", "manual"]).default("manual"),
});
const substitutionPatch = substitutionQuantity.refine(
  (value) => value.grams != null || value.quantity != null || value.measureId != null,
  "Informe a nova quantidade.",
);

function handler(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof MealPlanError)
        return void res.status(error.status).json({ error: error.message });
      if (error instanceof z.ZodError)
        return void res.status(400).json({ error: "Revise os dados do plano alimentar." });
      console.error(
        "Falha interna no plano alimentar:",
        req.method,
        req.path,
        error instanceof Error ? error.message : "erro desconhecido",
      );
      res.status(500).json({ error: "Não foi possível concluir a ação no plano alimentar." });
    }
  };
}

async function planOwner(planId: number) {
  return db
    .prepare(`SELECT mp.*,p.nutritionist_user_id,p.user_id AS patient_user_id
    FROM meal_plans mp JOIN patients p ON p.id=mp.patient_id WHERE mp.id=?`)
    .get<Record<string, any>>(planId);
}

async function requireNutritionistPlan(
  user: AuthUser,
  planId: number,
  deps: Dependencies,
  draft = false,
) {
  if (user.role !== "nutritionist")
    throw new MealPlanError("Área exclusiva do nutricionista.", 403);
  const plan = await planOwner(planId);
  if (!plan || !(await deps.patientAccess(user, Number(plan.patient_id))))
    throw new MealPlanError("Plano alimentar não encontrado.", 404);
  if (draft && plan.status !== "draft")
    throw new MealPlanError("Planos publicados são somente leitura. Crie uma nova versão.", 409);
  return plan;
}

async function requireDraftByMeal(user: AuthUser, mealId: number, deps: Dependencies) {
  const row = await db
    .prepare(`SELECT m.*,mp.patient_id,mp.status FROM meal_plan_meals m
    JOIN meal_plans mp ON mp.id=m.meal_plan_id WHERE m.id=?`)
    .get<Record<string, any>>(mealId);
  if (
    !row ||
    user.role !== "nutritionist" ||
    !(await deps.patientAccess(user, Number(row.patient_id)))
  )
    throw new MealPlanError("Refeição não encontrada.", 404);
  if (row.status !== "draft")
    throw new MealPlanError("Planos publicados são somente leitura. Crie uma nova versão.", 409);
  return row;
}

async function requireDraftByItem(user: AuthUser, itemId: number, deps: Dependencies) {
  const row = await db
    .prepare(`SELECT i.*,m.meal_plan_id,mp.patient_id,mp.status FROM meal_plan_items i
    JOIN meal_plan_meals m ON m.id=i.meal_plan_meal_id JOIN meal_plans mp ON mp.id=m.meal_plan_id WHERE i.id=?`)
    .get<Record<string, any>>(itemId);
  if (
    !row ||
    user.role !== "nutritionist" ||
    !(await deps.patientAccess(user, Number(row.patient_id)))
  )
    throw new MealPlanError("Alimento prescrito não encontrado.", 404);
  if (row.status !== "draft")
    throw new MealPlanError("Planos publicados são somente leitura. Crie uma nova versão.", 409);
  return row;
}

async function requireDraftSubstitution(
  user: AuthUser,
  substitutionId: number,
  deps: Dependencies,
) {
  const row = await db
    .prepare(`SELECT s.*,i.food_id AS original_food_id,i.grams_equivalent AS original_grams,
      m.meal_plan_id,mp.patient_id,mp.status
    FROM meal_plan_item_substitutions s
    JOIN meal_plan_items i ON i.id=s.meal_plan_item_id
    JOIN meal_plan_meals m ON m.id=i.meal_plan_meal_id
    JOIN meal_plans mp ON mp.id=m.meal_plan_id WHERE s.id=?`)
    .get<Record<string, any>>(substitutionId);
  if (
    !row ||
    user.role !== "nutritionist" ||
    !(await deps.patientAccess(user, Number(row.patient_id)))
  )
    throw new MealPlanError("Substituição não encontrada.", 404);
  if (row.status !== "draft")
    throw new MealPlanError("Planos publicados são somente leitura. Crie uma nova versão.", 409);
  return row;
}

async function assertDraftLocked(planId: number) {
  const plan = await db
    .prepare("SELECT status FROM meal_plans WHERE id=? FOR UPDATE")
    .get<{ status: string }>(planId);
  if (plan?.status !== "draft")
    throw new MealPlanError("Planos publicados são somente leitura. Crie uma nova versão.", 409);
}

async function ensureDistinctSubstitution(item: Record<string, any>, foodId: number) {
  if (Number(item.food_id) === foodId)
    throw new MealPlanError("O alimento principal não pode substituir a si mesmo.", 409);
  const candidate = await db
    .prepare("SELECT duplicate_group FROM foods WHERE id=? AND active AND source='TBCA'")
    .get<{ duplicate_group: string | null }>(foodId);
  if (!candidate) throw new MealPlanError("Selecione um alimento ativo da TBCA.");
  const existing = await db
    .prepare(`SELECT s.food_id,f.duplicate_group FROM meal_plan_item_substitutions s
      JOIN foods f ON f.id=s.food_id WHERE s.meal_plan_item_id=?`)
    .all<{ food_id: number; duplicate_group: string | null }>(item.id);
  if (existing.some((row) => Number(row.food_id) === foodId))
    throw new MealPlanError("Este alimento já foi aprovado como substituição.", 409);
  if (
    candidate.duplicate_group &&
    existing.some((row) => row.duplicate_group === candidate.duplicate_group)
  )
    throw new MealPlanError("Uma variante equivalente deste alimento já foi aprovada.", 409);
}

async function bump(planId: number) {
  await db
    .prepare(
      "UPDATE meal_plans SET updated_at=CURRENT_TIMESTAMP,lock_version=lock_version+1 WHERE id=?",
    )
    .run(planId);
}

function nutrientsFromSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return Object.fromEntries(
    Object.entries(snapshot as Record<string, Record<string, unknown>>).map(([code, value]) => [
      code,
      value?.status === "numeric" && value.numeric_value != null
        ? Number(value.numeric_value)
        : null,
    ]),
  );
}

async function loadPlan(planId: number) {
  const plan = await db
    .prepare(`SELECT mp.*,u.name AS created_by_name FROM meal_plans mp
    JOIN users u ON u.id=mp.created_by WHERE mp.id=?`)
    .get<Record<string, any>>(planId);
  if (!plan) return null;
  const meals = await db
    .prepare("SELECT * FROM meal_plan_meals WHERE meal_plan_id=? ORDER BY position,id")
    .all<Record<string, any>>(planId);
  const rows = await db
    .prepare(`SELECT i.*,f.source_code,f.description,f.category,f.source,
      COALESCE(f.display_name,f.description) AS display_name,
      COALESCE(jsonb_object_agg(n.code,CASE WHEN fn.status='numeric' THEN fn.numeric_value ELSE NULL END) FILTER(WHERE n.code IS NOT NULL),'{}'::jsonb) AS nutrients_per_100g
    FROM meal_plan_items i JOIN meal_plan_meals m ON m.id=i.meal_plan_meal_id
    JOIN foods f ON f.id=i.food_id
    LEFT JOIN food_nutrients fn ON fn.food_id=f.id LEFT JOIN nutrients n ON n.code=fn.nutrient_code
    WHERE m.meal_plan_id=? GROUP BY i.id,f.id ORDER BY i.meal_plan_meal_id,i.position,i.id`)
    .all<Record<string, any>>(planId);
  const substitutionRows = await db
    .prepare(`SELECT s.*,f.source_code,f.description,f.category,f.source,
      COALESCE(f.display_name,f.description) AS display_name,
      COALESCE(jsonb_object_agg(n.code,CASE WHEN fn.status='numeric' THEN fn.numeric_value ELSE NULL END) FILTER(WHERE n.code IS NOT NULL),'{}'::jsonb) AS nutrients_per_100g
    FROM meal_plan_item_substitutions s
    JOIN meal_plan_items i ON i.id=s.meal_plan_item_id
    JOIN meal_plan_meals m ON m.id=i.meal_plan_meal_id
    JOIN foods f ON f.id=s.food_id
    LEFT JOIN food_nutrients fn ON fn.food_id=f.id LEFT JOIN nutrients n ON n.code=fn.nutrient_code
    WHERE m.meal_plan_id=? GROUP BY s.id,f.id ORDER BY s.meal_plan_item_id,s.position,s.id`)
    .all<Record<string, any>>(planId);
  const foodIds = [...new Set([...rows, ...substitutionRows].map((row) => Number(row.food_id)))];
  const measures = await measuresForFoods(foodIds);
  const itemSets = new Map<number, ReturnType<typeof scaleNutrients>>();
  const mealPayload = meals.map((meal) => {
    const items = rows
      .filter((row) => Number(row.meal_plan_meal_id) === Number(meal.id))
      .map((row) => {
        const frozen = plan.status === "draft" ? null : nutrientsFromSnapshot(row.nutrient_snapshot);
        const scaled = scaleNutrients(
          frozen ?? row.nutrients_per_100g ?? {},
          Number(row.grams_equivalent),
        );
        itemSets.set(Number(row.id), scaled);
        const { nutrient_snapshot: _snapshot, nutrients_per_100g: _current, ...publicRow } = row;
        const substitutions = substitutionRows
          .filter((substitution) => Number(substitution.meal_plan_item_id) === Number(row.id))
          .map((substitution) => {
            const substitutionFrozen = plan.status === "draft"
              ? null
              : nutrientsFromSnapshot(substitution.nutrient_snapshot);
            const substitutionScaled = scaleNutrients(
              substitutionFrozen ?? substitution.nutrients_per_100g ?? {},
              Number(substitution.grams_equivalent),
            );
            const {
              nutrient_snapshot: _substitutionSnapshot,
              nutrients_per_100g: _substitutionCurrent,
              ...publicSubstitution
            } = substitution;
            return {
              ...publicSubstitution,
              nutrients: substitutionScaled.values,
              measures: measures.get(Number(substitution.food_id)) ?? [gramMeasure],
            };
          });
        return {
          ...publicRow,
          nutrients: scaled.values,
          measures: measures.get(Number(row.food_id)) ?? [gramMeasure],
          substitutions,
        };
      });
    const totals = sumNutrientSets(
      items.map((item) => itemSets.get(Number((item as Record<string, any>).id))!),
    );
    return { ...meal, items, totals: totals.values };
  });
  const total = sumNutrientSets([...itemSets.values()]);
  const goals = await db
    .prepare(
      `SELECT * FROM nutrition_goals WHERE patient_id=? AND valid_from<=CURRENT_DATE ORDER BY valid_from DESC LIMIT 1`,
    )
    .get<Record<string, any>>(plan.patient_id);
  const weight = await db
    .prepare(
      "SELECT weight_kg FROM weight_history WHERE patient_id=? ORDER BY weighed_at DESC LIMIT 1",
    )
    .get<{ weight_kg: number }>(plan.patient_id);
  let goalPayload: Record<string, number | null> | null = null;
  if (goals) {
    const macro = macroGoalsFromEnergy(
      goals.energy_kcal == null ? null : Number(goals.energy_kcal),
      {
        carbohydratePercent: Number(goals.carbohydrate_percent ?? 50),
        proteinPercent: Number(goals.protein_percent ?? 20),
        fatPercent: Number(goals.fat_percent ?? 30),
      },
    );
    goalPayload = {
      energy_kcal: Number(goals.energy_kcal) || null,
      protein_g: Number(goals.protein_g) || macro.proteinG,
      carbohydrate_g: Number(goals.carbohydrate_g) || macro.carbohydrateG,
      fat_g: Number(goals.fat_g) || macro.fatG,
      fiber_g: Number(goals.fiber_g) || null,
      protein_gkg_min: Number(goals.protein_gkg_min) || null,
      protein_gkg_min_grams:
        goals.protein_gkg_min == null || !weight
          ? null
          : Number(goals.protein_gkg_min) * Number(weight.weight_kg),
    };
  }
  return { ...plan, meals: mealPayload, totals: total.values, goals: goalPayload, queryCount: 7 };
}

async function nextVersion(patientId: number) {
  await db.prepare("SELECT pg_advisory_xact_lock(?)").get(patientId);
  const row = await db
    .prepare("SELECT COALESCE(MAX(version),0)::int+1 AS version FROM meal_plans WHERE patient_id=?")
    .get<{ version: number }>(patientId);
  return Number(row!.version);
}

async function canonicalizeMealPositions(planId: number) {
  const rows = await db
    .prepare("SELECT id,meal_type FROM meal_plan_meals WHERE meal_plan_id=? ORDER BY position,id")
    .all<{ id: number; meal_type: MealType }>(planId);
  rows.sort(
    (a, b) => MEAL_TYPE_ORDER[a.meal_type] - MEAL_TYPE_ORDER[b.meal_type] || a.id - b.id,
  );
  await db
    .prepare("SET CONSTRAINTS meal_plan_meals_meal_plan_id_position_key DEFERRED")
    .run();
  for (const [position, meal] of rows.entries())
    await db
      .prepare(
        "UPDATE meal_plan_meals SET position=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .run(position, meal.id);
}

async function clonePlan(sourceId: number, createdBy: number) {
  const source = await planOwner(sourceId);
  if (!source) throw new MealPlanError("Plano alimentar não encontrado.", 404);
  const version = await nextVersion(Number(source.patient_id));
  const plan = await db
    .prepare(`INSERT INTO meal_plans(patient_id,created_by,source_plan_id,version,status,title,notes)
    VALUES(?,?,?,?,'draft',?,?) RETURNING id`)
    .get<{ id: number }>(
      source.patient_id,
      createdBy,
      sourceId,
      version,
      source.title,
      source.notes,
    );
  const meals = await db
    .prepare("SELECT * FROM meal_plan_meals WHERE meal_plan_id=? ORDER BY position,id")
    .all<Record<string, any>>(sourceId);
  for (const meal of meals) {
    const copy = await db
      .prepare(
        `INSERT INTO meal_plan_meals(meal_plan_id,meal_type,position,notes) VALUES(?,?,?,?) RETURNING id`,
      )
      .get<{ id: number }>(plan!.id, meal.meal_type, meal.position, meal.notes);
    const items = await db
      .prepare("SELECT * FROM meal_plan_items WHERE meal_plan_meal_id=? ORDER BY position,id")
      .all<Record<string, any>>(meal.id);
    for (const item of items) {
      const itemCopy = await db
        .prepare(`INSERT INTO meal_plan_items(meal_plan_meal_id,food_id,position,amount,unit,grams_equivalent,measure_snapshot,notes)
          VALUES(?,?,?,?,?,?,?::jsonb,?) RETURNING id`)
        .get<{ id: number }>(
          copy!.id,
          item.food_id,
          item.position,
          item.amount,
          item.unit,
          item.grams_equivalent,
          JSON.stringify(item.measure_snapshot),
          item.notes,
        );
      await db
        .prepare(`INSERT INTO meal_plan_item_substitutions(
          meal_plan_item_id,food_id,position,amount,unit,grams_equivalent,measure_snapshot,origin,algorithm_version,equivalence_metadata)
          SELECT ?,food_id,position,amount,unit,grams_equivalent,measure_snapshot,origin,algorithm_version,equivalence_metadata
          FROM meal_plan_item_substitutions WHERE meal_plan_item_id=? ORDER BY position,id`)
        .run(itemCopy!.id, item.id);
    }
  }
  return plan!.id;
}

export function mealPlanRouter(deps: Dependencies) {
  const router = express.Router();
  router.get(
    "/nutritionist/patients/:patientId/meal-plans",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      if (user.role !== "nutritionist")
        throw new MealPlanError("Área exclusiva do nutricionista.", 403);
      const patientId = id.parse(req.params.patientId);
      if (!(await deps.patientAccess(user, patientId)))
        throw new MealPlanError("Paciente não encontrado.", 404);
      const plans = await db
        .prepare(`SELECT mp.id,mp.version,mp.status,mp.title,mp.created_at,mp.updated_at,mp.published_at,mp.archived_at,
      (SELECT count(*)::int FROM meal_plan_meals m WHERE m.meal_plan_id=mp.id) AS meal_count
      FROM meal_plans mp WHERE patient_id=? ORDER BY version DESC`)
        .all(patientId);
      res.json(plans);
    }),
  );
  router.get(
    "/nutritionist/patients/:patientId/meal-plans/active",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      if (user.role !== "nutritionist")
        throw new MealPlanError("Área exclusiva do nutricionista.", 403);
      const patientId = id.parse(req.params.patientId);
      if (!(await deps.patientAccess(user, patientId)))
        throw new MealPlanError("Paciente não encontrado.", 404);
      const plan = await db
        .prepare("SELECT id FROM meal_plans WHERE patient_id=? AND status='active'")
        .get<{ id: number }>(patientId);
      res.json(plan ? await loadPlan(plan.id) : null);
    }),
  );
  router.post(
    "/nutritionist/patients/:patientId/meal-plans",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      if (user.role !== "nutritionist")
        throw new MealPlanError("Área exclusiva do nutricionista.", 403);
      const patientId = id.parse(req.params.patientId);
      if (!(await deps.patientAccess(user, patientId)))
        throw new MealPlanError("Paciente não encontrado.", 404);
      const payload = z
        .object({
          title: z.string().trim().min(1).max(120).nullable().optional(),
          notes: z.string().max(5000).nullable().optional(),
          sourcePlanId: z.number().int().positive().optional(),
        })
        .parse(req.body ?? {});
      const planId = await transaction(async () => {
        if (payload.sourcePlanId) {
          const source = await requireNutritionistPlan(user, payload.sourcePlanId, deps);
          if (Number(source.patient_id) !== patientId)
            throw new MealPlanError("O plano-base pertence a outro paciente.", 400);
          return clonePlan(payload.sourcePlanId, user.id);
        }
        const version = await nextVersion(patientId);
        const row = await db
          .prepare(
            `INSERT INTO meal_plans(patient_id,created_by,version,title,notes) VALUES(?,?,?,?,?) RETURNING id`,
          )
          .get<{ id: number }>(
            patientId,
            user.id,
            version,
            payload.title ?? null,
            payload.notes ?? null,
          );
        return row!.id;
      });
      res.status(201).json(await loadPlan(planId));
    }),
  );
  router.get(
    "/meal-plans/:planId",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const plan = await requireNutritionistPlan(user, id.parse(req.params.planId), deps);
      res.json(await loadPlan(plan.id));
    }),
  );
  router.patch(
    "/meal-plans/:planId",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const plan = await requireNutritionistPlan(user, id.parse(req.params.planId), deps, true);
      const payload = planPatch.parse(req.body);
      const result = await db
        .prepare(
          `UPDATE meal_plans SET title=?,notes=?,updated_at=CURRENT_TIMESTAMP,lock_version=lock_version+1 WHERE id=? AND lock_version=? RETURNING id`,
        )
        .get<{ id: number }>(
          payload.title === undefined ? plan.title : payload.title,
          payload.notes === undefined ? plan.notes : payload.notes,
          plan.id,
          payload.lockVersion ?? plan.lock_version,
        );
      if (!result)
        throw new MealPlanError(
          "Este plano foi alterado em outra sessão. Recarregue para continuar.",
          409,
        );
      res.json(await loadPlan(plan.id));
    }),
  );
  router.post(
    "/meal-plans/:planId/duplicate",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const source = await requireNutritionistPlan(user, id.parse(req.params.planId), deps);
      const copyId = await transaction(() => clonePlan(source.id, user.id));
      res.status(201).json(await loadPlan(copyId));
    }),
  );
  router.post(
    "/meal-plans/:planId/publish",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const original = await requireNutritionistPlan(user, id.parse(req.params.planId), deps, true);
      await transaction(async () => {
        await db.prepare("SELECT pg_advisory_xact_lock(?)").get(original.patient_id);
        const locked = await db
          .prepare("SELECT * FROM meal_plans WHERE id=? FOR UPDATE")
          .get<Record<string, any>>(original.id);
        if (locked?.status !== "draft")
          throw new MealPlanError("Este plano já foi publicado.", 409);
        const integrity = await db
          .prepare(
            `SELECT count(DISTINCT m.id)::int AS meals,count(i.id)::int AS items FROM meal_plan_meals m LEFT JOIN meal_plan_items i ON i.meal_plan_meal_id=m.id WHERE m.meal_plan_id=?`,
          )
          .get<{ meals: number; items: number }>(original.id);
        if (!integrity?.meals || !integrity.items)
          throw new MealPlanError(
            "Adicione pelo menos uma refeição com um alimento antes de publicar.",
          );
        await db.prepare(`UPDATE meal_plan_items item SET nutrient_snapshot=snapshot.payload
          FROM (
            SELECT item_source.id,
              COALESCE(jsonb_object_agg(
                nutrient.code,
                jsonb_build_object(
                  'numeric_value',food_nutrient.numeric_value,
                  'raw_value',food_nutrient.raw_value,
                  'status',food_nutrient.status
                )
              ) FILTER(WHERE nutrient.code IS NOT NULL),'{}'::jsonb) AS payload
            FROM meal_plan_items item_source
            JOIN meal_plan_meals meal ON meal.id=item_source.meal_plan_meal_id
            LEFT JOIN food_nutrients food_nutrient ON food_nutrient.food_id=item_source.food_id
            LEFT JOIN nutrients nutrient ON nutrient.code=food_nutrient.nutrient_code
            WHERE meal.meal_plan_id=?
            GROUP BY item_source.id
          ) snapshot
          WHERE item.id=snapshot.id`).run(original.id);
        await db.prepare(`UPDATE meal_plan_item_substitutions substitution SET nutrient_snapshot=snapshot.payload
          FROM (
            SELECT substitution_source.id,
              COALESCE(jsonb_object_agg(
                nutrient.code,
                jsonb_build_object(
                  'numeric_value',food_nutrient.numeric_value,
                  'raw_value',food_nutrient.raw_value,
                  'status',food_nutrient.status
                )
              ) FILTER(WHERE nutrient.code IS NOT NULL),'{}'::jsonb) AS payload
            FROM meal_plan_item_substitutions substitution_source
            JOIN meal_plan_items item ON item.id=substitution_source.meal_plan_item_id
            JOIN meal_plan_meals meal ON meal.id=item.meal_plan_meal_id
            LEFT JOIN food_nutrients food_nutrient ON food_nutrient.food_id=substitution_source.food_id
            LEFT JOIN nutrients nutrient ON nutrient.code=food_nutrient.nutrient_code
            WHERE meal.meal_plan_id=?
            GROUP BY substitution_source.id
          ) snapshot
          WHERE substitution.id=snapshot.id`).run(original.id);
        await db
          .prepare(
            "UPDATE meal_plans SET status='archived',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE patient_id=? AND status='active'",
          )
          .run(original.patient_id);
        const activated = await db
          .prepare(
            "UPDATE meal_plans SET status='active',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,lock_version=lock_version+1 WHERE id=? AND status='draft' RETURNING id",
          )
          .get(original.id);
        if (!activated) throw new MealPlanError("Não foi possível publicar este plano.", 409);
      });
      res.json(await loadPlan(original.id));
    }),
  );
  router.post(
    "/meal-plans/:planId/meals",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const plan = await requireNutritionistPlan(user, id.parse(req.params.planId), deps, true);
      const payload = mealPayload.parse(req.body);
      await transaction(async () => {
        await db.prepare("SELECT id FROM meal_plans WHERE id=? FOR UPDATE").get(plan.id);
        const existing = await db
          .prepare("SELECT id FROM meal_plan_meals WHERE meal_plan_id=? AND meal_type=?")
          .get(plan.id, payload.mealType);
        if (existing)
          throw new MealPlanError("Esta refeição já faz parte do plano.", 409);
        const pos = await db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)::int+1 AS position FROM meal_plan_meals WHERE meal_plan_id=?",
          )
          .get<{ position: number }>(plan.id);
        await db
          .prepare(
            "INSERT INTO meal_plan_meals(meal_plan_id,meal_type,position,notes) VALUES(?,?,?,?)",
          )
          .run(plan.id, payload.mealType, pos!.position, payload.notes ?? null);
        await canonicalizeMealPositions(plan.id);
        await bump(plan.id);
      });
      res.status(201).json(await loadPlan(plan.id));
    }),
  );
  router.patch(
    "/meal-plan-meals/:mealId",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const meal = await requireDraftByMeal(user, id.parse(req.params.mealId), deps);
      const payload = mealPatch.parse(req.body);
      await transaction(async () => {
        if (payload.mealType && payload.mealType !== meal.meal_type) {
          const existing = await db
            .prepare("SELECT id FROM meal_plan_meals WHERE meal_plan_id=? AND meal_type=?")
            .get(meal.meal_plan_id, payload.mealType);
          if (existing)
            throw new MealPlanError("Esta refeição já faz parte do plano.", 409);
        }
        await db
          .prepare(
            "UPDATE meal_plan_meals SET meal_type=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .run(
            payload.mealType ?? meal.meal_type,
            payload.notes === undefined ? meal.notes : payload.notes,
            meal.id,
          );
        await canonicalizeMealPositions(meal.meal_plan_id);
        await bump(meal.meal_plan_id);
      });
      res.json(await loadPlan(meal.meal_plan_id));
    }),
  );
  router.delete(
    "/meal-plan-meals/:mealId",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const meal = await requireDraftByMeal(user, id.parse(req.params.mealId), deps);
      await transaction(async () => {
        await db.prepare("DELETE FROM meal_plan_meals WHERE id=?").run(meal.id);
        await db
          .prepare(
            `WITH ranked AS(SELECT id,row_number() OVER(ORDER BY position,id)-1 AS p FROM meal_plan_meals WHERE meal_plan_id=?) UPDATE meal_plan_meals m SET position=ranked.p FROM ranked WHERE m.id=ranked.id`,
          )
          .run(meal.meal_plan_id);
        await bump(meal.meal_plan_id);
      });
      res.status(204).end();
    }),
  );
  router.put(
    "/meal-plans/:planId/meals/order",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const plan = await requireNutritionistPlan(user, id.parse(req.params.planId), deps, true);
      const order = z
        .object({ ids: z.array(z.number().int().positive()).max(30) })
        .parse(req.body).ids;
      const existing = (
        await db
          .prepare("SELECT id FROM meal_plan_meals WHERE meal_plan_id=? ORDER BY id")
          .all<{ id: number }>(plan.id)
      )
        .map((x) => Number(x.id))
        .sort((a, b) => a - b);
      if ([...order].sort((a, b) => a - b).join() != existing.join())
        throw new MealPlanError("A ordem deve conter todas as refeições do plano.");
      await transaction(async () => {
        await db
          .prepare("SET CONSTRAINTS meal_plan_meals_meal_plan_id_position_key DEFERRED")
          .run();
        for (const [position, mealId] of order.entries())
          await db
            .prepare(
              "UPDATE meal_plan_meals SET position=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
            )
            .run(position, mealId);
        await bump(plan.id);
      });
      res.json(await loadPlan(plan.id));
    }),
  );
  router.post(
    "/meal-plan-meals/:mealId/items",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const meal = await requireDraftByMeal(user, id.parse(req.params.mealId), deps);
      const payload = itemPayload.parse(req.body);
      const food = await db
        .prepare("SELECT id FROM foods WHERE id=? AND active AND source='TBCA' FOR SHARE")
        .get(payload.foodId);
      if (!food) throw new MealPlanError("Selecione um alimento ativo da TBCA.");
      const converted = await resolveQuantity(payload.foodId, payload).catch((e) => {
        throw new MealPlanError(e.message);
      });
      const pos = await db
        .prepare(
          "SELECT COALESCE(MAX(position),-1)::int+1 AS position FROM meal_plan_items WHERE meal_plan_meal_id=?",
        )
        .get<{ position: number }>(meal.id);
      await db
        .prepare(
          `INSERT INTO meal_plan_items(meal_plan_meal_id,food_id,position,amount,unit,grams_equivalent,measure_snapshot,notes) VALUES(?,?,?,?,?,?,?::jsonb,?)`,
        )
        .run(
          meal.id,
          payload.foodId,
          pos!.position,
          converted.amount,
          converted.unit,
          converted.grams,
          JSON.stringify(converted.snapshot),
          payload.notes ?? null,
        );
      await bump(meal.meal_plan_id);
      res.status(201).json(await loadPlan(meal.meal_plan_id));
    }),
  );
  router.patch(
    "/meal-plan-items/:itemId",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const item = await requireDraftByItem(user, id.parse(req.params.itemId), deps);
      const payload = itemPatch.parse(req.body);
      const hasQuantity =
        payload.grams != null || payload.quantity != null || payload.measureId != null;
      const converted = hasQuantity
        ? await resolveQuantity(Number(item.food_id), payload, item.measure_snapshot).catch((e) => {
            throw new MealPlanError(e.message);
          })
        : {
            amount: item.amount,
            unit: item.unit,
            grams: item.grams_equivalent,
            snapshot: item.measure_snapshot,
          };
      await db
        .prepare(
          "UPDATE meal_plan_items SET amount=?,unit=?,grams_equivalent=?,measure_snapshot=?::jsonb,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .run(
          converted.amount,
          converted.unit,
          converted.grams,
          JSON.stringify(converted.snapshot),
          payload.notes === undefined ? item.notes : payload.notes,
          item.id,
        );
      await bump(item.meal_plan_id);
      res.json(await loadPlan(item.meal_plan_id));
    }),
  );
  router.delete(
    "/meal-plan-items/:itemId",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const item = await requireDraftByItem(user, id.parse(req.params.itemId), deps);
      await transaction(async () => {
        await db.prepare("DELETE FROM meal_plan_items WHERE id=?").run(item.id);
        await db
          .prepare(
            `WITH ranked AS(SELECT id,row_number() OVER(ORDER BY position,id)-1 AS p FROM meal_plan_items WHERE meal_plan_meal_id=?) UPDATE meal_plan_items i SET position=ranked.p FROM ranked WHERE i.id=ranked.id`,
          )
          .run(item.meal_plan_meal_id);
        await bump(item.meal_plan_id);
      });
      res.status(204).end();
    }),
  );
  router.put(
    "/meal-plan-meals/:mealId/items/order",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const meal = await requireDraftByMeal(user, id.parse(req.params.mealId), deps);
      const order = z
        .object({ ids: z.array(z.number().int().positive()).max(50) })
        .parse(req.body).ids;
      const existing = (
        await db
          .prepare("SELECT id FROM meal_plan_items WHERE meal_plan_meal_id=? ORDER BY id")
          .all<{ id: number }>(meal.id)
      )
        .map((x) => Number(x.id))
        .sort((a, b) => a - b);
      if ([...order].sort((a, b) => a - b).join() != existing.join())
        throw new MealPlanError("A ordem deve conter todos os alimentos da refeição.");
      await transaction(async () => {
        await db
          .prepare("SET CONSTRAINTS meal_plan_items_meal_plan_meal_id_position_key DEFERRED")
          .run();
        for (const [position, itemId] of order.entries())
          await db
            .prepare(
              "UPDATE meal_plan_items SET position=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
            )
            .run(position, itemId);
        await bump(meal.meal_plan_id);
      });
      res.json(await loadPlan(meal.meal_plan_id));
    }),
  );
  router.get(
    "/meal-plan-items/:itemId/substitution-suggestions",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const item = await requireDraftByItem(user, id.parse(req.params.itemId), deps);
      const approved = await db
        .prepare("SELECT food_id FROM meal_plan_item_substitutions WHERE meal_plan_item_id=?")
        .all<{ food_id: number }>(item.id);
      const [result, patient] = await Promise.all([
        automaticSubstitutionSuggestions(
          Number(item.food_id),
          Number(item.grams_equivalent),
          approved.map((row) => Number(row.food_id)),
        ),
        db.prepare("SELECT food_preferences,food_restrictions,allergies FROM patients WHERE id=?")
          .get<Record<string, string | null>>(item.patient_id),
      ]);
      res.json({
        ...result,
        patientContext: {
          preferences: patient?.food_preferences ?? null,
          restrictions: patient?.food_restrictions ?? null,
          allergies: patient?.allergies ?? null,
          structuredFiltering: false,
        },
      });
    }),
  );
  router.get(
    "/meal-plan-items/:itemId/substitution-equivalence",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const item = await requireDraftByItem(user, id.parse(req.params.itemId), deps);
      const candidateFoodId = id.parse(req.query.foodId);
      if (candidateFoodId === Number(item.food_id))
        throw new MealPlanError("O alimento principal não pode substituir a si mesmo.", 409);
      const result = await manualSubstitutionEquivalence(
        Number(item.food_id),
        Number(item.grams_equivalent),
        candidateFoodId,
      );
      if (!result)
        throw new MealPlanError("Não há dados nutricionais suficientes para calcular esta alternativa.", 422);
      res.json(result);
    }),
  );
  router.post(
    "/meal-plan-items/:itemId/substitutions",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const item = await requireDraftByItem(user, id.parse(req.params.itemId), deps);
      const payload = substitutionPayload.parse(req.body);
      await transaction(async () => {
        await assertDraftLocked(Number(item.meal_plan_id));
        await ensureDistinctSubstitution(item, payload.foodId);
        const count = await db
          .prepare("SELECT count(*)::int AS count FROM meal_plan_item_substitutions WHERE meal_plan_item_id=?")
          .get<{ count: number }>(item.id);
        if (Number(count?.count) >= 3)
          throw new MealPlanError("Cada alimento pode ter no máximo 3 substituições.", 409);
        const suggested = await manualSubstitutionEquivalence(
          Number(item.food_id),
          Number(item.grams_equivalent),
          payload.foodId,
        );
        if (!suggested)
          throw new MealPlanError("Não há dados nutricionais suficientes para calcular esta alternativa.", 422);
        if (payload.origin === "suggestion" && !suggested.equivalence.automaticCompatible)
          throw new MealPlanError("Esta opção não atende mais aos critérios de sugestão automática.", 409);
        const hasQuantity = payload.grams != null || payload.quantity != null || payload.measureId != null;
        const converted = hasQuantity
          ? await resolveQuantity(payload.foodId, payload).catch((error) => {
              throw new MealPlanError(error.message);
            })
          : {
              amount: suggested.equivalence.amount,
              unit: suggested.equivalence.unit,
              grams: suggested.equivalence.gramsFinal,
              snapshot: suggested.equivalence.measureSnapshot,
            };
        const evaluated = hasQuantity
          ? await manualSubstitutionEquivalence(
              Number(item.food_id),
              Number(item.grams_equivalent),
              payload.foodId,
              converted.grams,
            )
          : suggested;
        if (!evaluated)
          throw new MealPlanError("Não foi possível avaliar a quantidade desta alternativa.", 422);
        const position = await db
          .prepare("SELECT COALESCE(MAX(position),-1)::int+1 AS position FROM meal_plan_item_substitutions WHERE meal_plan_item_id=?")
          .get<{ position: number }>(item.id);
        await db.prepare(`INSERT INTO meal_plan_item_substitutions(
          meal_plan_item_id,food_id,position,amount,unit,grams_equivalent,measure_snapshot,origin,algorithm_version,equivalence_metadata)
          VALUES(?,?,?,?,?,?,?::jsonb,?,?,?::jsonb)`)
          .run(
            item.id,
            payload.foodId,
            position!.position,
            converted.amount,
            converted.unit,
            converted.grams,
            JSON.stringify(converted.snapshot),
            payload.origin,
            SUBSTITUTION_ALGORITHM_VERSION,
            JSON.stringify(equivalenceMetadata(evaluated.equivalence)),
          );
        await bump(Number(item.meal_plan_id));
      });
      res.status(201).json(await loadPlan(Number(item.meal_plan_id)));
    }),
  );
  router.patch(
    "/meal-plan-item-substitutions/:substitutionId",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const substitution = await requireDraftSubstitution(
        user,
        id.parse(req.params.substitutionId),
        deps,
      );
      const payload = substitutionPatch.parse(req.body);
      await transaction(async () => {
        await assertDraftLocked(Number(substitution.meal_plan_id));
        const converted = await resolveQuantity(
          Number(substitution.food_id),
          payload,
          substitution.measure_snapshot,
        ).catch((error) => {
          throw new MealPlanError(error.message);
        });
        const evaluated = await manualSubstitutionEquivalence(
          Number(substitution.original_food_id),
          Number(substitution.original_grams),
          Number(substitution.food_id),
          converted.grams,
        );
        if (!evaluated)
          throw new MealPlanError("Não foi possível avaliar a quantidade desta alternativa.", 422);
        await db.prepare(`UPDATE meal_plan_item_substitutions SET
          amount=?,unit=?,grams_equivalent=?,measure_snapshot=?::jsonb,
          algorithm_version=?,equivalence_metadata=?::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(
            converted.amount,
            converted.unit,
            converted.grams,
            JSON.stringify(converted.snapshot),
            SUBSTITUTION_ALGORITHM_VERSION,
            JSON.stringify(equivalenceMetadata(evaluated.equivalence)),
            substitution.id,
          );
        await bump(Number(substitution.meal_plan_id));
      });
      res.json(await loadPlan(Number(substitution.meal_plan_id)));
    }),
  );
  router.delete(
    "/meal-plan-item-substitutions/:substitutionId",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const substitution = await requireDraftSubstitution(
        user,
        id.parse(req.params.substitutionId),
        deps,
      );
      await transaction(async () => {
        await assertDraftLocked(Number(substitution.meal_plan_id));
        await db.prepare("DELETE FROM meal_plan_item_substitutions WHERE id=?").run(substitution.id);
        await db.prepare(`WITH ranked AS(
          SELECT id,row_number() OVER(ORDER BY position,id)-1 AS p
          FROM meal_plan_item_substitutions WHERE meal_plan_item_id=?
        ) UPDATE meal_plan_item_substitutions s SET position=ranked.p,updated_at=CURRENT_TIMESTAMP
          FROM ranked WHERE s.id=ranked.id`).run(substitution.meal_plan_item_id);
        await bump(Number(substitution.meal_plan_id));
      });
      res.status(204).end();
    }),
  );
  router.put(
    "/meal-plan-items/:itemId/substitutions/order",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const item = await requireDraftByItem(user, id.parse(req.params.itemId), deps);
      const order = z.object({ ids: z.array(z.number().int().positive()).max(3) }).parse(req.body).ids;
      const existing = (await db
        .prepare("SELECT id FROM meal_plan_item_substitutions WHERE meal_plan_item_id=? ORDER BY id")
        .all<{ id: number }>(item.id)).map((row) => Number(row.id)).sort((a, b) => a - b);
      if ([...order].sort((a, b) => a - b).join() !== existing.join())
        throw new MealPlanError("A ordem deve conter todas as substituições do alimento.");
      await transaction(async () => {
        await assertDraftLocked(Number(item.meal_plan_id));
        await db.prepare("SET CONSTRAINTS meal_plan_item_substitutions_meal_plan_item_id_position_key DEFERRED").run();
        for (const [position, substitutionId] of order.entries())
          await db.prepare("UPDATE meal_plan_item_substitutions SET position=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND meal_plan_item_id=?")
            .run(position, substitutionId, item.id);
        await bump(Number(item.meal_plan_id));
      });
      res.json(await loadPlan(Number(item.meal_plan_id)));
    }),
  );
  router.get(
    "/patient/meal-plan",
    handler(async (req, res) => {
      const user = await deps.authUser(req, res);
      if (!user) return;
      if (user.role !== "patient") throw new MealPlanError("Área exclusiva do paciente.", 403);
      const patient = await deps.patientAccess(user);
      if (!patient) throw new MealPlanError("Paciente não encontrado.", 404);
      const plan = await db
        .prepare("SELECT id FROM meal_plans WHERE patient_id=? AND status='active'")
        .get<{ id: number }>(patient.id);
      res.json(plan ? await loadPlan(plan.id) : null);
    }),
  );
  return router;
}

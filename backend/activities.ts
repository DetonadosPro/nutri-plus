import express, { type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { db, transaction } from "./db";
import type { AuthUser } from "./auth";
import {
  ACTIVITY_FACTORS,
  calculateStrengthTrainingCalories,
  ENERGY_VERSION,
  energyBalance,
  manualEnergy,
  thermicEffectOfFood,
} from "./domain/activity-energy";
import { ageSpecificEnergy, referenceForAge, schofieldRestingKcal } from "./domain/age-activity-energy";
import {
  addCalendarDays,
  brazilDate,
  inclusiveDaysBetween,
  isCalendarDate,
  isClockTime,
} from "./domain/datetime";
import { patientMetrics } from "./domain/nutrition";

type Row = Record<string, any>;
const date = z.string().refine(isCalendarDate, "Data inválida");
const positiveId = z.coerce.number().int().positive();
export const activityInput = z
  .object({
    date,
    time: z.string().refine(isClockTime).nullable(),
    duration: z.number().positive().max(1440),
    intensity: z.enum(["light", "moderate", "vigorous", "unspecified"]),
    outsideBase: z.boolean(),
    code: z.string().max(20).nullable(),
    version: z.string().max(40).nullable(),
    manual: z
      .object({
        name: z.string().trim().min(2).max(180),
        kcal: z.number().min(0).max(20000),
        kind: z.enum(["gross", "net", "unknown"]),
        source: z.string().trim().min(2).max(300),
      })
      .nullable(),
    details: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(150),
          sets: z.number().int().min(1).max(100),
          reps: z.number().int().min(1).max(500).nullable(),
          loadKg: z.number().min(0).max(1500).nullable(),
          executionSeconds: z.number().positive().max(3600).nullable(),
          restSeconds: z.number().min(0).max(3600).nullable(),
        }),
      )
      .max(60),
    note: z.string().max(3000),
    revision: z.number().int().positive().optional(),
    recalculate: z.boolean().default(false),
    preserveWeight: z.boolean().default(false),
    restPeriod: z.enum(["under30", "30to60", "1to2", "2to3", "over3"]).nullable().optional(),
    restSeconds: z.number().int().min(1).max(1200).nullable().optional(),
    calculationProfile: z.enum(["quick_strength", "catalog_specific"]).default("catalog_specific"),
  })
  .superRefine((p, ctx) => {
    if (!!p.code === !!p.manual || (p.code && !p.version))
      ctx.addIssue({ code: "custom", message: "Escolha catálogo ou registro manual." });
    const seconds = p.details.reduce(
      (s, d) =>
        s + (d.executionSeconds ?? 0) * d.sets + (d.restSeconds ?? 0) * Math.max(0, d.sets - 1),
      0,
    );
    if (seconds > p.duration * 60)
      ctx.addIssue({ code: "custom", message: "Séries e descansos excedem a duração total." });
  });
class ActivityError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function legacyRestSeconds(value: Row["rest_period"]): number | null {
  const values: Record<string, number> = {
    under30: 30,
    "30to60": 45,
    "1to2": 90,
    "2to3": 150,
    over3: 240,
  };
  return typeof value === "string" ? (values[value] ?? null) : null;
}
function restPeriodForSeconds(seconds: number | null) {
  if (seconds == null) return null;
  if (seconds <= 30) return "under30";
  if (seconds <= 60) return "30to60";
  if (seconds <= 120) return "1to2";
  if (seconds <= 180) return "2to3";
  return "over3";
}
export async function seedActivityCatalog() {
  const rows = JSON.parse(
    readFileSync(new URL("./data/activities/catalog-2024-pt-BR.json", import.meta.url), "utf8"),
  );
  await db
    .prepare(`INSERT INTO activity_catalog(code,version,name,category,description,aliases,met,source,notes,resistance)
    SELECT code,version,name,category,description,aliases,met,source,notes,resistance FROM jsonb_to_recordset(?::jsonb)
    AS c(code text,version text,name text,category text,description text,aliases text[],met double precision,source text,notes text,resistance boolean)
    ON CONFLICT(code,version) DO NOTHING`)
    .run(JSON.stringify(rows));
}
function ageAt(birth: string | null, day: string) {
  if (!birth) return null;
  return (
    Number(day.slice(0, 4)) - Number(birth.slice(0, 4)) - (day.slice(5) < birth.slice(5) ? 1 : 0)
  );
}
export async function energyHistory(patient: Row, from: string, to: string) {
  const id = Number(patient.id);
  const [sessions, weights, settings, goalFactors, food, saved] = [
    await db
      .prepare(
        "SELECT * FROM activity_sessions WHERE patient_id = ? AND activity_date BETWEEN ? AND ? ORDER BY activity_date DESC, local_time DESC,id DESC",
      )
      .all<Row>(id, from, to),
    await db
      .prepare(
        "SELECT weight_kg,weighed_at FROM weight_history WHERE patient_id = ? AND weighed_at <= ? ORDER BY weighed_at DESC",
      )
      .all<Row>(id, to),
    await db
      .prepare(
        "SELECT * FROM energy_settings WHERE patient_id = ? ORDER BY valid_from DESC,id DESC",
      )
      .all<Row>(id),
    await db
      .prepare(
        "SELECT valid_from,daily_activity_factor FROM nutrition_goals WHERE patient_id = ? ORDER BY valid_from DESC,id DESC",
      )
      .all<Row>(id),
    await db
      .prepare(`SELECT dl.log_date,COUNT(me.id)::int AS entries,COUNT(me.id) FILTER(WHERE nutrients.energy IS NULL)::int AS missing,
      SUM(nutrients.energy*me.grams_equivalent/100) AS kcal,
      SUM(nutrients.protein*me.grams_equivalent/100) AS protein_g,
      SUM(nutrients.carbohydrate*me.grams_equivalent/100) AS carbohydrate_g,
      SUM(nutrients.fat*me.grams_equivalent/100) AS fat_g
      FROM daily_logs dl JOIN meals m ON m.daily_log_id=dl.id JOIN meal_entries me ON me.meal_id=m.id
      LEFT JOIN LATERAL (
        SELECT
          MAX(numeric_value) FILTER (WHERE nutrient_code='energia_kcal') AS energy,
          MAX(numeric_value) FILTER (WHERE nutrient_code='proteina_g') AS protein,
          MAX(numeric_value) FILTER (WHERE nutrient_code='carboidrato_g') AS carbohydrate,
          MAX(numeric_value) FILTER (WHERE nutrient_code='lipideos_g') AS fat
        FROM food_nutrients WHERE food_id=me.food_id
      ) nutrients ON TRUE
      WHERE dl.patient_id = ? AND dl.log_date BETWEEN ? AND ? GROUP BY dl.log_date`)
      .all<Row>(id, from, to),
    await db
      .prepare("SELECT * FROM energy_day_snapshots WHERE patient_id = ? AND day BETWEEN ? AND ?")
      .all<Row>(id, from, to),
  ];
  const today = brazilDate();
  const freeze: Row[] = [];
  const days = [];
  for (let day = from; day <= to; day = addCalendarDays(day, 1)) {
    const weight = weights.find((w) => w.weighed_at <= day) ?? null;
    const setting = settings.find((s) => s.valid_from <= day);
    const goal = goalFactors.find((g) => g.valid_from <= day);
    const age = ageAt(patient.birth_date, day);
    const mode = setting?.mode ?? "base_plus_net";
    const factor =
      goal?.daily_activity_factor ??
      setting?.factor ??
      (mode === "base_plus_net"
        ? 1
        : ACTIVITY_FACTORS[patient.activity_level]) ??
      null;
    const clinicalReview = setting?.clinical_review ?? false;
    const metrics = patientMetrics({
      weightKg: weight?.weight_kg,
      heightCm: patient.height_cm,
      age,
      sex: patient.sex,
    });
    const youthResting = age != null && age >= 6 && age <= 18 && weight && (patient.sex === "male" || patient.sex === "female")
      ? schofieldRestingKcal(weight.weight_kg, age, patient.sex)
      : null;
    const restingKcal = clinicalReview || age == null || age < 6
      ? null
      : age <= 18 ? youthResting : metrics.basalKcal;
    const base = saved.find((s) => s.day === day)?.snapshot ?? {
      version: ENERGY_VERSION,
      restingKcal,
      factor,
      baseKcal: restingKcal == null || factor == null ? null : restingKcal * factor,
      mode,
      weight,
      age,
      heightCm: patient.height_cm,
      sex: patient.sex,
      restingFormula: age != null && age <= 18 ? "Schofield" : "Mifflin-St Jeor",
      clinicalReview,
      settingId: setting?.id ?? null,
      note:
        setting?.note ??
        "Base cotidiana sem exercícios registrados; atividades elegíveis são somadas pelo gasto bruto.",
    };
    if (day < today && !saved.some((s) => s.day === day))
      freeze.push({ patient_id: id, day, snapshot: base });
    const activities = sessions.filter((s) => s.activity_date === day);
    const ingestion = food.find((f) => f.log_date === day);
    const complete = Boolean(ingestion?.entries > 0) && !(ingestion?.missing > 0);
    const intakeKcal = complete ? (ingestion?.kcal ?? 0) : null;
    const tefKcal = thermicEffectOfFood({
      proteinG: ingestion?.protein_g ?? null,
      carbohydrateG: ingestion?.carbohydrate_g ?? null,
      fatG: ingestion?.fat_g ?? null,
    });
    const balance = energyBalance(
      intakeKcal,
      base.baseKcal,
      tefKcal,
      base.mode,
      activities.map((s) => ({ outside_base: s.outside_base, snapshot: s.snapshot })),
    );
    days.push({
      date: day,
      base,
      habitualKcal:
        base.baseKcal == null || base.restingKcal == null ? null : base.baseKcal - base.restingKcal,
      activities,
      intakeKcal,
      tefKcal,
      knownIntakeKcal: ingestion?.kcal ?? null,
      foodComplete: complete,
      missingFoodEnergy: ingestion?.missing ?? 0,
      ...balance,
    });
  }
  if (freeze.length) {
    await db
      .prepare(
        `INSERT INTO energy_day_snapshots(patient_id,day,snapshot) SELECT patient_id,day,snapshot FROM jsonb_to_recordset(?::jsonb) AS d(patient_id bigint,day date,snapshot jsonb) ON CONFLICT DO NOTHING`,
      )
      .run(JSON.stringify(freeze));
  }
  const completeDays = days.filter((d) => d.foodComplete && d.balanceKcal != null);
  let accumulated = 0;
  const chartDays = days.map((d) => ({
    ...d,
    accumulatedKcal:
      d.foodComplete && d.balanceKcal != null ? (accumulated += d.balanceKcal) : null,
  }));
  const modalities = Object.values(
    sessions.reduce((map: Record<string, Row>, s) => {
      const name = s.snapshot.name;
      map[name] ??= { name, minutes: 0, sessions: 0 };
      map[name].minutes += s.duration_minutes;
      map[name].sessions++;
      return map;
    }, {}),
  );
  return {
    from,
    to,
    days: chartDays,
    sessions,
    modalities,
    completeDays: completeDays.length,
    accumulatedKcal: completeDays.length ? accumulated : null,
    theoreticalKg:
      completeDays.length &&
      !settings[0]?.clinical_review &&
      days.every((d) => !d.base.clinicalReview && d.base.age >= 19)
        ? accumulated / 7700
        : null,
  };
}

export function activitiesRouter(deps: {
  authUser: (req: Request, res: Response) => Promise<AuthUser | null | undefined>;
  patientAccess: (user: AuthUser, id?: number) => Promise<Row | null | undefined>;
}) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try {
      const user = await deps.authUser(req, res);
      if (!user) return;
      const id = req.query.patientId == null ? undefined : positiveId.parse(req.query.patientId);
      const patient = await deps.patientAccess(user, id);
      if (!patient) return res.status(403).json({ error: "Você não tem acesso a este paciente." });
      res.locals.user = user;
      res.locals.patient = patient;
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get("/catalog", async (req, res) => {
    const catalogDay = date.parse(req.query.date ?? brazilDate());
    const age = ageAt(res.locals.patient.birth_date, catalogDay);
    const rows = await db
      .prepare(`SELECT c.*,EXISTS(SELECT 1 FROM activity_favorites f WHERE f.user_id=? AND f.code=c.code AND f.version=c.version) AS favorite,
      (SELECT MAX(a.activity_date) FROM activity_sessions a WHERE a.patient_id=? AND a.snapshot->>'code'=c.code AND a.snapshot->>'catalogVersion'=c.version) AS recent
      FROM activity_catalog c ORDER BY c.name`)
      .all(res.locals.user.id, res.locals.patient.id);
    res.json(rows.flatMap((row: Row) => {
      const reference = referenceForAge(row.code, row.met, age);
      return reference ? [{ ...row, met: reference.met, source: reference.source, notes: reference.notes, referenceKind: reference.referenceKind, referenceCode: reference.referenceCode, ageBand: reference.ageBand }] : [];
    }));
  });
  router.put("/favorites", async (req, res) => {
    const p = z
      .object({ code: z.string(), version: z.string(), favorite: z.boolean() })
      .parse(req.body);
    if (
      !(await db
        .prepare("SELECT 1 FROM activity_catalog WHERE code=? AND version=?")
        .get(p.code, p.version))
    )
      throw new ActivityError(404, "Atividade não encontrada.");
    if (p.favorite)
      await db
        .prepare(
          "INSERT INTO activity_favorites(user_id,code,version) VALUES(?,?,?) ON CONFLICT DO NOTHING",
        )
        .run(res.locals.user.id, p.code, p.version);
    else
      await db
        .prepare("DELETE FROM activity_favorites WHERE user_id=? AND code=? AND version=?")
        .run(res.locals.user.id, p.code, p.version);
    res.sendStatus(204);
  });
  router.get("/recent", async (_req, res) => {
    res.json(
      await db
        .prepare(`SELECT * FROM (
      SELECT DISTINCT ON (snapshot->>'code',snapshot->>'catalogVersion') *
      FROM activity_sessions WHERE patient_id=? AND snapshot->>'method'='met'
      ORDER BY snapshot->>'code',snapshot->>'catalogVersion',activity_date DESC,id DESC
    ) recent ORDER BY activity_date DESC,id DESC LIMIT 8`)
        .all(res.locals.patient.id),
    );
  });
  router.get("/history", async (req, res) => {
    const to = date.parse(req.query.to ?? brazilDate()),
      from = date.parse(req.query.from ?? addCalendarDays(to, -6));
    if (from > to || to > brazilDate() || inclusiveDaysBetween(from, to) > 366)
      throw new ActivityError(400, "Escolha até 366 dias, sem datas futuras.");
    res.json(await energyHistory(res.locals.patient, from, to));
  });
  router.put("/food-status", async (req, res) => {
    const p = z.object({ date, complete: z.boolean() }).parse(req.body);
    if (p.date > brazilDate())
      throw new ActivityError(400, "Não é possível concluir um dia futuro.");
    await db
      .prepare(
        "INSERT INTO energy_food_status(patient_id,day,complete) VALUES(?,?,?) ON CONFLICT(patient_id,day) DO UPDATE SET complete=excluded.complete,updated_at=CURRENT_TIMESTAMP",
      )
      .run(res.locals.patient.id, p.date, p.complete);
    res.sendStatus(204);
  });
  router.post("/estimate", async (req, res) => {
    const p = z
      .object({
        date,
        duration: z.number().positive().max(1440),
        code: z.string().max(20),
        version: z.string().max(40),
        restSeconds: z.number().int().min(1).max(1200).nullable(),
        intensity: z.enum(["light", "moderate", "vigorous", "unspecified"]),
        calculationProfile: z.enum(["quick_strength", "catalog_specific"]).default("catalog_specific"),
      })
      .parse(req.body);
    const patient = res.locals.patient;
    const weight = await db
      .prepare(
        "SELECT weight_kg,weighed_at FROM weight_history WHERE patient_id=? AND weighed_at<=? ORDER BY weighed_at DESC LIMIT 1",
      )
      .get<Row>(patient.id, p.date);
    if (!weight) throw new ActivityError(400, "Registre um peso com data igual ou anterior à atividade.");
    const catalog = await db
      .prepare("SELECT * FROM activity_catalog WHERE code=? AND version=?")
      .get<Row>(p.code, p.version);
    if (!catalog) throw new ActivityError(404, "Atividade não encontrada.");
    const age = ageAt(patient.birth_date, p.date);
    const reference = referenceForAge(catalog.code, catalog.met, age);
    if (!reference) throw new ActivityError(400, "Esta modalidade não possui referência para a idade nesta data.");
    const resting = age != null && age <= 18 && (patient.sex === "male" || patient.sex === "female")
      ? schofieldRestingKcal(weight.weight_kg, age, patient.sex)
      : null;
    const base = ageSpecificEnergy(reference, weight.weight_kg, p.duration, resting);
    const energy = catalog.resistance && p.calculationProfile === "quick_strength" && reference.referenceKind === "adult-met"
      ? calculateStrengthTrainingCalories(base, p.restSeconds, p.intensity, reference.met)
      : base;
    res.json({ kcal: energy.grossKcal });
  });
  router.post("/recalculate-base", async (req, res) => {
    if (res.locals.user.role !== "nutritionist")
      throw new ActivityError(403, "Recálculo exclusivo do nutricionista.");
    const p = z.object({ date, reason: z.string().trim().min(5).max(1000) }).parse(req.body);
    if (p.date >= brazilDate())
      throw new ActivityError(
        400,
        "O dia atual já usa os dados atuais. Selecione um dia anterior.",
      );
    const result = await transaction(async () => {
      await db.prepare("SELECT id FROM patients WHERE id=? FOR UPDATE").get(res.locals.patient.id);
      const prior = await db
        .prepare(
          "SELECT snapshot FROM energy_day_snapshots WHERE patient_id=? AND day=? FOR UPDATE",
        )
        .get(res.locals.patient.id, p.date);
      await db
        .prepare(
          "INSERT INTO energy_base_revisions(patient_id,day,previous_snapshot,reason,changed_by) VALUES(?,?,?::jsonb,?,?)",
        )
        .run(
          res.locals.patient.id,
          p.date,
          prior ? JSON.stringify(prior.snapshot) : null,
          p.reason,
          res.locals.user.id,
        );
      await db
        .prepare("DELETE FROM energy_day_snapshots WHERE patient_id=? AND day=?")
        .run(res.locals.patient.id, p.date);
      return energyHistory(res.locals.patient, p.date, p.date);
    });
    res.json(result);
  });
  router.post("/settings", async (req, res) => {
    if (res.locals.user.role !== "nutritionist")
      throw new ActivityError(403, "Configuração exclusiva do nutricionista.");
    const p = z
      .object({
        mode: z.enum(["habitual_includes_exercise", "base_plus_net"]),
        factor: z.number().min(1).max(2.5),
        clinicalReview: z.boolean(),
        note: z.string().trim().min(5).max(1000),
      })
      .parse(req.body);
    // Preserve all prior days before changing the effective configuration.
    await db
      .prepare(
        "INSERT INTO energy_settings(patient_id,valid_from,mode,factor,clinical_review,note,created_by) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        res.locals.patient.id,
        brazilDate(),
        p.mode,
        p.factor,
        p.clinicalReview,
        p.note,
        res.locals.user.id,
      );
    res.status(201).json({ validFrom: brazilDate() });
  });
  const save = async (req: Request, res: Response) => {
    const p = activityInput.parse(req.body),
      id = req.params.id ? positiveId.parse(req.params.id) : null;
    if (p.date > brazilDate())
      throw new ActivityError(400, "Use a data em que a atividade foi realizada.");
    const patient = res.locals.patient;
    const result = await transaction(async () => {
      await db.prepare("SELECT id FROM patients WHERE id=? FOR UPDATE").get(patient.id);
      const old = id
        ? await db
            .prepare("SELECT * FROM activity_sessions WHERE id=? AND patient_id=? FOR UPDATE")
            .get<Row>(id, patient.id)
        : null;
      if (id && !old) throw new ActivityError(404, "Registro não encontrado.");
      if (old && p.revision !== old.revision)
        throw new ActivityError(409, "O registro mudou. Reabra antes de editar.");
      const start =
        p.time == null ? null : Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3));
      if (start != null && start + p.duration > 1440)
        throw new ActivityError(
          400,
          "Divida sessões que atravessam a meia-noite em dois registros.",
        );
      const overlap =
        start == null
          ? null
          : await db
              .prepare(`SELECT id FROM activity_sessions WHERE patient_id=? AND activity_date=? AND id<>?
        AND EXTRACT(EPOCH FROM local_time)/60 < ? AND EXTRACT(EPOCH FROM local_time)/60+duration_minutes > ?`)
              .get(patient.id, p.date, id ?? 0, start + p.duration, start);
      if (overlap)
        throw new ActivityError(
          409,
          "Já existe atividade nesse horário. Ajuste o horário para evitar contagem duplicada.",
        );
      const total = await db
        .prepare(
          "SELECT COALESCE(SUM(duration_minutes),0) AS minutes FROM activity_sessions WHERE patient_id=? AND activity_date=? AND id<>?",
        )
        .get(patient.id, p.date, id ?? 0);
      if (total!.minutes + p.duration > 1440)
        throw new ActivityError(
          400,
          "As atividades excedem a duração deste dia. Revise seus registros.",
        );
      const restSeconds = p.restSeconds === undefined
        ? (legacyRestSeconds(p.restPeriod) ?? old?.rest_seconds ?? legacyRestSeconds(old?.rest_period))
        : p.restSeconds;
      let snapshot = old?.snapshot;
      const changed =
        !old ||
        p.date !== old.activity_date ||
        p.duration !== old.duration_minutes ||
        p.intensity !== old.intensity ||
        p.calculationProfile !== (old.snapshot.calculationProfile ?? "catalog_specific") ||
        restSeconds !== (old.rest_seconds ?? legacyRestSeconds(old.rest_period)) ||
        p.code !== old.snapshot.code ||
        p.version !== old.snapshot.catalogVersion ||
        p.manual?.name !== old.snapshot.manual?.name ||
        p.manual?.kcal !== old.snapshot.manual?.kcal ||
        p.manual?.kind !== old.snapshot.manual?.kind ||
        p.manual?.source !== old.snapshot.manual?.source;
      if (old && changed && !p.recalculate)
        throw new ActivityError(
          400,
          "Confirme o recálculo ao alterar data, atividade, duração ou valor manual.",
        );
      if (changed || p.recalculate) {
        const weight =
          p.preserveWeight && old && p.date === old.activity_date
            ? old.snapshot.weight
            : ((await db
                .prepare(
                  "SELECT weight_kg,weighed_at FROM weight_history WHERE patient_id=? AND weighed_at<=? ORDER BY weighed_at DESC LIMIT 1",
                )
                .get<Row>(patient.id, p.date)) ?? null);
        const catalog = p.code
          ? await db
              .prepare("SELECT * FROM activity_catalog WHERE code=? AND version=?")
              .get<Row>(p.code, p.version)
          : null;
        if (p.code && !catalog) throw new ActivityError(404, "Atividade não encontrada.");
        const age = ageAt(patient.birth_date, p.date);
        const reference = catalog ? referenceForAge(catalog.code, catalog.met, age) : null;
        if (catalog && !reference)
          throw new ActivityError(400, age != null && age < 6
            ? "Para menores de 6 anos, informe um gasto fornecido por um profissional."
            : "Esta modalidade não possui referência equivalente para a idade nesta data. Escolha outra modalidade ou informe um gasto profissional.");
        if (catalog && !weight)
          throw new ActivityError(400, "Registre um peso com data igual ou anterior à atividade.");
        const restingForActivity = catalog && age != null && age <= 18 && (patient.sex === "male" || patient.sex === "female")
          ? schofieldRestingKcal(weight!.weight_kg, age, patient.sex)
          : null;
        const baseEnergy = catalog
          ? ageSpecificEnergy(reference!, weight!.weight_kg, p.duration, restingForActivity)
          : manualEnergy(p.manual!.kcal, p.manual!.kind, weight?.weight_kg ?? null, p.duration);
        const energy = catalog?.resistance && p.calculationProfile === "quick_strength" && reference?.referenceKind === "adult-met"
          ? calculateStrengthTrainingCalories(
              baseEnergy as { grossKcal: number; netKcal: number },
              restSeconds,
              p.intensity,
              reference!.met,
            )
          : baseEnergy;
        snapshot = {
          version: ENERGY_VERSION,
          method: catalog ? "met" : "manual",
          code: p.code,
          catalogVersion: p.version,
          name: catalog?.name ?? p.manual!.name,
          category: catalog?.category ?? "Informado manualmente",
          met: catalog?.resistance
            ? ((energy as { effectiveMet?: number }).effectiveMet ?? reference!.met)
            : (reference?.met ?? null),
          source: reference?.source ?? p.manual!.source,
          notes: reference?.notes ?? "",
          referenceKind: reference?.referenceKind ?? "manual",
          referenceCode: reference?.referenceCode ?? null,
          referenceAgeBand: reference?.ageBand ?? null,
          resistance: catalog?.resistance ?? false,
          calculationProfile: p.calculationProfile,
          weight,
          manual: p.manual,
          ...energy,
          calculatedAt: new Date().toISOString(),
        };
      }
      if (p.details.length && !snapshot.resistance)
        throw new ActivityError(400, "Detalhes de séries exigem uma atividade resistida.");
      const restPeriod = p.restPeriod === undefined
        ? restPeriodForSeconds(restSeconds)
        : p.restPeriod;
      if (restPeriod && !snapshot.resistance)
        throw new ActivityError(400, "Descanso entre séries exige uma atividade de musculação.");
      // Rest is descriptive. Compendium session MET already includes pauses;
      // there is no defensible universal multiplier based on rest duration.
      if (old) {
        await db
          .prepare(
            "INSERT INTO activity_revisions(session_id,revision,previous_record,changed_by) VALUES(?,?,?::jsonb,?)",
          )
          .run(id, old.revision, JSON.stringify(old), res.locals.user.id);
        return db
          .prepare(
            `UPDATE activity_sessions SET activity_date=?,local_time=?,duration_minutes=?,intensity=?,outside_base=?,snapshot=?::jsonb,details=?::jsonb,note=?,rest_period=?,rest_seconds=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND patient_id=? RETURNING *`,
          )
          .get(
            p.date,
            p.time,
            p.duration,
            p.intensity,
            p.outsideBase,
            JSON.stringify(snapshot),
            JSON.stringify(p.details),
            p.note,
            restPeriod,
            restSeconds,
            id,
            patient.id,
          );
      }
      return db
        .prepare(
          `INSERT INTO activity_sessions(patient_id,recorded_by,activity_date,local_time,duration_minutes,intensity,outside_base,snapshot,details,note,rest_period,rest_seconds) VALUES(?,?,?,?,?,?,?,?::jsonb,?::jsonb,?,?,?) RETURNING *`,
        )
        .get(
          patient.id,
          res.locals.user.id,
          p.date,
          p.time,
          p.duration,
          p.intensity,
          p.outsideBase,
          JSON.stringify(snapshot),
          JSON.stringify(p.details),
          p.note,
          restPeriod,
          restSeconds,
        );
    });
    res.status(id ? 200 : 201).json(result);
  };
  router.post("/sessions", save);
  router.put("/sessions/:id", save);
  router.delete("/sessions/:id", async (req, res) => {
    const id = positiveId.parse(req.params.id),
      revision = positiveId.parse(req.query.revision);
    const r = await db
      .prepare("DELETE FROM activity_sessions WHERE id=? AND patient_id=? AND revision=?")
      .run(id, res.locals.patient.id, revision);
    if (!r.changes)
      throw new ActivityError(409, "Registro removido ou alterado. Atualize a lista.");
    res.sendStatus(204);
  });
  router.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({ error: error.issues.map((i) => i.message).join(" ") });
    if (error instanceof ActivityError)
      return res.status(error.status).json({ error: error.message });
    console.error("Falha no módulo de atividades", error instanceof Error ? error.message : "");
    res.status(500).json({ error: "Não foi possível atualizar as atividades." });
  });
  return router;
}

import { measuresForFoods, quantityInput, resolveQuantity } from './food-measures';
import { patientAccess } from './patient-access';
import { deduplicateDetections,decideMatch,MATCH_THRESHOLDS,needsMeatConfirmation,recognizePhoto,rerankPhoto,rankSemanticFoodCandidates } from './food-recognition';
import { tbcaCandidatesForDetection } from './food-identity-repository';
import type { MatchState } from '../shared/food-recognition';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { activitiesRouter, seedActivityCatalog } from './activities';
import express, { type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { foodSearchTokenVariants,normalizeFoodQuery } from '../shared/food-recognition';
import { databaseInfo, db, migrate, transaction } from "./db";
import {
  createAccountToken,
  createActivationCode,
  createSession,
  deleteSession,
  hashPassword,
  normalizeActivationCode,
  userForSession,
  verifyPassword,
  type AuthUser,
} from "./auth";
import { accountMailHtml, appUrlForRequest, sendMail, deliveryResult } from "./mailer";
import { appConfig } from "./config";
import { AccountTokenError, saveAccountToken, validAccountToken, withAccountToken } from './account-tokens';
import { accountMailLimit, authenticationLimits, configureSecurity, sessionCookieOptions } from './security';
import { normalizeSearch } from "./taco-import";
import {
  macroEnergy,
  macroGoalsFromEnergy,
  patientMetrics,
  proteinPerKg,
  scaleNutrients,
  sumNutrientSets,
  waterGoalMl,
  type NutrientMap,
} from "./domain/nutrition";
import {
  calculateGlycemicLoad,
  dailyGlycemicSummary,
  periodGlycemicSummary,
} from "./domain/glycemic";
import {
  addCalendarDays,
  brazilDate,
  brazilTime,
  inclusiveDaysBetween,
  localTimestamp,
} from "./domain/datetime";

await migrate();
await seedActivityCatalog();
const tbcaCount = Number(
  (
    await db
      .prepare(`SELECT COUNT(*)::int AS count FROM foods WHERE source = 'TBCA' AND active`)
      .get<{ count: number }>()
  )?.count ?? 0,
);
if (tbcaCount !== 5874)
  throw new Error(
    "A TBCA ainda não foi importada corretamente. Execute npm run tbca:import.",
  );

const app = express();
const port = appConfig.apiPort;
const sessionCookie = "nutri_session";
configureSecurity(app, appConfig.security.production, appConfig.appUrl);

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://192.168.1.31:3000",
      "https://nutriplusapp.store",
      "https://www.nutriplusapp.store",
      "https://pro.nutriplusapp.store",
      "https://admin.nutriplusapp.store",
    ],
    credentials: true,
  }),
);
app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use(['/api/auth/login', '/api/auth/activate', '/api/auth/activation-code/identify', '/api/auth/verify-email', '/api/auth/password-reset'], ...authenticationLimits());
app.use('/api/nutritionist', accountMailLimit());
app.use('/api/admin', accountMailLimit());

type Handler = (req: Request, res: Response) => unknown;
class InputError extends Error {}
const route =
  (handler: Handler): Handler =>
  async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!res.headersSent) {
        if (error instanceof AccountTokenError) {
          res.status(400).json({ error: error.message });
          return;
        }
        if (error instanceof InputError) {
          res.status(400).json({ error: error.message });
          return;
        }
        if (error instanceof z.ZodError) {
          const passwordIssue = error.issues.find((issue) => issue.path[0] === "password");
          res.status(400).json({
            error:
              passwordIssue?.code === "too_small"
                ? "A senha deve ter pelo menos 8 caracteres."
                : "Revise os campos informados e tente novamente.",
          });
          return;
        }
        console.error('Falha interna na API:', req.method, req.route?.path || 'rota não identificada');
        res
          .status(500)
          .json({ error: "Não foi possível concluir a solicitação. Tente novamente." });
      }
    }
  };

async function authUser(req: Request, res: Response) {
  const user = await userForSession(req.cookies?.[sessionCookie]);
  if (!user) res.status(401).json({ error: "Sua sessão terminou. Entre novamente." });
  return user;
}


function dateOnly(value: unknown, fallback = brazilDate()) {
  const parsed = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

async function currentWeight(patientId: number, onDate?: string) {
  return (
    (await db
      .prepare(
        `SELECT weight_kg, weighed_at FROM weight_history WHERE patient_id = ? ${onDate ? "AND weighed_at <= ?" : ""} ORDER BY weighed_at DESC LIMIT 1`,
      )
      .get<{ weight_kg: number; weighed_at: string }>(
        ...(onDate ? [patientId, onDate] : [patientId]),
      )) ?? null
  );
}

async function activeGoals(patientId: number, onDate: string) {
  return (
    (await db
      .prepare(
        "SELECT * FROM nutrition_goals WHERE patient_id = ? AND valid_from <= ? ORDER BY valid_from DESC LIMIT 1",
      )
      .get<Record<string, number | string | null>>(patientId, onDate)) ?? null
  );
}

type FoodSource = "TACO" | "TBCA";
type ResolvedNutrition = {
  values: NutrientMap;
  sources: Record<string, FoodSource>;
  source: FoodSource;
};
const nutrientCache = new Map<number, ResolvedNutrition>();
async function nutrientsForFood(foodId: number) {
  if (nutrientCache.has(foodId)) return nutrientCache.get(foodId)!;
  const food = await db
    .prepare(`SELECT source FROM foods WHERE id = ?`)
    .get<{ source: FoodSource }>(foodId);
  if (!food) throw new Error("Alimento não encontrado.");
  const rows = await db
    .prepare(`SELECT n.code, fn.numeric_value, fn.status
    FROM nutrients n LEFT JOIN food_nutrients fn ON fn.food_id = ? AND fn.nutrient_code = n.code
    ORDER BY n.sort_order, n.code`)
    .all<{ code: string; numeric_value: number | null; status: string | null }>(foodId);
  const values = Object.fromEntries(
    rows.map((row) => [row.code, row.status === "numeric" ? row.numeric_value : null]),
  );
  const sources = Object.fromEntries(
    rows.filter((row) => row.status === "numeric").map((row) => [row.code, food.source]),
  ) as Record<string, FoodSource>;
  const nutrition = { values, sources, source: food.source };
  nutrientCache.set(foodId, nutrition);
  return nutrition;
}

let catalogCache: Array<Record<string, unknown>> | null = null;
async function nutrientCatalog() {
  if (!catalogCache)
    catalogCache = await db
      .prepare(
        `SELECT DISTINCT n.code, n.name, n.unit, n.nutrient_group AS "nutrientGroup", n.sort_order AS "sortOrder"
         FROM nutrients n
         JOIN food_nutrients fn ON fn.nutrient_code = n.code
         JOIN foods f ON f.id = fn.food_id
         WHERE f.source = 'TBCA' AND f.active
         ORDER BY n.sort_order, n.name`,
      )
      .all();
  return catalogCache;
}

function ageOnDate(birthDate: unknown, onDate: string) {
  if (typeof birthDate !== "string") return null;
  const birth = birthDate.split("-").map(Number);
  const current = onDate.split("-").map(Number);
  if (
    birth.length !== 3 ||
    current.length !== 3 ||
    birth.some(Number.isNaN) ||
    current.some(Number.isNaN)
  )
    return null;
  let age = current[0] - birth[0];
  if (current[1] < birth[1] || (current[1] === birth[1] && current[2] < birth[2])) age--;
  return age >= 0 ? age : null;
}

async function dailySummary(patientId: number, date: string) {
  const patient = await db
    .prepare(
      `SELECT p.*, u.name, u.email FROM patients p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
    )
    .get<Record<string, any>>(patientId);
  if (!patient) throw new Error("Paciente não encontrado.");
  patient.age = ageOnDate(patient.birth_date, date);
  const log = await db
    .prepare("SELECT * FROM daily_logs WHERE patient_id = ? AND log_date = ?")
    .get<Record<string, any>>(patientId, date);
  const meals = log
    ? await db
        .prepare(
          "SELECT * FROM meals WHERE daily_log_id = ? ORDER BY COALESCE(eaten_at, created_at)",
        )
        .all<Record<string, any>>(log.id)
    : [];
  const mealPayload = [];
  for (const meal of meals) {
    const entries = await db
      .prepare(
        `SELECT me.id, me.amount, me.unit, me.measure_snapshot, me.grams_equivalent, me.consumed_at, f.id AS food_id,
          f.description, f.description AS name, COALESCE(f.display_name,f.description) AS "displayName",
          f.category, f.source, f.glycemic_index AS "glycemicIndex"
         FROM meal_entries me JOIN foods f ON f.id = me.food_id WHERE me.meal_id = ?
         ORDER BY COALESCE(me.consumed_at, me.created_at), me.id`,
      )
      .all<Record<string, any>>(meal.id);
    const resolved = await Promise.all(
      entries.map((entry) => nutrientsForFood(Number(entry.food_id))),
    );
    const scaled = entries.map((entry, index) =>
      scaleNutrients(resolved[index].values, Number(entry.grams_equivalent)),
    );
    const total = sumNutrientSets(scaled);
    const entryPayload = entries.map((entry, index) => {
      const glycemicIndex = (entry as { glycemicIndex?: number | null }).glycemicIndex;
      const nutrients = scaled[index].values;
      return {
        ...entry,
        glycemicIndex,
        nutrients,
        nutrientSources: resolved[index].sources,
        dataSources: [resolved[index].source],
        // Mantém a CG absoluta por alimento para detalhamento e auditoria.
        glycemicLoad: calculateGlycemicLoad(glycemicIndex, nutrients.carboidrato_g),
      };
    });
    const mealGlycemic = dailyGlycemicSummary(
      entryPayload.map((entry) => ({
        glycemicIndex: entry.glycemicIndex,
        carbohydrateGrams: entry.nutrients.carboidrato_g,
      })),
      total.values.energia_kcal,
    );
    mealPayload.push({
      ...meal,
      eaten_at: entries.find((entry) => entry.consumed_at)?.consumed_at ?? meal.eaten_at,
      entries: entryPayload,
      totals: total.values,
      unavailable: total.unavailable,
      // O valor `load`/`rawGL` continua absoluto; a normalização é adicional.
      glycemic: mealGlycemic,
    });
  }
  const total = sumNutrientSets(
    mealPayload.map((meal) => ({ values: meal.totals, unavailable: meal.unavailable })),
  );
  const glycemic = dailyGlycemicSummary(
    mealPayload.flatMap((meal) =>
      meal.entries.map((entry) => ({
        glycemicIndex: (entry as { glycemicIndex?: number | null }).glycemicIndex,
        carbohydrateGrams: entry.nutrients.carboidrato_g,
      })),
    ),
    total.values.energia_kcal,
  );
  const weight = await currentWeight(patientId, date);
  const storedGoals = await activeGoals(patientId, date);
  const macroGoals = macroGoalsFromEnergy(
    storedGoals?.energy_kcal == null ? null : Number(storedGoals.energy_kcal),
    {
      carbohydratePercent: Number(storedGoals?.carbohydrate_percent ?? 50),
      proteinPercent: Number(storedGoals?.protein_percent ?? 20),
      fatPercent: Number(storedGoals?.fat_percent ?? 30),
    },
  );
  const goals: Record<string, number | string | null> | null = storedGoals
    ? {
        ...storedGoals,
        protein_g: macroGoals.proteinG,
        carbohydrate_g: macroGoals.carbohydrateG,
        fat_g: macroGoals.fatG,
      }
    : null;
  return {
    date,
    patient,
    log: log ?? { log_date: date, water_ml: 0 },
    meals: mealPayload,
    totals: total.values,
    unavailable: total.unavailable,
    weight,
    goals,
    proteinPerKg: proteinPerKg(total.values.proteina_g, weight?.weight_kg),
    waterGoalMl: waterGoalMl(weight?.weight_kg),
    metrics: patientMetrics({
      weightKg: weight?.weight_kg,
      heightCm: patient.height_cm,
      age: patient.age,
      sex: patient.sex,
    }),
    energy: macroEnergy(total.values),
    glycemic,
    nutrientCatalog: await nutrientCatalog(),
  };
}

function daysBetween(from: string, to: string) {
  return inclusiveDaysBetween(from, to);
}

app.use("/api/activities", activitiesRouter({ authUser, patientAccess }));

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, foods: tbcaCount, database: databaseInfo.engine, source: "TBCA", version: appConfig.release }),
);

app.get(
  "/api/nutritionist/glycemic-index/foods",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    if (user.role !== "nutritionist" || !user.canManageNutritionData)
      return res
        .status(403)
        .json({ error: "Apenas o nutricionista responsável pela base pode editar o IG." });
    const foods = await db
      .prepare(`SELECT id, source_code, description, description AS name, COALESCE(display_name,description) AS "displayName", category, glycemic_index AS "glycemicIndex"
    FROM foods WHERE active AND source = 'TBCA' ORDER BY category, COALESCE(display_name,description)`)
      .all();
    const completed = foods.filter((food) => food.glycemicIndex != null).length;
    res.json({ foods, completed, total: foods.length });
  }),
);

app.put(
  "/api/nutritionist/glycemic-index/foods/:foodId",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    if (user.role !== "nutritionist" || !user.canManageNutritionData)
      return res
        .status(403)
        .json({ error: "Apenas o nutricionista responsável pela base pode editar o IG." });
    const foodId = z.coerce.number().int().positive().parse(req.params.foodId);
    const payload = z
      .object({ glycemicIndex: z.number().int().min(0).max(200).nullable() })
      .parse(req.body);
    const food = await db
      .prepare(`UPDATE foods SET glycemic_index = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND active AND source = 'TBCA'
    RETURNING id, source_code, description, description AS name, COALESCE(display_name,description) AS "displayName", category, glycemic_index AS "glycemicIndex"`)
      .get(payload.glycemicIndex, foodId);
    if (!food) return res.status(404).json({ error: "Alimento TBCA não encontrado." });
    res.json(food);
  }),
);

app.post(
  "/api/auth/activation-code/identify",
  route(async (req, res) => {
    const payload = z.object({
      code: z.string().trim().max(11).refine(
        (value) => /^[A-HJ-NP-Z2-9]{5}-?[A-HJ-NP-Z2-9]{5}$/i.test(value),
        "Código de convite inválido.",
      ),
    }).parse(req.body);
    const activation = await validAccountToken(normalizeActivationCode(payload.code), "activation");
    if (!activation)
      return res.status(400).json({ error: "Código inválido, expirado ou já utilizado." });
    res.json({ role: activation.role });
  }),
);

app.post(
  "/api/auth/activate",
  route(async (req, res) => {
    const payload = z
      .object({
        code: z.string().trim().max(11).refine(
          (value) => /^[A-HJ-NP-Z2-9]{5}-?[A-HJ-NP-Z2-9]{5}$/i.test(value),
          "Código de convite inválido.",
        ),
        email: z.email(),
        password: z.string().min(8).max(128),
      })
      .parse(req.body);
    const normalizedCode = normalizeActivationCode(payload.code);
    const emailInUse = await db
      .prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)")
      .get<{ id: number }>(payload.email);
    if (emailInUse) return res.status(409).json({ error: "Este e-mail já está cadastrado." });
    const verificationToken = createAccountToken();
    const passwordHash = await hashPassword(payload.password);
    const activation = await withAccountToken(normalizedCode, 'activation', async (account) => {
      await db
        .prepare(
          "UPDATE users SET email = ?, password_hash = ?, active = FALSE, email_verified_at = NULL WHERE id = ? AND role IN ('patient', 'nutritionist')",
        )
        .run(payload.email.toLowerCase(), passwordHash, account.userId);
      await saveAccountToken(account.userId, "email_verification", verificationToken, 24);
      return account;
    });
    const verificationUrl = `${appUrlForRequest(req.headers)}/?verify=${encodeURIComponent(verificationToken)}`;
    const mail = await sendMail({
      to: payload.email,
      subject: "Confirme seu acesso ao Nutri+",
      text: `Olá, ${activation.name}. Confirme seu e-mail para ativar o Nutri+: ${verificationUrl}`,
      html: accountMailHtml({
        name: activation.name,
        eyebrow: "Confirmação de e-mail",
        title: "Seu acesso ao Nutri+ está quase pronto",
        message: "Confirme seu e-mail para ativar seu acesso e começar a usar o Nutri+.",
        actionLabel: "Confirmar meu e-mail",
        actionUrl: verificationUrl,
        expiration: "Este link expira em 24 horas.",
      }),
    });
    res.json(deliveryResult(mail.delivered, verificationUrl, 'Enviamos o link de confirmação para o seu e-mail.'));
  }),
);

app.post(
  "/api/auth/verify-email",
  route(async (req, res) => {
    const payload = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    await withAccountToken(payload.token, 'email_verification', async (verification) => {
      await db
        .prepare("UPDATE users SET active = TRUE, email_verified_at = CURRENT_TIMESTAMP WHERE id = ? AND role IN ('patient', 'nutritionist') AND suspended_at IS NULL")
        .run(verification.userId);
    });
    res.json({ message: "E-mail confirmado. Seu acesso ao Nutri+ está ativo." });
  }),
);

app.post(
  "/api/auth/password-reset",
  route(async (req, res) => {
    const payload = z
      .object({ token: z.string().min(20).max(200), password: z.string().min(8).max(128) })
      .parse(req.body);
    const passwordHash = await hashPassword(payload.password);
    await withAccountToken(payload.token, 'password_reset', async (reset) => {
      await db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND active = TRUE").run(passwordHash, reset.userId);
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(reset.userId);
    });
    res.json({ message: "Senha alterada. Entre novamente com a nova senha." });
  }),
);

app.post(
  "/api/auth/login",
  route(async (req, res) => {
    const payload = z
      .object({
        email: z.email(),
        password: z.string().min(8).max(128),
      })
      .parse(req.body);
    const user = await db
      .prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND active")
      .get<{
        id: number;
        name: string;
        email: string;
        password_hash: string;
        role: "admin" | "nutritionist" | "patient";
        can_manage_nutrition_data: boolean;
      }>(payload.email);
    if (!user || !(await verifyPassword(payload.password, user.password_hash)))
      return res.status(401).json({ error: "E-mail ou senha incorretos." });
    const session = await createSession(user.id);
    res.cookie(sessionCookie, session.token, {
      ...sessionCookieOptions(appConfig.security),
      expires: session.expires,
    });
    const patient =
      user.role === "patient"
        ? await db.prepare("SELECT id FROM patients WHERE user_id = ?").get<{ id: number }>(user.id)
        : null;
    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        canManageNutritionData: Boolean(user.can_manage_nutrition_data),
      },
      patientId: patient?.id ?? null,
    });
  }),
);

app.post(
  "/api/auth/logout",
  route(async (req, res) => {
    await deleteSession(req.cookies?.[sessionCookie]);
    res.clearCookie(sessionCookie, sessionCookieOptions(appConfig.security));
    res.status(204).end();
  }),
);
app.get(
  "/api/auth/me",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient =
      user.role === "patient"
        ? await db.prepare("SELECT id FROM patients WHERE user_id = ?").get<{ id: number }>(user.id)
        : null;
    res.json({ user, patientId: patient?.id ?? null });
  }),
);

app.get(
  "/api/admin/nutritionists",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "admin") return res.status(403).json({ error: "Área exclusiva da administração." });
    res.json(await db.prepare(`SELECT u.id, u.name, u.email, np.crn, np.state, np.phone, u.created_at AS "createdAt",
      CASE WHEN u.suspended_at IS NOT NULL THEN 'suspended' WHEN u.active AND u.email_verified_at IS NOT NULL THEN 'active'
        WHEN u.email IS NOT NULL THEN 'pending_verification' ELSE 'pending_activation' END AS "accessStatus"
      FROM users u LEFT JOIN nutritionist_profiles np ON np.user_id = u.id
      WHERE u.role = 'nutritionist' ORDER BY u.name`).all());
  }),
);

app.post(
  "/api/admin/nutritionists",
  route(async (req, res) => {
    const admin = await authUser(req, res);
    if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Área exclusiva da administração." });
    const payload = z.object({
      name: z.string().trim().min(2).max(100), crn: z.string().trim().min(3).max(30),
      state: z.string().trim().length(2).transform((value) => value.toUpperCase()), phone: z.string().trim().max(30).optional(),
    }).parse(req.body);
    const existingCrn = await db.prepare("SELECT user_id FROM nutritionist_profiles WHERE UPPER(crn) = UPPER(?)").get(payload.crn);
    if (existingCrn) return res.status(409).json({ error: "Este CRN já está cadastrado." });
    const activationCode = createActivationCode();
    const account = await transaction(async () => {
      const created = await db.prepare("INSERT INTO users (name, role, active) VALUES (?, 'nutritionist', FALSE) RETURNING id").get<{ id: number }>(payload.name);
      await db.prepare("INSERT INTO nutritionist_profiles (user_id, crn, state, phone) VALUES (?, ?, ?, ?)").run(created!.id, payload.crn.toUpperCase(), payload.state, payload.phone || null);
      await saveAccountToken(created!.id, "activation", normalizeActivationCode(activationCode), 24 * 7, admin.id);
      return created!;
    });
    res.status(201).json({ id: account.id, activationCode });
  }),
);

app.post(
  "/api/admin/nutritionists/:nutritionistId/access",
  route(async (req, res) => {
    const admin = await authUser(req, res);
    if (!admin || admin.role !== "admin") return res.status(403).json({ error: "Área exclusiva da administração." });
    const nutritionistId = z.coerce.number().int().positive().parse(req.params.nutritionistId);
    const { action } = z.object({ action: z.enum(["activation", "verification", "password_reset", "suspend", "reactivate"]) }).parse(req.body);
    const account = await db.prepare("SELECT id, name, email, active, email_verified_at, suspended_at FROM users WHERE id = ? AND role = 'nutritionist'").get<{ id: number; name: string; email: string | null; active: boolean; email_verified_at: string | null; suspended_at: string | null }>(nutritionistId);
    if (!account) return res.status(404).json({ error: "Nutricionista não encontrado." });
    if (action === "suspend") {
      await transaction(async () => {
        await db.prepare("UPDATE users SET active = FALSE, suspended_at = CURRENT_TIMESTAMP WHERE id = ?").run(account.id);
        await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(account.id);
      });
      return res.json({ message: "Acesso do nutricionista suspenso." });
    }
    if (action === "reactivate") {
      await db.prepare("UPDATE users SET suspended_at = NULL, active = (email_verified_at IS NOT NULL) WHERE id = ?").run(account.id);
      return res.json({ message: "Conta liberada novamente." });
    }
    if (action === "activation") {
      if (account.email) return res.status(409).json({ error: "Este nutricionista já iniciou a ativação." });
      const activationCode = createActivationCode();
      await saveAccountToken(account.id, "activation", normalizeActivationCode(activationCode), 24 * 7, admin.id);
      return res.json({ activationCode });
    }
    if (!account.email) return res.status(409).json({ error: "O nutricionista ainda não cadastrou um e-mail." });
    const purpose = action === "verification" ? "email_verification" : "password_reset";
    if (purpose === "email_verification" && account.email_verified_at) return res.status(409).json({ error: "O e-mail já foi confirmado." });
    if (purpose === "password_reset" && (!account.active || !account.email_verified_at)) return res.status(409).json({ error: "A conta ainda não está ativa e confirmada." });
    const token = createAccountToken();
    await saveAccountToken(account.id, purpose, token, purpose === "email_verification" ? 24 : 1, admin.id);
    const query = purpose === "email_verification" ? "verify" : "reset";
    const url = `${appUrlForRequest(req.headers)}/?${query}=${encodeURIComponent(token)}`;
    const isVerification = purpose === "email_verification";
    const mail = await sendMail({
      to: account.email, subject: isVerification ? "Confirme seu acesso profissional ao Nutri+" : "Restaure sua senha profissional do Nutri+",
      text: `Olá, ${account.name}. ${isVerification ? "Confirme seu e-mail" : "Defina uma nova senha"}: ${url}`,
      html: accountMailHtml({
        name: account.name,
        eyebrow: isVerification ? "Confirmação de e-mail" : "Segurança da conta",
        title: isVerification ? "Seu acesso profissional está quase pronto" : "Crie uma nova senha",
        message: isVerification
          ? "Confirme seu e-mail para ativar seu acesso profissional ao Nutri+."
          : "A administração solicitou a restauração da senha da sua conta.",
        actionLabel: isVerification ? "Confirmar meu e-mail" : "Definir nova senha",
        actionUrl: url,
        expiration: isVerification
          ? "Este link expira em 24 horas."
          : "Este link expira em 1 hora e só pode ser usado uma vez.",
      }),
    });
    res.json(deliveryResult(mail.delivered, url, `E-mail enviado para ${account.email}.`));
  }),
);

app.post(
  "/api/nutritionist/self-diary",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    if (user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    await db
      .prepare(`INSERT INTO patients (user_id, nutritionist_user_id)
        VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING`)
      .run(user.id, user.id);
    const diary = await db
      .prepare("SELECT id FROM patients WHERE user_id = ? AND nutritionist_user_id = ?")
      .get<{ id: number }>(user.id, user.id);
    if (!diary) return res.status(409).json({ error: "Não foi possível preparar seu diário pessoal." });
    res.status(201).json({ patientId: Number(diary.id) });
  }),
);

app.get(
  "/api/patient/today",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(
      user,
      req.query.patientId ? Number(req.query.patientId) : undefined,
    );
    if (!patient) return res.status(403).json({ error: "Você não tem acesso a este paciente." });
    res.json(await dailySummary(Number(patient.id), dateOnly(req.query.date)));
  }),
);

app.get(
  "/api/patient/history",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(
      user,
      req.query.patientId ? Number(req.query.patientId) : undefined,
    );
    if (!patient) return res.status(403).json({ error: "Você não tem acesso a este paciente." });
    const to = dateOnly(req.query.to);
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const from = dateOnly(req.query.from, addCalendarDays(to, -(days - 1)));
    const logs = await db
      .prepare(
        "SELECT log_date FROM daily_logs WHERE patient_id = ? AND log_date BETWEEN ? AND ? ORDER BY log_date",
      )
      .all<{ log_date: string }>(patient.id, from, to);
    const summaries = await Promise.all(
      logs.map((log) => dailySummary(Number(patient.id), log.log_date)),
    );
    const glycemic = periodGlycemicSummary(summaries.map((summary) => summary.glycemic));
    const weights = await db
      .prepare(
        "SELECT weighed_at, weight_kg FROM weight_history WHERE patient_id = ? AND weighed_at BETWEEN ? AND ? ORDER BY weighed_at",
      )
      .all(patient.id, from, to);
    res.json({
      from,
      to,
      totalDays: daysBetween(from, to),
      registeredDays: summaries.filter((day) => day.meals.length > 0).length,
      days: summaries,
      weights,
      glycemic,
    });
  }),
);

app.get(
  "/api/foods",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const search = normalizeSearch(typeof req.query.search === "string" ? req.query.search : "");
    const favoritesOnly = req.query.favorites === "true";
    const patient = await patientAccess(user);
    let foods: Array<Record<string, any>>;
    if (favoritesOnly) {
      const tokens = search ? foodSearchTokenVariants(search).slice(0, 5) : [];
      const where = tokens.length
        ? `AND ${tokens.map((variants) => `(${variants.map(()=>"f.normalized_search_text LIKE ?").join(' OR ')})`).join(" AND ")}`
        : "";
      foods = await db
        .prepare(`SELECT f.id, f.source_code, f.description, f.description AS name, COALESCE(f.display_name,f.description) AS "displayName", f.category, f.scientific_name, f.brand, f.source, f.glycemic_index AS "glycemicIndex"
      FROM favorites fav JOIN foods f ON f.id = fav.food_id
      WHERE fav.user_id = ? AND f.active AND f.source = 'TBCA' ${where}
      ORDER BY COALESCE(f.display_name,f.description) LIMIT 100`)
        .all(user.id, ...tokens.flatMap((variants) => variants.map(token=>`%${token}%`)));
    } else if (search) {
      const tokens = foodSearchTokenVariants(search).slice(0, 5);
      const canonicalSearch=normalizeFoodQuery(search);
      const where = tokens.map((variants) => `(${variants.map(()=>"normalized_search_text LIKE ?").join(' OR ')})`).join(" AND ");
      foods = await db
        .prepare(
          `SELECT id, source_code, description, description AS name, COALESCE(display_name,description) AS "displayName", category, scientific_name, brand, source, glycemic_index AS "glycemicIndex"
           FROM foods WHERE active AND source = 'TBCA' AND ${where}
           ORDER BY CASE
             WHEN normalized_display_name = ? THEN 0
             WHEN normalized_display_name LIKE ? THEN 1
             WHEN ? = ANY(normalized_search_aliases) THEN 2
             WHEN EXISTS(SELECT 1 FROM unnest(normalized_search_aliases) alias WHERE alias LIKE ?) THEN 3
             WHEN normalized_display_name LIKE ? THEN 4
             WHEN EXISTS(SELECT 1 FROM unnest(normalized_search_aliases) alias WHERE alias LIKE ?) THEN 5
             WHEN normalized_name = ? THEN 6
             WHEN normalized_name LIKE ? THEN 7
             ELSE 8 END,
             CASE WHEN normalized_display_name LIKE ? THEN 0 ELSE 1 END,
             source_code,
             GREATEST(similarity(normalized_display_name, ?),similarity(normalized_name, ?)) DESC,
             COALESCE(display_name,description)
           LIMIT 25`,
        )
        .all(...tokens.flatMap((variants)=>variants.map(token=>`%${token}%`)), canonicalSearch, `${canonicalSearch}%`, canonicalSearch, `${canonicalSearch}%`, `%${canonicalSearch}%`, `%${canonicalSearch}%`, canonicalSearch, `${canonicalSearch}%`, `%${canonicalSearch}%`, canonicalSearch, canonicalSearch);
    } else if (patient) {
      foods = await db
        .prepare(`SELECT f.id, f.source_code, f.description, f.description AS name, COALESCE(f.display_name,f.description) AS "displayName", f.category, f.scientific_name, f.brand, f.source, f.glycemic_index AS "glycemicIndex", MAX(me.created_at) AS last_used
      FROM meal_entries me JOIN foods f ON f.id = me.food_id JOIN meals m ON m.id = me.meal_id JOIN daily_logs dl ON dl.id = m.daily_log_id
      WHERE dl.patient_id = ? AND f.active AND f.source = 'TBCA' GROUP BY f.id ORDER BY last_used DESC LIMIT 12`)
        .all(patient.id);
      if (!foods.length) {
        foods = await db
          .prepare(
            `SELECT id, source_code, description, description AS name, COALESCE(display_name,description) AS "displayName", category, scientific_name, brand, source, glycemic_index AS "glycemicIndex" FROM foods WHERE active AND source = 'TBCA' ORDER BY COALESCE(display_name,description) LIMIT 20`,
          )
          .all();
      }
    } else {
      foods = await db
        .prepare(
          `SELECT id, source_code, description, description AS name, COALESCE(display_name,description) AS "displayName", category, scientific_name, brand, source, glycemic_index AS "glycemicIndex" FROM foods WHERE active AND source = 'TBCA' ORDER BY COALESCE(display_name,description) LIMIT 20`,
        )
        .all();
    }
    const favoriteIds = new Set(
      (
        await db
          .prepare("SELECT food_id FROM favorites WHERE user_id = ?")
          .all<{ food_id: number }>(user.id)
      ).map((row) => Number(row.food_id)),
    );
    const measures = await measuresForFoods(foods.map(food => Number(food.id)));
    const payload = await Promise.all(
      foods.map(async (food) => {
        const nutrition = await nutrientsForFood(Number(food.id));
        return {
          ...food,
          measures: measures.get(Number(food.id)),
          favorite: favoriteIds.has(Number(food.id)),
          nutrients: nutrition.values,
          nutrientSources: nutrition.sources,
          dataSources: [nutrition.source],
        };
      }),
    );
    res.json(payload);
  }),
);

app.get('/api/foods/:foodId/measures', route(async (req, res) => {
  if (!await authUser(req,res)) return;
  const id = z.coerce.number().int().positive().parse(req.params.foodId);
  if (!await db.prepare('SELECT id FROM foods WHERE id=?').get(id)) return res.status(404).json({error:'Alimento não encontrado.'});
  res.json((await measuresForFoods([id])).get(id));
}));

app.post('/api/foods/recognize',
  async (req, res, next) => {
    try {
      const user = await authUser(req, res);
      if (!user) return;
      const patient=await patientAccess(user);
      if (!patient) return res.status(403).json({ error: 'Ação não permitida.' });
      res.locals.photoUser = user.id;
      res.locals.photoPatient = patient.id;
      next();
    } catch (error) { next(error); }
  },
  rateLimit({ windowMs: 60_000, limit: 5, keyGenerator: (_req, res) => String(res.locals.photoUser), message: { error: 'Aguarde um minuto para analisar outra foto.' } }),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
  route(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Escolha uma foto JPEG, PNG ou WebP de até 5 MB.' });
    let vision;
    try { vision = await recognizePhoto(req.body); }
    catch { return res.status(503).json({ error: 'Não foi possível analisar esta foto agora. Tente outra imagem ou use a busca manual.' }); }
    const detected=deduplicateDetections(vision.detection.items);
    const candidateSets=await Promise.all(detected.map(item=>tbcaCandidatesForDetection(item)));
    const favoriteIds=new Set((await db.prepare('SELECT food_id FROM favorites WHERE user_id=?').all<{food_id:number}>(res.locals.photoUser)).map(row=>Number(row.food_id)));
    const recentIds=new Set((await db.prepare(`SELECT me.food_id FROM meal_entries me JOIN meals m ON m.id=me.meal_id JOIN daily_logs dl ON dl.id=m.daily_log_id WHERE dl.patient_id=? GROUP BY me.food_id ORDER BY MAX(me.created_at) DESC LIMIT 30`).all<{food_id:number}>(res.locals.photoPatient)).map(row=>Number(row.food_id)));
    let rerankLatency=0,inputTokens=vision.telemetry.inputTokens??0,outputTokens=vision.telemetry.outputTokens??0,reasoningTokens=vision.telemetry.reasoningTokens??0,totalTokens=vision.telemetry.totalTokens??0;
    const decisions=[] as Array<{itemToken:string;name:string;preparation:string|null;clarificationKind:'MEAT_TYPE'|null;visualConfidence:number;state:MatchState;selectedFoodId:number|null;top1Score:number;top2Score:number;margin:number;resolutionPolicy:string|null;abstentionReason:string|null;candidates:any[]}>;
    for(const [itemIndex,item] of detected.entries()){
      const foods=candidateSets[itemIndex];
      const matches=rankSemanticFoodCandidates(item,foods,MATCH_THRESHOLDS.RERANK_MAX_CANDIDATES);
      const initial=decideMatch(item,matches);
      const nearby=matches[0]?matches.filter(match=>matches[0].matchConfidence-match.matchConfidence<=.10):[];
      const plausible=nearby.length>=2?nearby:matches.slice(0,2);
      let state:MatchState=initial.state;
      let selectedFoodId:number|null=state==='AUTOSELECT'?matches[0].food.id:null;
      let resolutionPolicy=state==='AUTOSELECT'?initial.policy:null;
      let abstentionReason=state==='NO_EXACT_TBCA_MATCH'?(matches[0]?.materialUnknowns?.join(',')||'unresolved_variant'):null;
      const meatConfirmation=needsMeatConfirmation(item);
      if(meatConfirmation){state='ASK_IDENTITY';selectedFoodId=null;resolutionPolicy=null;abstentionReason='meat_cut_not_visually_defensible'}
      else if(state==='RERANK'&&appConfig.vision.rerankEnabled){
        try{const reranked=await rerankPhoto(vision.image,item,plausible.map(match=>match.food.displayName));rerankLatency+=reranked.telemetry.latencyMs;inputTokens+=reranked.telemetry.inputTokens??0;outputTokens+=reranked.telemetry.outputTokens??0;reasoningTokens+=reranked.telemetry.reasoningTokens??0;totalTokens+=reranked.telemetry.totalTokens??0;
          if(!reranked.decision.uncertain&&reranked.decision.candidateIndex!=null&&reranked.decision.confidence>=MATCH_THRESHOLDS.RERANK_MIN_CONFIDENCE){selectedFoodId=plausible[reranked.decision.candidateIndex].food.id;state='RERANK'}else{state='ASK_ATTRIBUTE';abstentionReason='visual_attribute_uncertain'}
        }catch{state='ASK_ATTRIBUTE';abstentionReason='reranker_unavailable'}
      }else if(state==='RERANK'){
        state='ASK_ATTRIBUTE';
        abstentionReason='fast_mode_user_confirmation';
      }
      const needsChoice=['ASK_IDENTITY','ASK_ATTRIBUTE','NO_EXACT_TBCA_MATCH'].includes(state);
      const preferred=(meatConfirmation?[...matches].sort((left,right)=>{
        const preference=(food:any)=>(favoriteIds.has(Number(food.id))?2:0)+(recentIds.has(Number(food.id))?1:0);
        return preference(right.food)-preference(left.food)||right.matchConfidence-left.matchConfidence;
      }):plausible);
      const visible=needsChoice?preferred.slice(0,meatConfirmation?5:MATCH_THRESHOLDS.ASK_USER_MAX_CANDIDATES):state==='NO_MATCH'?[]:matches.filter(match=>match.food.id===selectedFoodId).slice(0,1);
      const candidates=await Promise.all(visible.map(async match=>{const food=match.food,nutrition=await nutrientsForFood(Number(food.id));return{...food,nutrients:nutrition.values,nutrientSources:nutrition.sources,dataSources:[nutrition.source],favorite:false}}));
      decisions.push({itemToken:randomUUID(),name:item.name,preparation:item.preparation,clarificationKind:meatConfirmation?'MEAT_TYPE':null,visualConfidence:item.confidence,state,selectedFoodId,top1Score:initial.top1Score,top2Score:initial.top2Score,margin:initial.margin,resolutionPolicy,abstentionReason,candidates});
    }
    const analysisToken=randomUUID();
    await transaction(async()=>{const counts=(state:string)=>decisions.filter(item=>item.state===state).length,askCount=counts('ASK_IDENTITY')+counts('ASK_ATTRIBUTE');const analysis=await db.prepare(`INSERT INTO food_vision_analyses(analysis_token,model,reasoning_effort,first_latency_ms,rerank_latency_ms,input_tokens,output_tokens,reasoning_tokens,total_tokens,detected_count,autoselect_count,rerank_count,ask_user_count,no_match_count,ask_identity_count,ask_attribute_count,no_exact_match_count)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).get<{id:number}>(analysisToken,vision.telemetry.model,vision.telemetry.reasoningEffort,vision.telemetry.latencyMs,rerankLatency,inputTokens||null,outputTokens||null,reasoningTokens||null,totalTokens||null,detected.length,counts('AUTOSELECT'),counts('RERANK'),askCount,counts('NO_MATCH'),counts('ASK_IDENTITY'),counts('ASK_ATTRIBUTE'),counts('NO_EXACT_TBCA_MATCH'));
      for(const item of decisions)await db.prepare(`INSERT INTO food_vision_predictions(analysis_id,item_token,decision_state,predicted_food_id,top1_score,top2_score,margin,visual_confidence,resolution_policy,abstention_reason) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(analysis!.id,item.itemToken,item.state,item.selectedFoodId,item.top1Score,item.top2Score,item.margin,item.visualConfidence,item.resolutionPolicy,item.abstentionReason);
    });
    console.info(`[food-vision] model=${vision.telemetry.model}; effort=${vision.telemetry.reasoningEffort}; detected=${detected.length}; auto=${decisions.filter(i=>i.state==='AUTOSELECT').length}; rerank=${decisions.filter(i=>i.state==='RERANK').length}; ask=${decisions.filter(i=>['ASK_IDENTITY','ASK_ATTRIBUTE'].includes(i.state)).length}; no_exact=${decisions.filter(i=>i.state==='NO_EXACT_TBCA_MATCH').length}; no_match=${decisions.filter(i=>i.state==='NO_MATCH').length}; latency_ms=${vision.telemetry.latencyMs+rerankLatency}`);
    res.json({analysisToken,items:decisions.map(({selectedFoodId,...item})=>item)});
  }),
);

app.post('/api/foods/recognize/feedback',route(async(req,res)=>{const user=await authUser(req,res);if(!user)return;if(!await patientAccess(user))return res.status(403).json({error:'Ação não permitida.'});const payload=z.object({analysisToken:z.string().uuid(),items:z.array(z.object({itemToken:z.string().uuid(),selectedFoodId:z.number().int().positive()})).max(20)}).parse(req.body);
  await transaction(async()=>{for(const item of payload.items){const selected=await db.prepare(`SELECT id FROM foods WHERE id=? AND source='TBCA' AND active`).get(item.selectedFoodId);if(!selected)throw new InputError('Alimento selecionado inválido.');await db.prepare(`UPDATE food_vision_predictions p SET final_food_id=?,changed=(predicted_food_id IS DISTINCT FROM ?) FROM food_vision_analyses a WHERE p.analysis_id=a.id AND a.analysis_token=? AND p.item_token=?`).run(item.selectedFoodId,item.selectedFoodId,payload.analysisToken,item.itemToken)}});res.json({ok:true});}));

app.get(
  "/api/patient/orientations",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(user);
    if (!patient) return res.status(403).json({ error: "Área exclusiva do diário pessoal." });
    const notes = await db
      .prepare(
        `SELECT pn.id, pn.content, pn.created_at, pn.patient_read_at, u.name AS author_name FROM patient_notes pn JOIN users u ON u.id = pn.author_user_id WHERE pn.patient_id = ? AND pn.visibility = 'patient' ORDER BY pn.created_at DESC`,
      )
      .all<Record<string, unknown>>(patient!.id);
    res.json({
      items: notes,
      unreadCount: notes.filter((note) => note.patient_read_at == null).length,
    });
  }),
);

app.post(
  "/api/patient/orientations/read",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(user);
    if (!patient) return res.status(403).json({ error: "Área exclusiva do diário pessoal." });
    await db
      .prepare(
        `UPDATE patient_notes SET patient_read_at = CURRENT_TIMESTAMP WHERE patient_id = ? AND visibility = 'patient' AND patient_read_at IS NULL`,
      )
      .run(patient!.id);
    res.status(204).end();
  }),
);

app.post(
  "/api/favorites/:foodId",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const foodId = Number(req.params.foodId);
    const existing = await db
      .prepare("SELECT 1 FROM favorites WHERE user_id = ? AND food_id = ?")
      .get(user.id, foodId);
    if (existing)
      await db
        .prepare("DELETE FROM favorites WHERE user_id = ? AND food_id = ?")
        .run(user.id, foodId);
    else
      await db
        .prepare("INSERT INTO favorites (user_id, food_id) VALUES (?, ?)")
        .run(user.id, foodId);
    res.json({ favorite: !existing });
  }),
);

const mealTypes = [
  "breakfast",
  "morning_snack",
  "lunch",
  "afternoon_snack",
  "dinner",
  "supper",
  "other",
] as const;
type MealType = (typeof mealTypes)[number];
const mealLabels: Record<MealType, string> = {
  breakfast: "Café da manhã",
  morning_snack: "Lanche da manhã",
  lunch: "Almoço",
  afternoon_snack: "Lanche da tarde",
  dinner: "Jantar",
  supper: "Ceia",
  other: "Outra refeição",
};

async function getOrCreateMeal(logId: number, mealType: MealType, consumedAt: string) {
  let meal = await db
    .prepare("SELECT id FROM meals WHERE daily_log_id = ? AND meal_type = ? ORDER BY id LIMIT 1")
    .get<{ id: number }>(logId, mealType);
  if (!meal)
    meal = await db
      .prepare(
        "INSERT INTO meals (daily_log_id, meal_type, label, eaten_at) VALUES (?, ?, ?, ?) RETURNING id",
      )
      .get<{ id: number }>(logId, mealType, mealLabels[mealType], consumedAt);
  return meal!;
}

async function refreshMealTime(mealId: number) {
  await db
    .prepare(
      `UPDATE meals SET eaten_at = COALESCE((SELECT MIN(consumed_at) FROM meal_entries WHERE meal_id = ?), eaten_at) WHERE id = ?`,
    )
    .run(mealId, mealId);
}

app.post(
  "/api/meals",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(user);
    if (!patient) return res.status(403).json({ error: "Ação não permitida." });
    const payload = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        mealType: z.enum(mealTypes),
        foodId: z.number().int().positive().optional(),
        grams: z.number().positive().max(5000).optional(),
        items: z.array(quantityInput.safeExtend({ foodId: z.number().int().positive() })).min(1).max(20).optional(),
      })
      .refine(value => value.items ? value.foodId == null && value.grams == null : value.foodId != null && value.grams != null)
      .parse(req.body);
    const entries = payload.items || [{ foodId: payload.foodId!, grams: payload.grams! }];
    const consumedAt = localTimestamp(payload.date, brazilTime());
    await transaction(async () => {
      for (const entry of entries) {
        const allowed = await db.prepare("SELECT id FROM foods WHERE id = ? AND source = 'TBCA' AND active FOR SHARE").get(entry.foodId);
        if (!allowed) throw new InputError('Selecione um alimento ativo da TBCA.');
      }
      await db
        .prepare(
          "INSERT INTO daily_logs (patient_id, log_date) VALUES (?, ?) ON CONFLICT(patient_id, log_date) DO NOTHING",
        )
        .run(patient!.id, payload.date);
      const log = await db
        .prepare("SELECT id FROM daily_logs WHERE patient_id = ? AND log_date = ?")
        .get<{ id: number }>(patient!.id, payload.date);
      const meal = await getOrCreateMeal(log!.id, payload.mealType, consumedAt);
      for (const entry of entries) {
        const converted = await resolveQuantity(entry.foodId, entry).catch(error => { throw new InputError(error.message); });
        await db
        .prepare(
          "INSERT INTO meal_entries (meal_id, food_id, amount, unit, grams_equivalent, consumed_at, measure_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)",
        )
        .run(meal.id, entry.foodId, converted.amount, converted.unit, converted.grams, consumedAt, JSON.stringify(converted.snapshot));
      }
      await refreshMealTime(meal.id);
    });
    res.status(201).json(await dailySummary(Number(patient!.id), payload.date));
  }),
);

app.delete(
  "/api/meal-entries/:entryId",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(user);
    if (!patient) return res.status(403).json({ error: "Ação não permitida." });
    const entryId = Number(req.params.entryId);
    const owned = await db
      .prepare(
        `SELECT me.id, me.meal_id FROM meal_entries me JOIN meals m ON m.id = me.meal_id JOIN daily_logs dl ON dl.id = m.daily_log_id WHERE me.id = ? AND dl.patient_id = ?`,
      )
      .get<{ id: number; meal_id: number }>(entryId, patient!.id);
    if (!owned) return res.status(404).json({ error: "Registro não encontrado." });
    await transaction(async () => {
      await db.prepare("DELETE FROM meal_entries WHERE id = ?").run(entryId);
      const remaining = await db
        .prepare("SELECT COUNT(*)::int AS count FROM meal_entries WHERE meal_id = ?")
        .get<{ count: number }>(owned.meal_id);
      if (!remaining?.count) await db.prepare("DELETE FROM meals WHERE id = ?").run(owned.meal_id);
      else await refreshMealTime(owned.meal_id);
    });
    res.status(204).end();
  }),
);

app.patch(
  "/api/meal-entries/:entryId",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(user);
    if (!patient) return res.status(403).json({ error: "Ação não permitida." });
    const entryId = Number(req.params.entryId);
    const payload = z
      .object({
        grams: z.number().positive().max(5000).optional(),
        quantity: z.number().positive().optional(),
        measureId: z.number().int().nonnegative().optional(),
        mealType: z.enum(mealTypes).optional(),
      })
      .refine((value) => Object.keys(value).length > 0, "Informe ao menos uma alteração.")
      .parse(req.body);
    const owned = await db
      .prepare(
        `SELECT me.id, me.meal_id, me.food_id, me.amount, me.unit, me.measure_snapshot, me.grams_equivalent, me.consumed_at, m.meal_type, m.daily_log_id, dl.log_date FROM meal_entries me JOIN meals m ON m.id = me.meal_id JOIN daily_logs dl ON dl.id = m.daily_log_id WHERE me.id = ? AND dl.patient_id = ?`,
      )
      .get<Record<string, any>>(entryId, patient!.id);
    if (!owned) return res.status(404).json({ error: "Registro não encontrado." });
    await transaction(async () => {
      const previousMealId = Number(owned.meal_id);
      const nextMealType = (payload.mealType ?? owned.meal_type) as MealType;
      const currentTime =
        typeof owned.consumed_at === "string" ? owned.consumed_at.slice(11, 16) : brazilTime();
      const consumedAt = localTimestamp(owned.log_date, currentTime);
      const targetMeal = await getOrCreateMeal(
        Number(owned.daily_log_id),
        nextMealType,
        consumedAt,
      );
      const converted = payload.grams != null || payload.quantity != null || payload.measureId != null
        ? await resolveQuantity(Number(owned.food_id), payload, owned.measure_snapshot).catch(error => { throw new InputError(error.message); })
        : {amount:owned.amount,unit:owned.unit,grams:owned.grams_equivalent,snapshot:owned.measure_snapshot};
      await db
        .prepare(
          "UPDATE meal_entries SET meal_id = ?, amount = ?, unit = ?, grams_equivalent = ?, consumed_at = ?, measure_snapshot = ?::jsonb WHERE id = ?",
        )
        .run(targetMeal.id, converted.amount, converted.unit, converted.grams, consumedAt, JSON.stringify(converted.snapshot), entryId);
      await refreshMealTime(targetMeal.id);
      if (targetMeal.id !== previousMealId) {
        const remaining = await db
          .prepare("SELECT COUNT(*)::int AS count FROM meal_entries WHERE meal_id = ?")
          .get<{ count: number }>(previousMealId);
        if (!remaining?.count)
          await db.prepare("DELETE FROM meals WHERE id = ?").run(previousMealId);
        else await refreshMealTime(previousMealId);
      }
    });
    res.json(await dailySummary(Number(patient!.id), owned.log_date));
  }),
);

app.post(
  "/api/meals/:mealId/copy",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(user);
    if (!patient) return res.status(403).json({ error: "Ação não permitida." });
    const payload = z
      .object({ targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(req.body);
    const source = await db
      .prepare(
        `SELECT m.* FROM meals m JOIN daily_logs dl ON dl.id = m.daily_log_id WHERE m.id = ? AND dl.patient_id = ?`,
      )
      .get<Record<string, any>>(Number(req.params.mealId), patient!.id);
    if (!source) return res.status(404).json({ error: "Refeição não encontrada." });
    await transaction(async () => {
      await db
        .prepare(
          "INSERT INTO daily_logs (patient_id, log_date) VALUES (?, ?) ON CONFLICT(patient_id, log_date) DO NOTHING",
        )
        .run(patient!.id, payload.targetDate);
      const targetLog = await db
        .prepare("SELECT id FROM daily_logs WHERE patient_id = ? AND log_date = ?")
        .get<{ id: number }>(patient!.id, payload.targetDate);
      const fallbackTime =
        typeof source.eaten_at === "string" ? source.eaten_at.slice(11, 16) : "12:00";
      const targetMeal = await getOrCreateMeal(
        targetLog!.id,
        source.meal_type as MealType,
        localTimestamp(payload.targetDate, fallbackTime),
      );
      const entries = await db
        .prepare(
          "SELECT food_id, amount, unit, grams_equivalent, consumed_at, measure_snapshot FROM meal_entries WHERE meal_id = ?",
        )
        .all<Record<string, any>>(source.id);
      for (const entry of entries) {
        const time =
          typeof entry.consumed_at === "string" ? entry.consumed_at.slice(11, 16) : fallbackTime;
        await db
          .prepare(
            "INSERT INTO meal_entries (meal_id, food_id, amount, unit, grams_equivalent, consumed_at, measure_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb)",
          )
          .run(
            targetMeal.id,
            entry.food_id,
            entry.amount,
            entry.unit,
            entry.grams_equivalent,
            localTimestamp(payload.targetDate, time),
            JSON.stringify(entry.measure_snapshot),
          );
      }
      await refreshMealTime(targetMeal.id);
    });
    res.status(201).json(await dailySummary(Number(patient!.id), payload.targetDate));
  }),
);

app.patch(
  "/api/daily-log",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(user);
    if (!patient) return res.status(403).json({ error: "Ação não permitida." });
    const payload = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        waterMl: z.number().min(0).max(15000).optional(),
        hunger: z.number().int().min(1).max(5).nullable().optional(),
        satiety: z.number().int().min(1).max(5).nullable().optional(),
        energy: z.number().int().min(1).max(5).nullable().optional(),
        training: z.string().max(120).nullable().optional(),
        note: z.string().max(600).nullable().optional(),
      })
      .parse(req.body);
    await db
      .prepare(
        "INSERT INTO daily_logs (patient_id, log_date) VALUES (?, ?) ON CONFLICT(patient_id, log_date) DO NOTHING",
      )
      .run(patient!.id, payload.date);
    const current = await db
      .prepare("SELECT * FROM daily_logs WHERE patient_id = ? AND log_date = ?")
      .get<Record<string, any>>(patient!.id, payload.date);
    await db
      .prepare(
        "UPDATE daily_logs SET water_ml = ?, hunger = ?, satiety = ?, energy = ?, training = ?, note = ? WHERE id = ?",
      )
      .run(
        payload.waterMl ?? current!.water_ml,
        payload.hunger ?? current!.hunger,
        payload.satiety ?? current!.satiety,
        payload.energy ?? current!.energy,
        payload.training ?? current!.training,
        payload.note ?? current!.note,
        current!.id,
      );
    res.json(await dailySummary(Number(patient!.id), payload.date));
  }),
);

app.post(
  "/api/weights",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user) return;
    const patient = await patientAccess(
      user,
      req.body.patientId ? Number(req.body.patientId) : undefined,
    );
    if (!patient) return res.status(403).json({ error: "Ação não permitida." });
    const payload = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        weightKg: z.number().positive().max(500),
        note: z.string().max(200).optional(),
      })
      .parse(req.body);
    await db
      .prepare(
        `INSERT INTO weight_history (patient_id, weighed_at, weight_kg, recorded_by, note) VALUES (?, ?, ?, ?, ?) ON CONFLICT(patient_id, weighed_at) DO UPDATE SET weight_kg = excluded.weight_kg, recorded_by = excluded.recorded_by, note = excluded.note`,
      )
      .run(patient.id, payload.date, payload.weightKg, user.id, payload.note ?? null);
    res.status(201).json(await currentWeight(Number(patient.id)));
  }),
);

app.get(
  "/api/nutritionist/patients",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const patients = await db
      .prepare(
        `SELECT p.id, u.name, u.email, u.active, u.email_verified_at, p.objective, p.height_cm,
          CASE
            WHEN u.active AND u.email_verified_at IS NOT NULL THEN 'active'
            WHEN u.email IS NOT NULL THEN 'pending_verification'
            ELSE 'pending_activation'
          END AS "accessStatus",
          (SELECT weight_kg FROM weight_history w WHERE w.patient_id = p.id ORDER BY weighed_at DESC LIMIT 1) AS weight_kg,
          (SELECT weighed_at FROM weight_history w WHERE w.patient_id = p.id ORDER BY weighed_at DESC LIMIT 1) AS weight_date,
          (SELECT MAX(log_date) FROM daily_logs dl WHERE dl.patient_id = p.id) AS last_log_date
        FROM patients p JOIN users u ON u.id = p.user_id
        WHERE p.nutritionist_user_id = ? AND p.user_id <> p.nutritionist_user_id ORDER BY u.name`,
      )
      .all<Record<string, any>>(user.id);
    res.json(
      await Promise.all(
        patients.map(async (patient) => ({
          ...patient,
          today: await dailySummary(Number(patient.id), dateOnly(patient.last_log_date)),
        })),
      ),
    );
  }),
);

app.post(
  "/api/nutritionist/patients",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const payload = z
      .object({
        name: z.string().min(2).max(100),
        birthDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/),
        sex: z.enum(["female", "male", "other"]).optional(),
        heightCm: z.number().positive().max(250),
        weightKg: z.number().positive().max(500),
        energyKcal: z.number().positive().max(10000),
        dailyActivityFactor: z.number().min(1).max(2.5).default(1),
        carbohydratePercent: z.number().min(0).max(100),
        proteinPercent: z.number().min(0).max(100),
        fatPercent: z.number().min(0).max(100),
        objective: z.string().trim().min(1).max(300),
        activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
        foodPreferences: z.string().trim().min(1).max(500),
        foodRestrictions: z.string().trim().min(1).max(500),
        allergies: z.string().trim().min(1).max(500),
        mealRoutine: z.string().trim().min(1).max(500),
      })
      .refine(
        (value) =>
          Math.abs(value.carbohydratePercent + value.proteinPercent + value.fatPercent - 100) <
          0.001,
        { message: "A distribuição dos macronutrientes deve totalizar 100%." },
      )
      .parse(req.body);
    const result = await transaction(async () => {
      const newUser = await db
        .prepare(
          `INSERT INTO users (name, email, password_hash, role, active) VALUES (?, NULL, NULL, 'patient', FALSE) RETURNING id`,
        )
        .get<{ id: number }>(payload.name);
      const patient = await db
        .prepare(
          "INSERT INTO patients (user_id, nutritionist_user_id, birth_date, sex, height_cm, activity_level, objective, food_preferences, food_restrictions, allergies, meal_routine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .get<{ id: number }>(
          newUser!.id,
          user.id,
          payload.birthDate,
          payload.sex ?? null,
          payload.heightCm,
          payload.activityLevel,
          payload.objective,
          payload.foodPreferences,
          payload.foodRestrictions,
          payload.allergies,
          payload.mealRoutine,
        );
      await db
        .prepare(
          "INSERT INTO weight_history (patient_id, weighed_at, weight_kg, recorded_by) VALUES (?, ?, ?, ?)",
        )
        .run(patient!.id, brazilDate(), payload.weightKg, user.id);
      await db
        .prepare(
          `INSERT INTO nutrition_goals (patient_id, valid_from, energy_kcal, fiber_g, carbohydrate_percent, protein_percent, fat_percent, daily_activity_factor, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          patient!.id,
          brazilDate(),
          payload.energyKcal,
          30,
          payload.carbohydratePercent,
          payload.proteinPercent,
          payload.fatPercent,
          payload.dailyActivityFactor,
          user.id,
        );
      const activationCode = createActivationCode();
      await saveAccountToken(newUser!.id, "activation", normalizeActivationCode(activationCode), 24 * 7, user.id);
      return { patientId: patient!.id, userId: newUser!.id, activationCode };
    });
    res.status(201).json(result);
  }),
);

app.patch(
  "/api/nutritionist/patients/:patientId/profile",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const patient = await patientAccess(user, Number(req.params.patientId));
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado." });
    const payload = z.object({
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      heightCm: z.number().positive().max(250),
      objective: z.string().trim().min(1).max(300),
      activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
      foodPreferences: z.string().trim().min(1).max(500),
      foodRestrictions: z.string().trim().min(1).max(500),
      allergies: z.string().trim().min(1).max(500),
      mealRoutine: z.string().trim().min(1).max(500),
    }).parse(req.body);
    await db.prepare(
      `UPDATE patients SET birth_date = ?, height_cm = ?, objective = ?, activity_level = ?, food_preferences = ?, food_restrictions = ?, allergies = ?, meal_routine = ? WHERE id = ? AND nutritionist_user_id = ?`,
    ).run(
      payload.birthDate,
      payload.heightCm,
      payload.objective,
      payload.activityLevel,
      payload.foodPreferences,
      payload.foodRestrictions,
      payload.allergies,
      payload.mealRoutine,
      patient.id,
      user.id,
    );
    res.json(await db.prepare("SELECT * FROM patients WHERE id = ?").get(patient.id));
  }),
);

app.post(
  "/api/nutritionist/patients/:patientId/activation-code",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const patient = await patientAccess(user, Number(req.params.patientId));
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado." });
    const account = await db
      .prepare("SELECT id, email, active FROM users WHERE id = ? AND role = 'patient'")
      .get<{ id: number; email: string | null; active: boolean }>(patient.user_id);
    if (!account || account.email || account.active)
      return res.status(409).json({ error: "Este paciente já iniciou a ativação da conta." });
    const activationCode = createActivationCode();
    await saveAccountToken(account.id, "activation", normalizeActivationCode(activationCode), 24 * 7, user.id);
    res.json({ activationCode });
  }),
);

app.post(
  "/api/nutritionist/patients/:patientId/password-reset-email",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const patient = await patientAccess(user, Number(req.params.patientId));
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado." });
    const account = await db
      .prepare("SELECT id, name, email, active, email_verified_at FROM users WHERE id = ? AND role = 'patient'")
      .get<{ id: number; name: string; email: string | null; active: boolean; email_verified_at: string | null }>(patient.user_id);
    if (!account?.email || !account.active || !account.email_verified_at)
      return res.status(409).json({ error: "O paciente ainda não confirmou o e-mail." });
    const resetToken = createAccountToken();
    await saveAccountToken(account.id, "password_reset", resetToken, 1, user.id);
    const resetUrl = `${appUrlForRequest(req.headers)}/?reset=${encodeURIComponent(resetToken)}`;
    const mail = await sendMail({
      to: account.email,
      subject: "Restaure sua senha do Nutri+",
      text: `Olá, ${account.name}. Defina uma nova senha para o Nutri+: ${resetUrl}`,
      html: accountMailHtml({
        name: account.name,
        eyebrow: "Segurança da conta",
        title: "Crie uma nova senha",
        message: "Recebemos uma solicitação do seu nutricionista para restaurar sua senha.",
        actionLabel: "Definir nova senha",
        actionUrl: resetUrl,
        expiration: "Este link expira em 1 hora e só pode ser usado uma vez.",
      }),
    });
    res.json(deliveryResult(mail.delivered, resetUrl, `Enviamos a restauração para ${account.email}.`));
  }),
);

app.post(
  "/api/nutritionist/patients/:patientId/email-verification",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const patient = await patientAccess(user, Number(req.params.patientId));
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado." });
    const account = await db
      .prepare("SELECT id, name, email, active, email_verified_at FROM users WHERE id = ? AND role = 'patient'")
      .get<{ id: number; name: string; email: string | null; active: boolean; email_verified_at: string | null }>(patient.user_id);
    if (!account?.email || account.active || account.email_verified_at)
      return res.status(409).json({ error: "Este paciente não está aguardando confirmação de e-mail." });
    const verificationToken = createAccountToken();
    await saveAccountToken(account.id, "email_verification", verificationToken, 24, user.id);
    const verificationUrl = `${appUrlForRequest(req.headers)}/?verify=${encodeURIComponent(verificationToken)}`;
    const mail = await sendMail({
      to: account.email,
      subject: "Confirme seu acesso ao Nutri+",
      text: `Olá, ${account.name}. Confirme seu e-mail para ativar o Nutri+: ${verificationUrl}`,
      html: accountMailHtml({
        name: account.name,
        eyebrow: "Confirmação de e-mail",
        title: "Seu acesso ao Nutri+ está quase pronto",
        message: "Confirme seu e-mail para ativar seu acesso e começar a usar o Nutri+.",
        actionLabel: "Confirmar meu e-mail",
        actionUrl: verificationUrl,
        expiration: "Este link expira em 24 horas.",
      }),
    });
    res.json(deliveryResult(mail.delivered, verificationUrl, `Reenviamos a confirmação para ${account.email}.`));
  }),
);

app.delete(
  "/api/nutritionist/patients/:patientId",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const patient = await patientAccess(user, Number(req.params.patientId));
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado." });
    await transaction(async () => {
      // Remove primeiro o agregado clínico para que históricos que também
      // referenciam users.recorded_by sejam eliminados antes da conta.
      await db
        .prepare("DELETE FROM patients WHERE id = ? AND nutritionist_user_id = ?")
        .run(patient.id, user.id);
      await db.prepare("DELETE FROM users WHERE id = ? AND role = 'patient'").run(patient.user_id);
    });
    res.status(204).end();
  }),
);

app.get(
  "/api/nutritionist/patients/:patientId",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const patient = await patientAccess(user, Number(req.params.patientId));
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado." });
    const to = dateOnly(req.query.to, dateOnly(patient.last_log_date));
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const from = addCalendarDays(to, -(days - 1));
    const logs = await db
      .prepare(
        "SELECT log_date FROM daily_logs WHERE patient_id = ? AND log_date BETWEEN ? AND ? ORDER BY log_date",
      )
      .all<{ log_date: string }>(patient.id, from, to);
    const summaries = await Promise.all(
      logs.map((row) => dailySummary(Number(patient.id), row.log_date)),
    );
    const mealDays = summaries.filter((summary) => summary.meals.length > 0);
    const glycemic = periodGlycemicSummary(mealDays.map((summary) => summary.glycemic));
    const weights = await db
      .prepare(
        "SELECT weighed_at, weight_kg FROM weight_history WHERE patient_id = ? ORDER BY weighed_at",
      )
      .all(patient.id);
    const notes = await db
      .prepare("SELECT * FROM patient_notes WHERE patient_id = ? ORDER BY created_at DESC")
      .all(patient.id);
    const profile = await db
      .prepare(
        "SELECT p.*, u.name, u.email FROM patients p JOIN users u ON u.id = p.user_id WHERE p.id = ?",
      )
      .get(patient.id);
    const totals = mealDays.map((summary) => summary.totals);
    const average: Record<string, number | null> = {};
    for (const code of new Set(totals.flatMap((total) => Object.keys(total)))) {
      const values = totals
        .map((total) => total[code])
        .filter((value): value is number => typeof value === "number");
      average[code] = values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
    }
    res.json({
      profile,
      today: await dailySummary(Number(patient.id), to),
      period: {
        from,
        to,
        totalDays: daysBetween(from, to),
        registeredDays: mealDays.length,
        days: summaries,
        average,
        glycemic,
      },
      weights,
      notes,
    });
  }),
);

app.post(
  "/api/nutritionist/patients/:patientId/goals",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const patient = await patientAccess(user, Number(req.params.patientId));
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado." });
    const payload = z
      .object({
        validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        energyKcal: z.number().positive().nullable(),
        carbohydratePercent: z.number().min(0).max(100),
        proteinPercent: z.number().min(0).max(100),
        fatPercent: z.number().min(0).max(100),
        fiberG: z.number().positive().nullable(),
        dailyActivityFactor: z.number().min(1).max(2.5).default(1),
        waterMl: z.number().positive().nullable().optional(),
      })
      .refine(
        (value) =>
          Math.abs(value.carbohydratePercent + value.proteinPercent + value.fatPercent - 100) <
          0.001,
        { message: "A distribuição dos macronutrientes deve totalizar 100%." },
      )
      .parse(req.body);
    await db
      .prepare(
        `INSERT INTO nutrition_goals (patient_id, valid_from, energy_kcal, protein_g, protein_gkg_min, protein_gkg_max, carbohydrate_g, fat_g, fiber_g, water_ml, carbohydrate_percent, protein_percent, fat_percent, daily_activity_factor, created_by) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?) ON CONFLICT(patient_id, valid_from) DO UPDATE SET energy_kcal=excluded.energy_kcal, protein_g=NULL, protein_gkg_min=NULL, protein_gkg_max=NULL, carbohydrate_g=NULL, fat_g=NULL, fiber_g=excluded.fiber_g, carbohydrate_percent=excluded.carbohydrate_percent, protein_percent=excluded.protein_percent, fat_percent=excluded.fat_percent, daily_activity_factor=excluded.daily_activity_factor`,
      )
      .run(
        patient.id,
        payload.validFrom,
        payload.energyKcal,
        payload.fiberG,
        payload.carbohydratePercent,
        payload.proteinPercent,
        payload.fatPercent,
        payload.dailyActivityFactor,
        user.id,
      );
    res.status(201).json(await activeGoals(Number(patient.id), payload.validFrom));
  }),
);

app.post(
  "/api/nutritionist/patients/:patientId/notes",
  route(async (req, res) => {
    const user = await authUser(req, res);
    if (!user || user.role !== "nutritionist")
      return res.status(403).json({ error: "Área exclusiva do nutricionista." });
    const patient = await patientAccess(user, Number(req.params.patientId));
    if (!patient) return res.status(404).json({ error: "Paciente não encontrado." });
    const payload = z
      .object({ content: z.string().min(1).max(3000), visibility: z.enum(["private", "patient"]) })
      .parse(req.body);
    const note = await db
      .prepare(
        "INSERT INTO patient_notes (patient_id, author_user_id, visibility, content) VALUES (?, ?, ?, ?) RETURNING *",
      )
      .get(patient.id, user.id, payload.visibility, payload.content);
    res.status(201).json(note);
  }),
);

app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  if (res.headersSent) return _next(error);
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
  res.status(status === 413 ? 413 : status === 400 ? 400 : 500).json({ error: 'Não foi possível processar a solicitação.' });
});

app.listen(port, appConfig.apiHost, () => {
  console.log(
    `Nutri+ API: ${appConfig.apiHost}:${port}; ambiente=${appConfig.environment}; configuração=${appConfig.secretsSource}; alimentos=${tbcaCount}`,
  );
});

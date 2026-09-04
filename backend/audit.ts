import { closeDatabase, databaseInfo, db, migrate } from "./db";

await migrate();
const one = async (sql: string) => db.prepare(sql).get();
const all = async (sql: string) => db.prepare(sql).all();

const report = {
  database: databaseInfo,
  tacoFoods: await one(`SELECT COUNT(*)::int AS count FROM foods WHERE source = 'TACO' AND active`),
  uniqueTacoCodes: await one(
    `SELECT COUNT(DISTINCT source_code)::int AS count FROM foods WHERE source = 'TACO'`,
  ),
  duplicateTacoCodes: await one(
    `SELECT COUNT(*)::int AS count FROM (SELECT source_code FROM foods GROUP BY source_code HAVING COUNT(*) > 1) d`,
  ),
  nutrients: await one(`SELECT COUNT(*)::int AS count FROM nutrients`),
  nutrientValues: await one(`SELECT COUNT(*)::int AS count FROM food_nutrients`),
  statuses: await all(
    `SELECT status, COUNT(*)::int AS count FROM food_nutrients GROUP BY status ORDER BY status`,
  ),
  realZeros: await one(
    `SELECT COUNT(*)::int AS count FROM food_nutrients WHERE status='numeric' AND numeric_value=0`,
  ),
  invalidStates: await one(
    `SELECT COUNT(*)::int AS count FROM food_nutrients WHERE (status='numeric') <> (numeric_value IS NOT NULL)`,
  ),
  incompleteFoods: await one(
    `SELECT COUNT(*)::int AS count FROM (SELECT food_id FROM food_nutrients GROUP BY food_id HAVING COUNT(*) <> 26) x`,
  ),
  glycemicIndex: {
    numeric: await one(`SELECT COUNT(glycemic_index)::int AS count FROM foods WHERE source='TACO'`),
    unavailable: await one(
      `SELECT COUNT(*)::int AS count FROM foods WHERE source='TACO' AND glycemic_index IS NULL`,
    ),
    invalid: await one(
      `SELECT COUNT(*)::int AS count FROM foods WHERE source='TACO' AND (glycemic_index < 0 OR glycemic_index > 200)`,
    ),
  },
  macroDistributions: {
    configured: await one(
      `SELECT COUNT(*)::int AS count FROM nutrition_goals WHERE carbohydrate_percent IS NOT NULL AND protein_percent IS NOT NULL AND fat_percent IS NOT NULL`,
    ),
    invalid: await one(
      `SELECT COUNT(*)::int AS count FROM nutrition_goals WHERE carbohydrate_percent IS NULL OR protein_percent IS NULL OR fat_percent IS NULL OR ABS(carbohydrate_percent + protein_percent + fat_percent - 100) >= 0.001`,
    ),
  },
  history: {
    users: await one(`SELECT COUNT(*)::int AS count FROM users`),
    patients: await one(`SELECT COUNT(*)::int AS count FROM patients`),
    weights: await one(`SELECT COUNT(*)::int AS count FROM weight_history`),
    goals: await one(`SELECT COUNT(*)::int AS count FROM nutrition_goals`),
    notes: await one(`SELECT COUNT(*)::int AS count FROM patient_notes`),
    dailyLogs: await one(`SELECT COUNT(*)::int AS count FROM daily_logs`),
    meals: await one(`SELECT COUNT(*)::int AS count FROM meals`),
    mealEntries: await one(`SELECT COUNT(*)::int AS count FROM meal_entries`),
    favorites: await one(`SELECT COUNT(*)::int AS count FROM favorites`),
  },
  latestImport: await one(
    `SELECT * FROM nutrition_import_runs WHERE source='TACO' ORDER BY id DESC LIMIT 1`,
  ),
};

console.log(JSON.stringify(report, null, 2));
await closeDatabase();

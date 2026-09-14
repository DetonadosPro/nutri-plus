import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { adherenceForPeriod, matchMealItems } from './plan-diary-adherence';

describe('plan diary adherence historical PostgreSQL integration', () => {
  let close: undefined | (() => Promise<void>), userIds: number[] = [];
  afterAll(async () => {
    const { db } = await import('./db');
    for (const id of userIds.reverse()) await db.prepare('DELETE FROM users WHERE id=?').run(id);
    await close?.();
  });

  it('uses the plan and approved substitutions valid on each diary date without rewriting the past', async () => {
    const { db, closeDatabase, databaseInfo } = await import('./db'); close = closeDatabase;
    if (databaseInfo.host !== '127.0.0.1') throw new Error('Teste somente local.');
    const tag = randomUUID();
    const nutritionist = await db.prepare(`INSERT INTO users(name,email,password_hash,role,active) VALUES(?,?,?,'nutritionist',TRUE) RETURNING id`).get<{ id: number }>('Nutri aderência', `${tag}-n@local.test`, 'disabled');
    const patientUser = await db.prepare(`INSERT INTO users(name,email,password_hash,role,active) VALUES(?,?,?,'patient',TRUE) RETURNING id`).get<{ id: number }>('Paciente aderência', `${tag}-p@local.test`, 'disabled');
    userIds = [nutritionist!.id, patientUser!.id];
    const patient = await db.prepare('INSERT INTO patients(user_id,nutritionist_user_id,height_cm) VALUES(?,?,170) RETURNING id').get<{ id: number }>(patientUser!.id, nutritionist!.id);
    const foods = await db.prepare(`SELECT id,source_code,COALESCE(display_name,description) name FROM foods WHERE source_code=ANY(?::text[])`).all<{ id: number; source_code: string; name: string }>(['BRC0018A','BRC0053B','BRC0004B','BRC0001T','BRC0114F','BRC0043G','BRC0010J']);
    const ids = Object.fromEntries(foods.map((food) => [food.source_code, food.id]));
    expect(Object.keys(ids)).toHaveLength(7);
    const realFoodMatches = matchMealItems(
      [
        ['BRC0018A',100,'g'],['BRC0001T',100,'g'],['BRC0114F',100,'g'],['BRC0043G',206,'mL'],['BRC0010J',100,'unidades'],
      ].map(([code,grams,unit],position) => ({ id:position+1,foodId:ids[String(code)],name:String(code),amount:Number(grams),unit:String(unit),grams:Number(grams),position,substitutions:[] })),
      [
        ['BRC0018A',105,'g'],['BRC0001T',95,'g'],['BRC0114F',110,'g'],['BRC0043G',200,'copo'],['BRC0010J',100,'g'],
      ].map(([code,grams,unit],position) => ({ id:position+1,foodId:ids[String(code)],name:String(code),amount:Number(grams),unit:String(unit),grams:Number(grams),position })),
    );
    expect(realFoodMatches.every((item) => item.state.startsWith('matched_'))).toBe(true);
    async function plan(version: number, status: 'active' | 'archived', published: string, archived: string | null, substitution: number) {
      const p = await db.prepare(`INSERT INTO meal_plans(patient_id,created_by,version,status,published_at,archived_at) VALUES(?,?,?,?,?,?) RETURNING id`).get<{ id: number }>(patient!.id,nutritionist!.id,version,status,published,archived);
      const meal = await db.prepare(`INSERT INTO meal_plan_meals(meal_plan_id,meal_type,position) VALUES(?,'lunch',0) RETURNING id`).get<{ id: number }>(p!.id);
      const item = await db.prepare(`INSERT INTO meal_plan_items(meal_plan_meal_id,food_id,position,amount,unit,grams_equivalent) VALUES(?,?,0,100,'g',100) RETURNING id`).get<{ id: number }>(meal!.id,ids.BRC0018A);
      await db.prepare(`INSERT INTO meal_plan_item_substitutions(meal_plan_item_id,food_id,position,amount,unit,grams_equivalent,origin,algorithm_version,equivalence_metadata,nutrient_snapshot) VALUES(?,?,0,100,'g',100,'manual','substitution-v1','{}','{}')`).run(item!.id,substitution);
      return p!.id;
    }
    await plan(1,'archived','2026-09-01T12:00:00-03:00','2026-09-10T12:00:00-03:00',ids.BRC0053B);
    await plan(2,'active','2026-09-10T12:00:00-03:00',null,ids.BRC0004B);
    async function record(date: string, foodId: number, grams = 100, mealType = 'lunch') {
      const log = await db.prepare('INSERT INTO daily_logs(patient_id,log_date) VALUES(?,?) RETURNING id').get<{ id: number }>(patient!.id,date);
      const meal = await db.prepare(`INSERT INTO meals(daily_log_id,meal_type,label) VALUES(?,?,?) RETURNING id`).get<{ id: number }>(log!.id,mealType,mealType);
      return (await db.prepare(`INSERT INTO meal_entries(meal_id,food_id,amount,unit,grams_equivalent) VALUES(?, ?, ?, 'g', ?) RETURNING id`).get<{ id: number }>(meal!.id,foodId,grams,grams))!.id;
    }
    await record('2026-08-31',ids.BRC0053B);
    await record('2026-09-05',ids.BRC0053B);
    const retroactiveEntry = await record('2026-09-06',ids.BRC0018A);
    await record('2026-09-15',ids.BRC0053B);
    await record('2026-09-16',ids.BRC0004B);
    await record('2026-09-17',ids.BRC0018A,100,'dinner');
    const result = await adherenceForPeriod(patient!.id,'2026-08-31','2026-09-17');
    expect(result.performance.queries).toBe(3);
    expect(result.days.find((day) => day.date === '2026-08-31')?.state).toBe('no_plan');
    expect(result.days.find((day) => day.date === '2026-09-01')?.state).toBe('no_plan');
    expect(result.days.find((day) => day.date === '2026-09-05')?.plan?.version).toBe(1);
    expect(result.days.find((day) => day.date === '2026-09-05')?.meals[0].items[0].state).toBe('matched_substitution');
    expect(result.days.find((day) => day.date === '2026-09-15')?.plan?.version).toBe(2);
    expect(result.days.find((day) => day.date === '2026-09-15')?.meals[0].items.map((item) => item.state)).toEqual(['planned_not_recorded','extra_recorded']);
    expect(result.days.find((day) => day.date === '2026-09-16')?.meals[0].items[0].state).toBe('matched_substitution');
    expect(result.days.find((day) => day.date === '2026-09-17')?.meals.find((meal) => meal.mealType === 'dinner')?.items[0].state).toBe('extra_recorded');
    expect(result.days.find((day) => day.date === '2026-09-10')?.plan?.version).toBe(1);
    expect(result.days.find((day) => day.date === '2026-09-11')?.plan?.version).toBe(2);
    expect(result.summary.eligibleMeals).toBe(16);
    expect(result.summary).toMatchObject({ eligiblePlannedItems:16, coveredPlannedItems:3 });
    expect(result.planChangedDuringPeriod).toBe(true);
    const sevenDays = await adherenceForPeriod(patient!.id,'2026-09-11','2026-09-17');
    const thirtyDays = await adherenceForPeriod(patient!.id,'2026-08-19','2026-09-17');
    expect(sevenDays.days).toHaveLength(7);
    expect(thirtyDays.days).toHaveLength(30);
    expect(sevenDays.performance.queries).toBe(3);
    expect(thirtyDays.performance.queries).toBe(3);
    expect(sevenDays.performance.milliseconds).toBeLessThan(1000);
    expect(thirtyDays.performance.milliseconds).toBeLessThan(1000);
    await db.prepare('UPDATE meal_entries SET amount=150,grams_equivalent=150 WHERE id=?').run(retroactiveEntry);
    expect((await adherenceForPeriod(patient!.id,'2026-09-06','2026-09-06')).days[0].meals[0].items[0].quantity).toBe('outside_target');
    await db.prepare('DELETE FROM meal_entries WHERE id=?').run(retroactiveEntry);
    expect((await adherenceForPeriod(patient!.id,'2026-09-06','2026-09-06')).days[0].meals[0].state).toBe('not_evaluable');
  });
});

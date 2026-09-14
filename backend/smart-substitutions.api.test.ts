import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

it.skipIf(!process.env.NUTRI_MEAL_PLAN_TEST_API)(
  'API: substitutions are authorized, bounded, concurrent, versioned and frozen',
  async () => {
    const { db, closeDatabase, databaseInfo } = await import('./db');
    const { createSession } = await import('./auth');
    const base = process.env.NUTRI_MEAL_PLAN_TEST_API!;
    if (databaseInfo.host !== '127.0.0.1' || new URL(base).hostname !== '127.0.0.1')
      throw new Error('Teste somente local.');
    const tag = randomUUID();
    const userIds: number[] = [];
    try {
      const nutritionist = await db.prepare(
        'INSERT INTO users(name,email,password_hash,role,active) VALUES(?,?,?,?,TRUE) RETURNING id',
      ).get<{ id: number }>('Nutricionista substituições', `${tag}-nutri@local.test`, 'disabled', 'nutritionist');
      userIds.push(nutritionist!.id);
      const patientUser = await db.prepare(
        'INSERT INTO users(name,email,password_hash,role,active) VALUES(?,?,?,?,TRUE) RETURNING id',
      ).get<{ id: number }>('Paciente substituições', `${tag}-patient@local.test`, 'disabled', 'patient');
      userIds.push(patientUser!.id);
      const outsider = await db.prepare(
        'INSERT INTO users(name,email,password_hash,role,active) VALUES(?,?,?,?,TRUE) RETURNING id',
      ).get<{ id: number }>('Nutricionista externo', `${tag}-outsider@local.test`, 'disabled', 'nutritionist');
      userIds.push(outsider!.id);
      const patient = await db.prepare(`INSERT INTO patients(
        user_id,nutritionist_user_id,height_cm,food_preferences,food_restrictions,allergies)
        VALUES(?,?,170,?,?,?) RETURNING id`).get<{ id: number }>(
          patientUser!.id,
          nutritionist!.id,
          'prefere preparações simples',
          'texto livre de restrição',
          'texto livre de alergia',
        );
      const tokens = {
        nutritionist: (await createSession(nutritionist!.id)).token,
        patient: (await createSession(patientUser!.id)).token,
        outsider: (await createSession(outsider!.id)).token,
      };
      async function request(path: string, method = 'GET', body?: unknown, token = tokens.nutritionist) {
        const response = await fetch(base + path, {
          method,
          headers: { Cookie: `nutri_session=${token}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: response.status === 204 ? null : await response.json() };
      }
      const foodRows = await db.prepare('SELECT id,source_code FROM foods WHERE source_code=ANY(?::text[]) AND active')
        .all<{ id: number; source_code: string }>([
          'BRC0018A', 'BRC0117B', 'BRC0114F', 'BRC0023F', 'BRC0030B',
          'BRC0044G', 'BRC0043G', 'BRC0065J', 'BRC0010J',
        ]);
      expect(foodRows).toHaveLength(9);
      const foods = Object.fromEntries(foodRows.map((row) => [row.source_code, Number(row.id)]));

      let plan = (await request(`/nutritionist/patients/${patient!.id}/meal-plans`, 'POST')).body;
      plan = (await request(`/meal-plans/${plan.id}/meals`, 'POST', { mealType: 'lunch' })).body;
      plan = (await request(`/meal-plan-meals/${plan.meals[0].id}/items`, 'POST', {
        foodId: foods.BRC0018A,
        grams: 100,
      })).body;
      const item = plan.meals[0].items[0];
      plan = (await request(`/meal-plan-meals/${plan.meals[0].id}/items`, 'POST', {
        foodId: foods.BRC0044G,
        grams: 200,
      })).body;
      plan = (await request(`/meal-plan-meals/${plan.meals[0].id}/items`, 'POST', {
        foodId: foods.BRC0065J,
        grams: 100,
      })).body;
      const milkItem = plan.meals[0].items.find((entry: any) => entry.food_id === foods.BRC0044G);
      const eggItem = plan.meals[0].items.find((entry: any) => entry.food_id === foods.BRC0065J);
      const originalTotals = structuredClone(plan.totals);

      const suggestions = await request(`/meal-plan-items/${item.id}/substitution-suggestions`);
      expect(suggestions.status).toBe(200);
      expect(suggestions.body).toMatchObject({
        algorithmVersion: 'substitution-v1',
        classification: { group: 'carbohydrate' },
        patientContext: {
          preferences: 'prefere preparações simples',
          restrictions: 'texto livre de restrição',
          allergies: 'texto livre de alergia',
          structuredFiltering: false,
        },
      });
      expect(suggestions.body.suggestions.length).toBeGreaterThan(0);
      expect(suggestions.body.suggestions.length).toBeLessThanOrEqual(3);
      expect((await request(`/meal-plan-items/${item.id}/substitution-suggestions`, 'GET', undefined, tokens.patient)).status).toBe(404);
      expect((await request(`/meal-plan-items/${item.id}/substitution-suggestions`, 'GET', undefined, tokens.outsider)).status).toBe(404);

      const crossGroup = await request(`/meal-plan-items/${item.id}/substitution-equivalence?foodId=${foods.BRC0114F}`);
      expect(crossGroup.status).toBe(200);
      expect(crossGroup.body.equivalence).toMatchObject({
        automaticCompatible: false,
        compatibilityReason: 'different_group',
      });

      const approvedSuggestion = suggestions.body.suggestions[0];
      const first = await request(`/meal-plan-items/${item.id}/substitutions`, 'POST', {
        foodId: approvedSuggestion.food.id,
        origin: 'suggestion',
      });
      expect(first.status).toBe(201);
      expect(first.body.totals).toEqual(originalTotals);

      const manualCandidates = [foods.BRC0117B, foods.BRC0114F, foods.BRC0023F, foods.BRC0030B]
        .filter((foodId) => foodId !== approvedSuggestion.food.id);
      const concurrent = await Promise.all(manualCandidates.slice(0, 3).map((foodId) =>
        request(`/meal-plan-items/${item.id}/substitutions`, 'POST', {
          foodId,
          origin: 'manual',
          grams: 90,
        }),
      ));
      expect(concurrent.map((result) => result.status).sort()).toEqual([201, 201, 409]);
      plan = (await request(`/meal-plans/${plan.id}`)).body;
      let substitutions = plan.meals[0].items[0].substitutions;
      expect(substitutions).toHaveLength(3);
      expect(substitutions.map((entry: any) => entry.position)).toEqual([0, 1, 2]);
      expect(plan.totals).toEqual(originalTotals);

      expect((await request(`/meal-plan-items/${item.id}/substitutions`, 'POST', {
        foodId: substitutions[0].food_id,
        origin: 'manual',
        grams: 100,
      })).status).toBe(409);
      expect((await request(`/meal-plan-items/${item.id}/substitutions`, 'POST', {
        foodId: item.food_id,
        origin: 'manual',
        grams: 100,
      })).status).toBe(409);

      const unusedFoodId = manualCandidates.find((foodId) =>
        !substitutions.some((entry: any) => entry.food_id === foodId),
      )!;
      await expect(db.prepare(`INSERT INTO meal_plan_item_substitutions(
        meal_plan_item_id,food_id,position,amount,unit,grams_equivalent,origin,algorithm_version,equivalence_metadata)
        VALUES(?,?,3,100,'g',100,'manual','constraint-test','{}'::jsonb)`).run(item.id, unusedFoodId)).rejects.toThrow();

      const reversed = [...substitutions].reverse().map((entry: any) => entry.id);
      const reordered = await request(`/meal-plan-items/${item.id}/substitutions/order`, 'PUT', { ids: reversed });
      expect(reordered.status).toBe(200);
      substitutions = reordered.body.meals[0].items[0].substitutions;
      expect(substitutions.map((entry: any) => entry.id)).toEqual(reversed);

      const edited = await request(`/meal-plan-item-substitutions/${substitutions[0].id}`, 'PATCH', { grams: 95 });
      expect(edited.status).toBe(200);
      substitutions = edited.body.meals[0].items[0].substitutions;
      expect(substitutions[0].grams_equivalent).toBe(95);
      expect(edited.body.totals).toEqual(originalTotals);

      const milkVolume = await db.prepare(`SELECT id,quantity::float8 quantity,grams::float8 grams,name
        FROM food_measures WHERE food_id=? AND kind='volume' ORDER BY is_default DESC,id LIMIT 1`)
        .get<{ id: number; quantity: number; grams: number; name: string }>(foods.BRC0043G);
      const eggCount = await db.prepare(`SELECT id,quantity::float8 quantity,grams::float8 grams,name
        FROM food_measures WHERE food_id=? AND kind='count' ORDER BY is_default DESC,id LIMIT 1`)
        .get<{ id: number; quantity: number; grams: number; name: string }>(foods.BRC0010J);
      expect(milkVolume).toBeTruthy();
      expect(eggCount).toBeTruthy();
      const milkAlternative = await request(`/meal-plan-items/${milkItem.id}/substitutions`, 'POST', {
        foodId: foods.BRC0043G,
        origin: 'manual',
        quantity: 200,
        measureId: milkVolume!.id,
      });
      expect(milkAlternative.status).toBe(201);
      const savedMilk = milkAlternative.body.meals[0].items
        .find((entry: any) => entry.id === milkItem.id).substitutions[0];
      expect(savedMilk).toMatchObject({ amount: 200, measure_snapshot: { id: milkVolume!.id, kind: 'volume' } });
      expect(savedMilk.grams_equivalent).toBeCloseTo(200 * milkVolume!.grams / milkVolume!.quantity, 8);
      const eggAlternative = await request(`/meal-plan-items/${eggItem.id}/substitutions`, 'POST', {
        foodId: foods.BRC0010J,
        origin: 'manual',
        quantity: 2,
        measureId: eggCount!.id,
      });
      expect(eggAlternative.status).toBe(201);
      const savedEgg = eggAlternative.body.meals[0].items
        .find((entry: any) => entry.id === eggItem.id).substitutions[0];
      expect(savedEgg).toMatchObject({ amount: 2, measure_snapshot: { id: eggCount!.id, kind: 'count' } });
      expect(savedEgg.grams_equivalent).toBeCloseTo(2 * eggCount!.grams / eggCount!.quantity, 8);
      expect(eggAlternative.body.totals).toEqual(originalTotals);

      const published = await request(`/meal-plans/${plan.id}/publish`, 'POST');
      expect(published.status).toBe(200);
      const publishedSubstitutions = published.body.meals[0].items[0].substitutions;
      expect(publishedSubstitutions).toHaveLength(3);
      const frozen = await db.prepare(`SELECT id,nutrient_snapshot FROM meal_plan_item_substitutions
        WHERE meal_plan_item_id=? ORDER BY position`).all<{ id: number; nutrient_snapshot: Record<string, unknown> }>(item.id);
      expect(frozen).toHaveLength(3);
      expect(frozen.every((entry) => Object.keys(entry.nutrient_snapshot).length > 5)).toBe(true);

      const patientView = await request('/patient/meal-plan', 'GET', undefined, tokens.patient);
      expect(patientView.status).toBe(200);
      expect(patientView.body.meals[0].items[0].substitutions).toHaveLength(3);
      expect((await request(`/meal-plan-item-substitutions/${frozen[0].id}`, 'DELETE')).status).toBe(409);
      expect((await request(`/meal-plan-item-substitutions/${frozen[0].id}`, 'PATCH', { grams: 80 })).status).toBe(409);

      await db.prepare('UPDATE meal_plan_item_substitutions SET nutrient_snapshot=?::jsonb WHERE id=?').run(
        JSON.stringify({ energia_kcal: { numeric_value: 777, raw_value: '777', status: 'numeric' } }),
        frozen[0].id,
      );
      const historical = (await request(`/meal-plans/${plan.id}`)).body;
      const historicalAlternative = historical.meals[0].items[0].substitutions[0];
      expect(historicalAlternative.nutrients.energia_kcal).toBeCloseTo(
        777 * historicalAlternative.grams_equivalent / 100,
        8,
      );
      const duplicate = await request(`/meal-plans/${plan.id}/duplicate`, 'POST');
      expect(duplicate.status).toBe(201);
      const clonedAlternatives = duplicate.body.meals[0].items[0].substitutions;
      expect(clonedAlternatives).toHaveLength(3);
      expect(clonedAlternatives[0].nutrients.energia_kcal).not.toBeCloseTo(
        777 * clonedAlternatives[0].grams_equivalent / 100,
        8,
      );
      expect((await db.prepare(`SELECT count(*)::int count FROM meal_entries entry
        JOIN meals meal ON meal.id=entry.meal_id JOIN daily_logs log ON log.id=meal.daily_log_id
        WHERE log.patient_id=?`).get<{ count: number }>(patient!.id))!.count).toBe(0);
    } finally {
      for (const userId of userIds.reverse())
        await db.prepare('DELETE FROM users WHERE id=?').run(userId);
      await closeDatabase();
    }
  },
  30_000,
);

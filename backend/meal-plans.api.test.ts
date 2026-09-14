import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

it.skipIf(!process.env.NUTRI_MEAL_PLAN_TEST_API)(
  "API: plano alimentar completo, versionado, autorizado e separado do diário",
  async () => {
    const { db, closeDatabase, databaseInfo } = await import("./db");
    const { createSession } = await import("./auth");
    const base = process.env.NUTRI_MEAL_PLAN_TEST_API!;
    if (databaseInfo.host !== "127.0.0.1" || new URL(base).hostname !== "127.0.0.1")
      throw new Error("Teste somente local.");
    const tag = randomUUID();
    const userIds: number[] = [];
    try {
      async function user(role: "nutritionist" | "patient", owner?: number) {
        const row = await db
          .prepare(
            "INSERT INTO users(name,email,password_hash,role,active) VALUES(?,?,? ,?,TRUE) RETURNING id",
          )
          .get<{ id: number }>(
            `Plano ${role}`,
            `${tag}-${role}-${userIds.length}@local.test`,
            "disabled",
            role,
          );
        userIds.push(row!.id);
        if (role === "patient") {
          const patient = await db
            .prepare(
              "INSERT INTO patients(user_id,nutritionist_user_id,height_cm) VALUES(?,?,170) RETURNING id",
            )
            .get<{ id: number }>(row!.id, owner!);
          return { userId: row!.id, patientId: patient!.id };
        }
        return { userId: row!.id };
      }
      const nutritionist = await user("nutritionist");
      const patient = await user("patient", nutritionist.userId);
      const outsider = await user("nutritionist");
      const otherPatient = await user("patient", outsider.userId);
      await db
        .prepare(
          `INSERT INTO nutrition_goals(patient_id,valid_from,energy_kcal,fiber_g,protein_gkg_min,carbohydrate_percent,protein_percent,fat_percent,created_by) VALUES(?,CURRENT_DATE,2000,30,1.4,50,20,30,?)`,
        )
        .run(patient.patientId, nutritionist.userId);
      await db
        .prepare(
          `INSERT INTO weight_history(patient_id,weighed_at,weight_kg,recorded_by) VALUES(?,CURRENT_DATE,70,?)`,
        )
        .run(patient.patientId, nutritionist.userId);
      const tokens = {
        nutritionist: (await createSession(nutritionist.userId)).token,
        patient: (await createSession(patient.userId)).token,
        outsider: (await createSession(outsider.userId)).token,
        otherPatient: (await createSession(otherPatient.userId)).token,
      };
      async function request(
        path: string,
        method = "GET",
        body?: unknown,
        token = tokens.nutritionist,
      ) {
        const response = await fetch(base + path, {
          method,
          headers: { Cookie: `nutri_session=${token}`, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return {
          status: response.status,
          body: response.status === 204 ? null : await response.json(),
        };
      }
      const foods = Object.fromEntries(
        await Promise.all(
          ["BRC0065J", "BRC0044G", "BRC0018A", "BRC0001T", "BRC0023F", "BRC0030B"].map(
            async (code) => [
              code,
              (await db
                .prepare("SELECT id FROM foods WHERE source_code=?")
                .get<{ id: number }>(code))!.id,
            ],
          ),
        ),
      );
      async function measure(foodId: number, where: string) {
        return (await db
          .prepare(
            `SELECT id,quantity::float8 AS quantity,grams::float8 AS grams FROM food_measures WHERE food_id=? AND ${where} ORDER BY is_default DESC,id LIMIT 1`,
          )
          .get<{ id: number; quantity: number; grams: number }>(foodId))!;
      }
      const omeletMeasure = await measure(foods.BRC0065J, "kind='count'");
      const milkMeasure = await measure(foods.BRC0044G, "kind='volume'");
      const riceMeasure = await measure(foods.BRC0018A, "kind='household'");
      const beanMeasure = await measure(foods.BRC0001T, "kind='household'");

      const created = await request(
        `/nutritionist/patients/${patient.patientId}/meal-plans`,
        "POST",
      );
      expect(created.status).toBe(201);
      let plan = created.body;
      expect(plan).toMatchObject({ version: 1, status: "draft", meals: [], queryCount: 6 });
      const metadata = await request(`/meal-plans/${plan.id}`, "PATCH", {
        title: "Plano de teste",
        notes: "Orientação de teste",
        lockVersion: plan.lock_version,
      });
      expect(metadata.status).toBe(200);
      plan = metadata.body;
      expect(plan).toMatchObject({ title: "Plano de teste", notes: "Orientação de teste" });
      expect(
        (
          await request(
            `/nutritionist/patients/${otherPatient.patientId}/meal-plans`,
            "POST",
            {},
            tokens.nutritionist,
          )
        ).status,
      ).toBe(404);
      const breakfast = await request(`/meal-plans/${plan.id}/meals`, "POST", {
        name: "Café da manhã",
        time: "07:30",
      });
      plan = breakfast.body;
      const breakfastId = plan.meals[0].id;
      plan = (
        await request(`/meal-plan-meals/${breakfastId}/items`, "POST", {
          foodId: foods.BRC0065J,
          quantity: 2,
          measureId: omeletMeasure.id,
          notes: "sem óleo",
        })
      ).body;
      plan = (
        await request(`/meal-plan-meals/${breakfastId}/items`, "POST", {
          foodId: foods.BRC0044G,
          quantity: 200,
          measureId: milkMeasure.id,
        })
      ).body;
      expect(plan.meals[0].items[0]).toMatchObject({
        amount: 2,
        grams_equivalent: 100,
        measure_snapshot: { name: "ovo", grams: 50 },
        notes: "sem óleo",
      });
      expect(plan.meals[0].items[1]).toMatchObject({ amount: 200, unit: "mL" });
      expect(plan.meals[0].items[1].grams_equivalent).toBeCloseTo(
        200 * (milkMeasure.grams / milkMeasure.quantity),
        8,
      );
      expect(plan.totals.energia_kcal).toBeGreaterThan(0);
      expect(plan.goals.energy_kcal).toBe(2000);
      expect(plan.goals.protein_g).toBe(100);
      expect(plan.goals.protein_gkg_min_grams).toBeCloseTo(98, 8);
      plan = (
        await request(`/meal-plans/${plan.id}/meals`, "POST", { name: "Almoço", time: "12:30" })
      ).body;
      const lunchId = plan.meals[1].id;
      for (const [foodId, m] of [
        [foods.BRC0018A, riceMeasure],
        [foods.BRC0001T, beanMeasure],
      ] as const)
        plan = (
          await request(`/meal-plan-meals/${lunchId}/items`, "POST", {
            foodId,
            quantity: 1,
            measureId: m.id,
          })
        ).body;
      plan = (
        await request(`/meal-plan-meals/${lunchId}/items`, "POST", {
          foodId: foods.BRC0023F,
          grams: 120,
        })
      ).body;
      plan = (
        await request(`/meal-plans/${plan.id}/meals`, "POST", { name: "Jantar", time: "19:30" })
      ).body;
      const dinnerId = plan.meals[2].id;
      plan = (
        await request(`/meal-plan-meals/${dinnerId}/items`, "POST", {
          foodId: foods.BRC0030B,
          grams: 80,
        })
      ).body;
      const rice = plan.meals.find((meal: any) => meal.id === lunchId).items[0];
      expect(rice.measure_snapshot.source).toBe("TBCA");
      expect(rice.grams_equivalent).toBeCloseTo(riceMeasure.grams / riceMeasure.quantity, 8);
      plan = (
        await request(`/meal-plan-items/${rice.id}`, "PATCH", {
          quantity: 2,
          measureId: riceMeasure.id,
          notes: "duas porções",
        })
      ).body;
      expect(
        plan.meals
          .find((meal: any) => meal.id === lunchId)
          .items.find((item: any) => item.id === rice.id),
      ).toMatchObject({ amount: 2, notes: "duas porções" });
      const itemIds = plan.meals
        .find((meal: any) => meal.id === lunchId)
        .items.map((item: any) => item.id);
      plan = (
        await request(`/meal-plan-meals/${lunchId}/items/order`, "PUT", {
          ids: [...itemIds].reverse(),
        })
      ).body;
      expect(
        plan.meals.find((meal: any) => meal.id === lunchId).items.map((item: any) => item.id),
      ).toEqual([...itemIds].reverse());
      const mealIds = plan.meals.map((meal: any) => meal.id);
      plan = (
        await request(`/meal-plans/${plan.id}/meals/order`, "PUT", { ids: [...mealIds].reverse() })
      ).body;
      expect(plan.meals.map((meal: any) => meal.id)).toEqual([...mealIds].reverse());
      const removable = plan.meals[0].items[0];
      expect((await request(`/meal-plan-items/${removable.id}`, "DELETE")).status).toBe(204);
      plan = (await request(`/meal-plans/${plan.id}`)).body;
      expect(plan.meals[0].items.some((item: any) => item.id === removable.id)).toBe(false);
      const published = await request(`/meal-plans/${plan.id}/publish`, "POST");
      expect(published.status).toBe(200);
      plan = published.body;
      expect(plan.status).toBe("active");
      expect(plan.published_at).toBeTruthy();
      const frozenItem = plan.meals.flatMap((meal: any) => meal.items)[0];
      const storedSnapshot = await db
        .prepare("SELECT nutrient_snapshot FROM meal_plan_items WHERE id=?")
        .get<{ nutrient_snapshot: Record<string, unknown> }>(frozenItem.id);
      expect(Object.keys(storedSnapshot!.nutrient_snapshot).length).toBeGreaterThan(5);
      await db
        .prepare("UPDATE meal_plan_items SET nutrient_snapshot=?::jsonb WHERE id=?")
        .run(
          JSON.stringify({
            energia_kcal: { numeric_value: 999, raw_value: "999", status: "numeric" },
          }),
          frozenItem.id,
        );
      const historicalRead = (await request(`/meal-plans/${plan.id}`)).body;
      const frozenRead = historicalRead.meals
        .flatMap((meal: any) => meal.items)
        .find((item: any) => item.id === frozenItem.id);
      expect(frozenRead.nutrients.energia_kcal).toBeCloseTo(
        (999 * frozenRead.grams_equivalent) / 100,
        8,
      );
      const patientView = await request("/patient/meal-plan", "GET", undefined, tokens.patient);
      expect(patientView.status).toBe(200);
      expect(patientView.body.id).toBe(plan.id);
      expect(
        (await request(`/meal-plans/${plan.id}`, "PATCH", { title: "reescrito" }, tokens.patient))
          .status,
      ).toBe(403);
      expect(
        (await request("/patient/meal-plan", "GET", undefined, tokens.otherPatient)).body,
      ).toBeNull();
      expect(
        (await request(`/meal-plans/${plan.id}`, "PATCH", { title: "reescrito" })).status,
      ).toBe(409);
      const duplicate = await request(`/meal-plans/${plan.id}/duplicate`, "POST");
      expect(duplicate.status).toBe(201);
      const v2 = duplicate.body;
      expect(v2).toMatchObject({ version: 2, status: "draft", source_plan_id: plan.id });
      expect(v2.meals).toHaveLength(plan.meals.length);
      const clonedItem = v2.meals
        .flatMap((meal: any) => meal.items)
        .find((item: any) => item.food_id === frozenItem.food_id);
      expect(clonedItem.nutrients.energia_kcal).not.toBeCloseTo(
        (999 * clonedItem.grams_equivalent) / 100,
        8,
      );
      expect(
        v2.meals.flatMap((meal: any) => meal.items).find((item: any) => item.measure_snapshot)
          ?.measure_snapshot,
      ).toEqual(
        plan.meals.flatMap((meal: any) => meal.items).find((item: any) => item.measure_snapshot)
          ?.measure_snapshot,
      );
      const double = await Promise.all([
        request(`/meal-plans/${v2.id}/publish`, "POST"),
        request(`/meal-plans/${v2.id}/publish`, "POST"),
      ]);
      expect(double.map((x) => x.status).sort()).toEqual([200, 409]);
      const history = await request(`/nutritionist/patients/${patient.patientId}/meal-plans`);
      expect(history.body.map((row: any) => row.status)).toEqual(["active", "archived"]);
      expect(history.body.map((row: any) => row.version)).toEqual([2, 1]);
      expect(
        (await db
          .prepare(
            "SELECT count(*)::int AS count FROM meal_plans WHERE patient_id=? AND status='active'",
          )
          .get<{ count: number }>(patient.patientId))!.count,
      ).toBe(1);
      await expect(
        db
          .prepare(
            `INSERT INTO meal_plans(patient_id,created_by,version,status,published_at) VALUES(?,?,99,'active',CURRENT_TIMESTAMP)`,
          )
          .run(patient.patientId, nutritionist.userId),
      ).rejects.toThrow();
      const empty = (
        await request(`/nutritionist/patients/${patient.patientId}/meal-plans`, "POST", {
          title: "Vazia",
        })
      ).body;
      expect((await request(`/meal-plans/${empty.id}/publish`, "POST")).status).toBe(400);
      expect((await request("/patient/meal-plan", "GET", undefined, tokens.patient)).body.id).toBe(
        v2.id,
      );
      const rollbackDraft = (await request(`/meal-plans/${v2.id}/duplicate`, "POST")).body;
      const rollbackFunction = `meal_plan_fail_${tag.replaceAll("-", "")}`;
      await db.exec(`CREATE FUNCTION ${rollbackFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=${Number(rollbackDraft.id)} AND NEW.status='active' THEN RAISE EXCEPTION 'forced publish failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${rollbackFunction}_trigger BEFORE UPDATE ON meal_plans FOR EACH ROW EXECUTE FUNCTION ${rollbackFunction}()`);
      try {
        expect((await request(`/meal-plans/${rollbackDraft.id}/publish`, "POST")).status).toBe(500);
      } finally {
        await db.exec(`DROP TRIGGER ${rollbackFunction}_trigger ON meal_plans; DROP FUNCTION ${rollbackFunction}()`);
      }
      expect((await request("/patient/meal-plan", "GET", undefined, tokens.patient)).body.id).toBe(v2.id);
      expect(
        (
          await request(`/meal-plan-meals/${breakfastId}/items`, "POST", {
            foodId: 99999999,
            grams: 10,
          })
        ).status,
      ).toBe(409);
      const draft = (await request(`/meal-plans/${v2.id}/duplicate`, "POST")).body;
      const draftMeal = draft.meals[0];
      expect(
        (
          await request(`/meal-plan-meals/${draftMeal.id}/items`, "POST", {
            foodId: foods.BRC0065J,
            quantity: 1,
            measureId: 99999999,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(`/meal-plan-meals/${draftMeal.id}/items`, "POST", {
            foodId: 99999999,
            grams: 10,
          })
        ).status,
      ).toBe(400);
      const performancePlan = (
        await request(`/nutritionist/patients/${patient.patientId}/meal-plans`, "POST", {
          title: "Plano 6 por 24",
        })
      ).body;
      for (let mealPosition = 0; mealPosition < 6; mealPosition++) {
        const meal = await db
          .prepare(
            "INSERT INTO meal_plan_meals(meal_plan_id,name,position) VALUES(?,?,?) RETURNING id",
          )
          .get<{ id: number }>(performancePlan.id, `Refeição ${mealPosition + 1}`, mealPosition);
        for (let itemPosition = 0; itemPosition < 4; itemPosition++)
          await db
            .prepare(
              "INSERT INTO meal_plan_items(meal_plan_meal_id,food_id,position,amount,unit,grams_equivalent) VALUES(?,?,?,100,'g',100)",
            )
            .run(
              meal!.id,
              [foods.BRC0018A, foods.BRC0001T, foods.BRC0023F, foods.BRC0030B][itemPosition],
              itemPosition,
            );
      }
      const started = performance.now();
      const realistic = await request(`/meal-plans/${performancePlan.id}`);
      const elapsed = performance.now() - started;
      expect(realistic.status).toBe(200);
      expect(realistic.body.meals).toHaveLength(6);
      expect(realistic.body.meals.flatMap((meal: any) => meal.items)).toHaveLength(24);
      expect(realistic.body.queryCount).toBe(6);
      expect(elapsed).toBeLessThan(2000);
      console.info(`[meal-plan-performance] meals=6 items=24 queries=${realistic.body.queryCount} latency_ms=${elapsed.toFixed(1)}`);
      const concurrentCopies = await Promise.all([
        request(`/meal-plans/${v2.id}/duplicate`, "POST"),
        request(`/meal-plans/${v2.id}/duplicate`, "POST"),
      ]);
      expect(concurrentCopies.map((copy) => copy.status)).toEqual([201, 201]);
      expect(new Set(concurrentCopies.map((copy) => copy.body.version)).size).toBe(2);
      const concurrentPublications = await Promise.all(
        concurrentCopies.map((copy) => request(`/meal-plans/${copy.body.id}/publish`, "POST")),
      );
      expect(concurrentPublications.map((publication) => publication.status)).toEqual([200, 200]);
      const concurrentStates = await db
        .prepare("SELECT status FROM meal_plans WHERE id=ANY(?) ORDER BY status")
        .all<{ status: string }>(concurrentCopies.map((copy) => copy.body.id));
      expect(concurrentStates.map((row) => row.status).sort()).toEqual(["active", "archived"]);
      expect(
        (await db
          .prepare("SELECT count(*)::int AS count FROM meal_plans WHERE patient_id=? AND status='active'")
          .get<{ count: number }>(patient.patientId))!.count,
      ).toBe(1);
      const activeAfterRace = (
        await request("/patient/meal-plan", "GET", undefined, tokens.patient)
      ).body;
      const editDraft = (await request(`/meal-plans/${activeAfterRace.id}/duplicate`, "POST")).body;
      const concurrentEdits = await Promise.all([
        request(`/meal-plans/${editDraft.id}`, "PATCH", {
          title: "Edição concorrente A",
          lockVersion: editDraft.lock_version,
        }),
        request(`/meal-plans/${editDraft.id}`, "PATCH", {
          title: "Edição concorrente B",
          lockVersion: editDraft.lock_version,
        }),
      ]);
      expect(concurrentEdits.map((edit) => edit.status).sort()).toEqual([200, 409]);
      expect(
        (await db
          .prepare(
            "SELECT count(*)::int AS count FROM meals m JOIN daily_logs dl ON dl.id=m.daily_log_id WHERE dl.patient_id=?",
          )
          .get<{ count: number }>(patient.patientId))!.count,
      ).toBe(0);
    } finally {
      for (const userId of userIds.reverse())
        await db.prepare("DELETE FROM users WHERE id=?").run(userId);
      await closeDatabase();
    }
  },
  60_000,
);

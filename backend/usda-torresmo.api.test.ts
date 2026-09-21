import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

it.skipIf(!process.env.NUTRI_MEASURE_TEST_API)(
  'API: pesquisa aliases e registra Torresmo USDA em gramas sem inventar medidas',
  async () => {
    const { db, closeDatabase, databaseInfo } = await import('./db');
    const { createSession } = await import('./auth');
    const base = process.env.NUTRI_MEASURE_TEST_API!;
    if (databaseInfo.host !== '127.0.0.1' || new URL(base).hostname !== '127.0.0.1') {
      throw new Error('Teste somente local.');
    }

    const tag = randomUUID();
    let userId: number | undefined;
    try {
      userId = (await db.prepare(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Teste Torresmo',?,'disabled','nutritionist') RETURNING id",
      ).get<{ id: number }>(`torresmo-test-${tag}@local.test`))!.id;
      await db.prepare('INSERT INTO patients(user_id,nutritionist_user_id) VALUES(?,?)').run(userId, userId);
      const session = await createSession(userId);

      async function request(path: string, method = 'GET', body?: unknown) {
        const response = await fetch(base + path, {
          method,
          headers: { Cookie: `nutri_session=${session.token}`, 'Content-Type': 'application/json' },
          body: body == null ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: response.status === 204 ? null : await response.json() };
      }

      const exact = await request('/foods?search=torresmo');
      expect(exact.status).toBe(200);
      expect(exact.body[0]).toEqual(expect.objectContaining({
        source: 'USDA',
        source_code: '167961',
        displayName: 'Torresmo',
      }));
      const foodId = exact.body[0].id as number;
      for (const alias of ['torresminho', 'pele de porco frita']) {
        const result = await request(`/foods?search=${encodeURIComponent(alias)}`);
        expect(result.status).toBe(200);
        expect(result.body[0]).toEqual(expect.objectContaining({ id: foodId, source: 'USDA' }));
      }

      const measures = await request(`/foods/${foodId}/measures`);
      expect(measures.status).toBe(200);
      expect(measures.body).toEqual([
        expect.objectContaining({ id: 0, kind: 'mass', name: 'g', source: 'SI' }),
      ]);

      const created = await request('/meals', 'POST', {
        date: '2026-09-20',
        mealType: 'lunch',
        items: [{ foodId, grams: 30 }],
      });
      expect(created.status).toBe(201);
      let entry = created.body.meals[0].entries[0];
      expect(entry).toEqual(expect.objectContaining({
        source: 'USDA',
        amount: 30,
        unit: 'g',
        grams_equivalent: 30,
        measure_snapshot: null,
      }));
      expect(entry.nutrients.energia_kcal).toBeCloseTo(163.2);
      expect(entry.nutrients.proteina_g).toBeCloseTo(18.39);
      expect(entry.nutrients.lipideos_g).toBeCloseTo(9.39);
      expect(entry.nutrientSources).toMatchObject({ energia_kcal: 'USDA', proteina_g: 'USDA', lipideos_g: 'USDA' });

      const edited = await request(`/meal-entries/${entry.id}`, 'PATCH', { grams: 50 });
      expect(edited.status).toBe(200);
      entry = edited.body.meals[0].entries[0];
      expect(entry).toEqual(expect.objectContaining({ amount: 50, unit: 'g', grams_equivalent: 50 }));
      expect(entry.nutrients.energia_kcal).toBeCloseTo(272);
      expect(entry.nutrients.proteina_g).toBeCloseTo(30.65);
      expect(entry.nutrients.lipideos_g).toBeCloseTo(15.65);
      expect((await request(`/meal-entries/${entry.id}`, 'DELETE')).status).toBe(204);
    } finally {
      if (userId) {
        await db.prepare('DELETE FROM patients WHERE user_id=?').run(userId);
        await db.prepare('DELETE FROM users WHERE id=?').run(userId);
      }
      await closeDatabase();
    }
  },
  30_000,
);

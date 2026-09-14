import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

it.skipIf(!process.env.NUTRI_MEAL_PLAN_TEST_API)('API: adherence is limited to the patient and linked nutritionist', async () => {
  const { db, closeDatabase, databaseInfo } = await import('./db');
  const { createSession } = await import('./auth');
  const base = process.env.NUTRI_MEAL_PLAN_TEST_API!;
  if (databaseInfo.host !== '127.0.0.1' || new URL(base).hostname !== '127.0.0.1') throw new Error('Teste somente local.');
  const tag = randomUUID(), userIds: number[] = [];
  try {
    async function user(role: 'nutritionist' | 'patient') {
      const row = await db.prepare('INSERT INTO users(name,email,password_hash,role,active) VALUES(?,?,?, ?,TRUE) RETURNING id').get<{ id: number }>(`Aderência ${role}`, `${tag}-${role}-${userIds.length}@local.test`, 'disabled', role);
      userIds.push(row!.id); return row!.id;
    }
    const nutritionist = await user('nutritionist'), outsider = await user('nutritionist'), patientUser = await user('patient');
    const patient = await db.prepare('INSERT INTO patients(user_id,nutritionist_user_id,height_cm) VALUES(?,?,170) RETURNING id').get<{ id: number }>(patientUser,nutritionist);
    const tokens = { nutritionist: (await createSession(nutritionist)).token, outsider: (await createSession(outsider)).token, patient: (await createSession(patientUser)).token };
    async function request(path: string, token: string) {
      const response = await fetch(base + path, { headers: { Cookie: `nutri_session=${token}` } });
      return { status: response.status, body: await response.json() };
    }
    const patientResult = await request('/patient/adherence?from=2026-09-01&to=2026-09-07', tokens.patient);
    expect(patientResult.status).toBe(200);
    expect(patientResult.body).toMatchObject({ version: 'plan-diary-adherence-v1', timezone: 'America/Sao_Paulo' });
    expect(patientResult.body).not.toHaveProperty('performance');
    expect((await request(`/nutritionist/patients/${patient!.id}/adherence?from=2026-09-01&to=2026-09-30`, tokens.nutritionist)).status).toBe(200);
    expect((await request(`/nutritionist/patients/${patient!.id}/adherence?from=2026-09-01&to=2026-09-30`, tokens.outsider)).status).toBe(404);
    expect((await request('/patient/adherence?from=2026-09-30&to=2026-09-01', tokens.patient)).status).toBe(400);
  } finally {
    for (const id of userIds.reverse()) await db.prepare('DELETE FROM users WHERE id=?').run(id);
    await closeDatabase();
  }
}, 20_000);

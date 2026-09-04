import { db, transaction } from './db';
import { hashPassword } from './auth';

async function addUser(name: string, email: string, password: string, role: 'admin' | 'nutritionist' | 'patient', canManage = false) {
  return (await db.prepare(`INSERT INTO users (name, email, password_hash, role, can_manage_nutrition_data, email_verified_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) RETURNING id`).get<{ id: number }>(name, email, hashPassword(password), role, canManage))!.id;
}

export async function seedDatabase() {
  const admin = await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get('admin@local.test');
  if (!admin) await addUser('Administrador Nutri+', 'admin@local.test', 'Admin123!', 'admin');
  const existing = await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get('nutri@local.test');
  if (existing) return { seeded: false };
  return transaction(async () => {
    const nutritionistId = await addUser('Dr. Carlos Teste', 'nutri@local.test', 'Nutri123!', 'nutritionist', true);
    const joaoUserId = await addUser('João Silva', 'joao@local.test', 'Paciente123!', 'patient');
    const mariaUserId = await addUser('Maria Santos', 'maria@local.test', 'Paciente123!', 'patient');
    const joao = await db.prepare(`INSERT INTO patients (user_id, nutritionist_user_id, birth_date, sex, height_cm, activity_level, objective, target_weight_kg, food_preferences, food_restrictions, allergies, meal_routine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get<{ id: number }>(joaoUserId, nutritionistId, '1991-05-18', 'male', 180, 'moderate', 'Redução gradual de gordura com preservação de massa muscular', 76, 'Comida caseira', 'Nenhuma', 'Nenhuma conhecida', 'Quatro refeições por dia');
    const maria = await db.prepare(`INSERT INTO patients (user_id, nutritionist_user_id, birth_date, sex, height_cm, activity_level, objective, target_weight_kg, food_preferences, food_restrictions, allergies, meal_routine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get<{ id: number }>(mariaUserId, nutritionistId, '1987-10-03', 'female', 164, 'light', 'Melhorar regularidade alimentar', 62, 'Frutas e preparações simples', 'Baixa lactose', 'Nenhuma conhecida', 'Três a quatro refeições por dia');
    await db.prepare(`INSERT INTO weight_history (patient_id, weighed_at, weight_kg, recorded_by) VALUES (?, ?, ?, ?), (?, ?, ?, ?)`).run(joao!.id, '2026-08-31', 80, joaoUserId, maria!.id, '2026-08-31', 65.4, mariaUserId);
    await db.prepare(`INSERT INTO nutrition_goals (patient_id, valid_from, energy_kcal, protein_g, protein_gkg_min, protein_gkg_max, carbohydrate_g, fat_g, fiber_g, water_ml, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(joao!.id, '2026-08-01', 2200, 144, 1.6, 2, 240, 65, 30, 2500, nutritionistId, maria!.id, '2026-08-01', 1850, 105, 1.4, 1.8, 210, 60, 28, 2200, nutritionistId);
    return { seeded: true };
  });
}

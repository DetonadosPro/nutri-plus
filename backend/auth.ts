import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';

const SESSION_DAYS = 14;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, expectedHex] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createAccountToken() {
  return randomBytes(32).toString('base64url');
}

export function createActivationCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizeActivationCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expires.toISOString());
  return { token, expires };
}

export async function deleteSession(token: string | undefined) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export type AuthUser = { id: number; name: string; email: string; role: 'admin' | 'nutritionist' | 'patient'; canManageNutritionData: boolean };

export async function userForSession(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const user = await db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.can_manage_nutrition_data AS "canManageNutritionData"
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.active = TRUE
  `).get<AuthUser>(tokenHash(token));
  return user ? { ...user, canManageNutritionData: Boolean(user.canManageNutritionData) } : null;
}

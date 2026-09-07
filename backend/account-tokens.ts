import { db, transaction } from './db';
import { tokenHash } from './auth';

export type AccountTokenPurpose = 'activation' | 'email_verification' | 'password_reset';
type AccountToken = { id: number; userId: number; name: string; email: string | null; role: 'patient' | 'nutritionist' };
export class AccountTokenError extends Error {
  constructor() { super('Código ou link inválido, expirado ou já utilizado.'); }
}

export async function saveAccountToken(userId: number, purpose: AccountTokenPurpose, rawToken: string, expiresInHours: number, createdBy?: number) {
  return transaction(async () => {
    // Serialize issuance and consumption for the same account in the same lock order.
    await db.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(userId);
    await db.prepare('UPDATE account_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(userId, purpose);
    await db.prepare('INSERT INTO account_tokens (user_id, purpose, token_hash, expires_at, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(userId, purpose, tokenHash(rawToken), new Date(Date.now() + expiresInHours * 3_600_000).toISOString(), createdBy ?? null);
  });
}

export async function validAccountToken(rawToken: string, purpose: AccountTokenPurpose) {
  return db.prepare(`SELECT at.id, at.user_id AS "userId", u.name, u.email, u.role
    FROM account_tokens at JOIN users u ON u.id = at.user_id
    WHERE at.token_hash = ? AND at.purpose = ? AND at.used_at IS NULL
      AND at.expires_at > CURRENT_TIMESTAMP AND u.suspended_at IS NULL
      AND u.role IN ('patient', 'nutritionist')`).get<AccountToken>(tokenHash(rawToken), purpose);
}

export async function withAccountToken<T>(rawToken: string, purpose: AccountTokenPurpose, action: (account: AccountToken) => Promise<T>): Promise<T> {
  return transaction(async () => {
    await db.prepare(`SELECT u.id FROM users u JOIN account_tokens at ON at.user_id=u.id
      WHERE at.token_hash=? AND at.purpose=? FOR UPDATE OF u`).get(tokenHash(rawToken), purpose);
    const account = await db.prepare(`UPDATE account_tokens at SET used_at=CURRENT_TIMESTAMP
      FROM users u WHERE u.id=at.user_id AND at.token_hash=? AND at.purpose=?
      AND at.used_at IS NULL AND at.expires_at>CURRENT_TIMESTAMP AND u.suspended_at IS NULL
      AND u.role IN ('patient', 'nutritionist')
      AND (? <> 'password_reset' OR (u.active=TRUE AND u.email_verified_at IS NOT NULL))
      RETURNING at.id, at.user_id AS "userId", u.name, u.email, u.role`)
      .get<AccountToken>(tokenHash(rawToken), purpose, purpose);
    if (!account) throw new AccountTokenError();
    return action(account);
  });
}

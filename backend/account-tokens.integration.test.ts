import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Explicit opt-in; creates and removes only a unique schema on a local database.
const enabled = process.env.NUTRI_RUN_DB_SECURITY_TESTS === 'true';
describe.skipIf(!enabled)('account tokens with concurrent PostgreSQL connections', () => {
  const schema = `nutri_security_test_${randomUUID().replaceAll('-', '')}`;
  let root: pg.Pool;
  let database: typeof import('./db');
  let tokens: typeof import('./account-tokens');
  let userId: number;
  beforeAll(async () => {
    if (existsSync('../.env.local')) loadEnvFile('../.env.local');
    const url = new URL(process.env.DATABASE_URL || process.env.DATABASE_URL_DEV || '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || process.env.NUTRI_ENV === 'production' || process.env.NUTRI_AWS_SECRET_ID) throw new Error('Security tests require an isolated local database.');
    root = new pg.Pool({ connectionString: url.toString() });
    await root.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    vi.stubEnv('DATABASE_URL', url.toString());
    vi.stubEnv('NUTRI_ENV', 'test');
    database = await import('./db');
    await database.migrate();
    tokens = await import('./account-tokens');
    userId = (await database.db.prepare("INSERT INTO users(name,email,role,email_verified_at) VALUES ('Test','security-test@local.test','patient',CURRENT_TIMESTAMP) RETURNING id").get<{ id: number }>())!.id;
  });
  afterAll(async () => {
    if (database) await database.closeDatabase();
    if (root) { await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await root.end(); }
    vi.unstubAllEnvs();
  });
  it('allows exactly one concurrent consumer', async () => {
    await tokens.saveAccountToken(userId, 'password_reset', 'concurrent-token', 1);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => tokens.withAccountToken('concurrent-token', 'password_reset', async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return 'consumed';
    })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
  });
  it('rolls back token consumption if the account update fails', async () => {
    await tokens.saveAccountToken(userId, 'password_reset', 'rollback-token', 1);
    await expect(tokens.withAccountToken('rollback-token', 'password_reset', async () => { throw new Error('update failed'); })).rejects.toThrow('update failed');
    expect(await tokens.withAccountToken('rollback-token', 'password_reset', async () => 'ok')).toBe('ok');
  });
  it('invalidates previous tokens and rejects the wrong purpose', async () => {
    await tokens.saveAccountToken(userId, 'activation', 'old-token', 1);
    await tokens.saveAccountToken(userId, 'activation', 'new-token', 1);
    await expect(tokens.withAccountToken('old-token', 'activation', async () => true)).rejects.toThrow();
    await expect(tokens.withAccountToken('new-token', 'password_reset', async () => true)).rejects.toThrow();
    expect(await tokens.withAccountToken('new-token', 'activation', async () => true)).toBe(true);
  });
  it('rejects expired tokens and suspended accounts', async () => {
    await tokens.saveAccountToken(userId, 'email_verification', 'expired-token', -1);
    await expect(tokens.withAccountToken('expired-token', 'email_verification', async () => true)).rejects.toThrow();
    await tokens.saveAccountToken(userId, 'email_verification', 'suspended-token', 1);
    await database.db.prepare('UPDATE users SET suspended_at=CURRENT_TIMESTAMP WHERE id=?').run(userId);
    await expect(tokens.withAccountToken('suspended-token', 'email_verification', async () => true)).rejects.toThrow();
  });
});

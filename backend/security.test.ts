import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { authenticationLimits, configureSecurity, sessionCookieOptions } from './security';
import { mailDeliveryResult, securityPolicy } from './security-policy';
import { loadApplicationSecrets } from './secrets';
import { hashPassword, verifyPassword } from './password';
import { scryptSync } from 'node:crypto';

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

describe('production authentication protections', () => {
  it('never enables previews or demo seeding in production, even with local flags', () => {
    const policy = securityPolicy({ NUTRI_ENV: 'production', NUTRI_ALLOW_EMAIL_PREVIEW: 'true', NUTRI_ALLOW_DEMO_SEED: 'true' });
    expect(policy).toMatchObject({ allowEmailPreview: false, allowDemoSeed: false, cookieSecure: true });
    expect(sessionCookieOptions(policy)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict' });
    expect(JSON.stringify(mailDeliveryResult(false, 'https://example.test/?reset=SECRET', 'ok', policy.allowEmailPreview))).not.toContain('SECRET');
  });
  it('requires explicit permission for local previews', () => {
    expect(securityPolicy({}).allowEmailPreview).toBe(false);
    const policy = securityPolicy({ NUTRI_ENV: 'development', NUTRI_ALLOW_EMAIL_PREVIEW: 'true' });
    expect(mailDeliveryResult(false, '/?verify=local-token', 'ok', policy.allowEmailPreview).previewUrl).toBe('/?verify=local-token');
    expect(securityPolicy({ NODE_ENV: 'production', NUTRI_ENV: 'development', NUTRI_ALLOW_EMAIL_PREVIEW: 'true' }).allowEmailPreview).toBe(false);
  });
  it('accepts existing scrypt hashes without requiring password changes', async () => {
    const salt = '01'.repeat(16);
    const legacy = `scrypt:${salt}:${scryptSync('Test-password-123', salt, 64).toString('hex')}`;
    expect(await verifyPassword('Test-password-123', legacy)).toBe(true);
    expect(await verifyPassword('wrong-password', legacy)).toBe(false);
    expect(await verifyPassword('anything', 'scrypt:bad:bad')).toBe(false);
    expect(await verifyPassword('anything', null)).toBe(false);
    expect(await verifyPassword('New-password-123', await hashPassword('New-password-123'))).toBe(true);
  });
  it('blocks repeated attempts for an account across IPs and rejects foreign origins', async () => {
    const app = express();
    configureSecurity(app, true, 'https://nutri.example');
    app.use(express.json());
    app.post('/api/auth/login', ...authenticationLimits({ accountLimit: 2, ipLimit: 10 }), (_req, res) => res.sendStatus(401));
    const server = app.listen(0, '127.0.0.1'); servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error();
    const url = `http://127.0.0.1:${address.port}/api/auth/login`;
    const attempt = (email: string, ip: string, origin = 'https://nutri.example') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, Origin: origin }, body: JSON.stringify({ email }) });
    expect((await attempt('test@example.test', '192.0.2.1')).status).toBe(401);
    expect((await attempt('TEST@example.test', '192.0.2.2')).status).toBe(401);
    const blocked = await attempt('test@example.test', '192.0.2.3');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect((await attempt('other@example.test', '192.0.2.4')).status).toBe(401);
    expect((await attempt('other@example.test', '192.0.2.4', 'https://foreign.example')).status).toBe(403);
  });
});

describe('Secrets Manager bootstrap', () => {
  it('keeps the local environment and does not call AWS without a secret id', async () => {
    const env = { DATABASE_URL: 'postgresql://local/db' };
    expect(await loadApplicationSecrets(env, async () => { throw new Error('must not run'); })).toEqual(env);
  });
  it('uses the retrieved credentials before the pool and preserves non-secret settings', async () => {
    const env = { NUTRI_AWS_SECRET_ID: 'nutriplus/production/application', AWS_REGION: 'sa-east-1', DATABASE_URL: 'old', NUTRI_SMTP_HOST: 'smtp.example' };
    const result = await loadApplicationSecrets(env, async (id, region) => {
      expect(id).toBe(env.NUTRI_AWS_SECRET_ID); expect(region).toBe('sa-east-1');
      return JSON.stringify({ DATABASE_URL: 'postgresql://new/db', NUTRI_SMTP_USER: 'user', NUTRI_SMTP_PASSWORD: 'secret' });
    });
    expect(result.DATABASE_URL).toBe('postgresql://new/db');
    expect(result.NUTRI_SMTP_HOST).toBe('smtp.example');
    expect(env.DATABASE_URL).toBe('old');
  });
  it('fails closed without exposing the SDK error or falling back to old credentials', async () => {
    await expect(loadApplicationSecrets({ NUTRI_AWS_SECRET_ID: 'test', DATABASE_URL: 'old' }, async () => { throw new Error('PRIVATE_VALUE'); })).rejects.toThrow('configuração obrigatória');
    for (const value of ['{}', 'null', '{"DATABASE_URL":"db","NUTRI_ENV":"development"}', '{"DATABASE_URL":12}', '{"DATABASE_URL":"db"}']) {
      await expect(loadApplicationSecrets({ NUTRI_AWS_SECRET_ID: 'test', NUTRI_SMTP_HOST: 'smtp' }, async () => value)).rejects.toThrow('configuração obrigatória');
    }
  });
});

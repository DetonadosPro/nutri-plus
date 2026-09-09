import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { loadApplicationSecrets } from './secrets';
import { securityPolicy } from './security-policy';

const backendDir = dirname(fileURLToPath(import.meta.url));
const projectDir = join(backendDir, '..');
const envFile = join(projectDir, '.env.local');

if (existsSync(envFile)) loadEnvFile(envFile);
const env = await loadApplicationSecrets(process.env);
const security = securityPolicy(env);
if (security.production && !env.NUTRI_APP_URL?.startsWith('https://')) {
  throw new Error('NUTRI_APP_URL deve usar HTTPS em produção.');
}

function required(name: string, legacyName?: string) {
  const value = env[name] || (legacyName ? env[legacyName] : undefined);
  if (!value) {
    const legacyHint = legacyName ? ` (ou ${legacyName}, temporariamente)` : '';
    throw new Error(`${name} não configurada${legacyHint}.`);
  }
  return value;
}

function enabled(name: string) {
  return ['1', 'true', 'yes'].includes((env[name] || '').toLowerCase());
}

export const appConfig = {
  environment: env.NUTRI_ENV || env.NODE_ENV || 'development',
  security,
  secretsSource: env.NUTRI_AWS_SECRET_ID ? 'aws-secrets-manager' : 'environment',
  release: env.NUTRI_RELEASE || 'development',
  apiPort: Number(env.NUTRI_API_PORT || 3001),
  apiHost: env.NUTRI_API_HOST || (security.production ? '127.0.0.1' : '0.0.0.0'),
  appUrl: env.NUTRI_APP_URL?.replace(/\/$/, ''),
  database: {
    url: required('DATABASE_URL', 'DATABASE_URL_DEV'),
    allowRemote: enabled('NUTRI_ALLOW_REMOTE_DATABASE'),
  },
  vision: {
    // The fast path avoids one extra model request for every ambiguous item.
    rerankEnabled: enabled('NUTRI_VISION_RERANK_ENABLED'),
  },
  email: {
    host: env.NUTRI_SMTP_HOST,
    port: Number(env.NUTRI_SMTP_PORT || 587),
    user: env.NUTRI_SMTP_USER,
    password: env.NUTRI_SMTP_PASSWORD,
    from: env.NUTRI_EMAIL_FROM,
    replyTo: env.NUTRI_EMAIL_REPLY_TO,
  },
} as const;

export { projectDir };

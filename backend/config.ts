import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const backendDir = dirname(fileURLToPath(import.meta.url));
const projectDir = join(backendDir, '..');
const envFile = join(projectDir, '.env.local');

if (existsSync(envFile)) loadEnvFile(envFile);

function required(name: string, legacyName?: string) {
  const value = process.env[name] || (legacyName ? process.env[legacyName] : undefined);
  if (!value) {
    const legacyHint = legacyName ? ` (ou ${legacyName}, temporariamente)` : '';
    throw new Error(`${name} não configurada${legacyHint}.`);
  }
  return value;
}

function enabled(name: string) {
  return ['1', 'true', 'yes'].includes((process.env[name] || '').toLowerCase());
}

export const appConfig = {
  environment: process.env.NUTRI_ENV || process.env.NODE_ENV || 'development',
  apiPort: Number(process.env.NUTRI_API_PORT || 3001),
  appUrl: process.env.NUTRI_APP_URL?.replace(/\/$/, ''),
  portalUrls: {
    patient: (process.env.NUTRI_PATIENT_URL || process.env.NUTRI_APP_URL)?.replace(/\/$/, ''),
    nutritionist: process.env.NUTRI_NUTRITIONIST_URL?.replace(/\/$/, ''),
    admin: process.env.NUTRI_ADMIN_URL?.replace(/\/$/, ''),
  },
  database: {
    url: required('DATABASE_URL', 'DATABASE_URL_DEV'),
    allowRemote: enabled('NUTRI_ALLOW_REMOTE_DATABASE'),
  },
  email: {
    host: process.env.NUTRI_SMTP_HOST,
    port: Number(process.env.NUTRI_SMTP_PORT || 587),
    user: process.env.NUTRI_SMTP_USER,
    password: process.env.NUTRI_SMTP_PASSWORD,
    from: process.env.NUTRI_EMAIL_FROM,
    replyTo: process.env.NUTRI_EMAIL_REPLY_TO,
  },
} as const;

export { projectDir };

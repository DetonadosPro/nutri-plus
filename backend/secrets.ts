import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

type Environment = Record<string, string | undefined>;
export type SecretReader = (id: string, region: string) => Promise<string | undefined>;
const allowedKeys = new Set(['DATABASE_URL', 'NUTRI_SMTP_USER', 'NUTRI_SMTP_PASSWORD']);

async function readAwsSecret(id: string, region: string) {
  const client = new SecretsManagerClient({ region, maxAttempts: 3 });
  try {
    const result = await client.send(new GetSecretValueCommand({ SecretId: id }), {
      abortSignal: AbortSignal.timeout(15_000),
    });
    return result.SecretString;
  } finally {
    client.destroy();
  }
}

// Loaded once before the database pool and mail transport are constructed.
// Credential discovery supports AWS_PROFILE and temporary credential providers.
export async function loadApplicationSecrets(env: Environment, read: SecretReader = readAwsSecret): Promise<Environment> {
  if (!env.NUTRI_AWS_SECRET_ID) return { ...env };
  try {
    const raw = await read(env.NUTRI_AWS_SECRET_ID, env.AWS_REGION || 'sa-east-1');
    const values: unknown = JSON.parse(raw || 'null');
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error();
    const secret = values as Record<string, unknown>;
    if (!Object.keys(secret).length || Object.entries(secret).some(([key, value]) => !allowedKeys.has(key) || typeof value !== 'string' || !value.trim())) throw new Error();
    if (typeof secret.DATABASE_URL !== 'string') throw new Error();
    if (env.NUTRI_SMTP_HOST && (!secret.NUTRI_SMTP_USER || !secret.NUTRI_SMTP_PASSWORD)) throw new Error();
    return { ...env, ...secret } as Environment;
  } catch {
    // Do not print SDK responses, secret values or a fallback connection string.
    throw new Error('Não foi possível carregar a configuração obrigatória do Secrets Manager.');
  }
}

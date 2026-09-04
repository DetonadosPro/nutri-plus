import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { appConfig } from './config';

const serverDir = dirname(fileURLToPath(import.meta.url));
const projectDir = serverDir;
const connectionString = appConfig.database.url;

const parsedUrl = new URL(connectionString);
const databaseName = parsedUrl.pathname.replace(/^\//, '');
const localDatabase = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
  throw new Error('DATABASE_URL deve apontar para um banco PostgreSQL.');
}
if ((!localDatabase && !appConfig.database.allowRemote) || !databaseName || ['postgres', 'template0', 'template1'].includes(databaseName)) {
  throw new Error('Conexão recusada: use um PostgreSQL dedicado. Para um host não local, defina NUTRI_ALLOW_REMOTE_DATABASE=true explicitamente.');
}

pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);
pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(1114, (value) => value);
pg.types.setTypeParser(1184, (value) => value);

export const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
const transactionClient = new AsyncLocalStorage<PoolClient>();

function placeholders(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function query<T extends QueryResultRow = QueryResultRow>(sql: string, parameters: unknown[] = []) {
  const executor = transactionClient.getStore() ?? pool;
  return executor.query<T>(placeholders(sql), parameters);
}

export const db = {
  prepare(sql: string) {
    return {
      async get<T extends QueryResultRow = QueryResultRow>(...parameters: unknown[]) {
        return (await query<T>(sql, parameters)).rows[0] as T | undefined;
      },
      async all<T extends QueryResultRow = QueryResultRow>(...parameters: unknown[]) {
        return (await query<T>(sql, parameters)).rows;
      },
      async run(...parameters: unknown[]) {
        const result = await query(sql, parameters);
        return { changes: result.rowCount ?? 0, lastInsertRowid: (result.rows[0] as { id?: number } | undefined)?.id ?? null };
      },
    };
  },
  async exec(sql: string) {
    const executor = transactionClient.getStore() ?? pool;
    return executor.query(sql);
  },
};

export async function migrate() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const migrationDir = join(serverDir, 'migrations', 'postgres');
  const files = readdirSync(migrationDir).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const exists = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (exists.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(migrationDir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function transaction<T>(callback: () => Promise<T> | T): Promise<T> {
  if (transactionClient.getStore()) return callback();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await transactionClient.run(client, callback);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function projectPath(...parts: string[]) {
  return join(projectDir, ...parts);
}

export async function closeDatabase() {
  await pool.end();
}

export const databaseInfo = { engine: 'postgresql', host: parsedUrl.hostname, database: databaseName };

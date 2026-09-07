import { closeDatabase, databaseInfo, migrate } from './db';
import { seedDatabase } from './seed';
import { appConfig } from './config';

try {
  if (!appConfig.security.allowDemoSeed) throw new Error('Inicialização de demonstração bloqueada neste ambiente.');
  await migrate();
  const seed = await seedDatabase();
  console.log(JSON.stringify({ database: databaseInfo, seed }, null, 2));
} finally {
  await closeDatabase();
}

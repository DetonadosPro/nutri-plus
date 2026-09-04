import { closeDatabase, databaseInfo, migrate } from './db';
import { seedDatabase } from './seed';

try {
  await migrate();
  const seed = await seedDatabase();
  console.log(JSON.stringify({ database: databaseInfo, seed }, null, 2));
} finally {
  await closeDatabase();
}
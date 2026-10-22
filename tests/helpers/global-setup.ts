import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb } from '../../src/db/client.js';
import { testEnv } from './env.js';

export async function setup(): Promise<void> {
  const { db, pool } = createDb(testEnv().DATABASE_URL);
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
  } finally {
    await pool.end();
  }
}

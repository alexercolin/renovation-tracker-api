import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { loadEnv } from '../config/env.js';
import { createDb } from './client.js';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);

try {
  await migrate(db, { migrationsFolder: 'drizzle' });
  console.log('migrations applied');
} finally {
  await pool.end();
}

import { loadEnv } from '../config/env.js';
import { createDb } from './client.js';
import { seedDatabase, seedUsers } from './seed-data.js';

const env = loadEnv();
const { db, pool } = createDb(env.DATABASE_URL);

try {
  await seedDatabase(db);
  console.log(`seeded ${seedUsers.length} users`);
} finally {
  await pool.end();
}

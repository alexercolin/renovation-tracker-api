import pino, { type Logger } from 'pino';

import { type Env } from './config/env.js';
import { createDb, type Db } from './db/client.js';

export interface Container {
  env: Env;
  logger: Logger;
  db: Db;
  close(): Promise<void>;
}

export function createContainer(env: Env): Container {
  const logger = pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  });
  const { db, pool } = createDb(env.DATABASE_URL);

  return {
    env,
    logger,
    db,
    async close() {
      await pool.end();
    },
  };
}

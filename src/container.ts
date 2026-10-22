import pino, { type Logger } from 'pino';

import { type Env } from './config/env.js';
import { createDb, type Db } from './db/client.js';
import { AuthService } from './modules/auth/auth.service.js';
import { JobsRepository } from './modules/jobs/jobs.repository.js';
import { JobsService } from './modules/jobs/jobs.service.js';
import { UsersRepository } from './modules/users/users.repository.js';
import { UsersService } from './modules/users/users.service.js';

export interface Container {
  env: Env;
  logger: Logger;
  db: Db;
  repositories: {
    users: UsersRepository;
    jobs: JobsRepository;
  };
  services: {
    users: UsersService;
    auth: AuthService;
    jobs: JobsService;
  };
  close(): Promise<void>;
}

export function createContainer(env: Env): Container {
  const logger = pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  });
  const { db, pool } = createDb(env.DATABASE_URL);

  const repositories = {
    users: new UsersRepository(),
    jobs: new JobsRepository(),
  };

  const services = {
    users: new UsersService(db, repositories.users),
    auth: new AuthService(db, repositories.users, {
      jwtSecret: env.JWT_SECRET,
      jwtExpiresIn: env.JWT_EXPIRES_IN,
    }),
    jobs: new JobsService(db, repositories.jobs, repositories.users),
  };

  return {
    env,
    logger,
    db,
    repositories,
    services,
    async close() {
      await pool.end();
    },
  };
}

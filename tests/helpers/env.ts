import { existsSync } from 'node:fs';

import { type Env, loadEnv } from '../../src/config/env.js';

const TEST_DATABASE_URL = 'postgres://app:app@localhost:5432/renovation_test';

export function testEnv(): Env {
  if (existsSync('.env')) process.loadEnvFile('.env');

  return loadEnv({
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'integration-test-secret-change-me',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_ENDPOINT_URL: 'http://localhost:4566',
    SQS_REPORTS_QUEUE_URL: 'http://localhost:4566/000000000000/reports',
    S3_REPORTS_BUCKET: 'reports',
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? TEST_DATABASE_URL,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
}

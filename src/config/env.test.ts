import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgres://app:app@localhost:5432/renovation',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-secret-long-enough-for-tests',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  SQS_REPORTS_QUEUE_URL: 'http://localhost:4566/000000000000/reports',
  S3_REPORTS_BUCKET: 'reports',
};

describe('loadEnv', () => {
  it('applies defaults for optional settings', () => {
    const env = loadEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.AWS_REGION).toBe('us-east-1');
    expect(env.AWS_ENDPOINT_URL).toBeUndefined();
  });

  it('coerces numeric strings', () => {
    expect(loadEnv({ ...validEnv, PORT: '5055' }).PORT).toBe(5055);
  });

  it('reports every missing or invalid variable at once', () => {
    const { DATABASE_URL: _db, JWT_SECRET: _jwt, ...incomplete } = validEnv;

    let message = '';
    try {
      loadEnv({ ...incomplete, PORT: 'not-a-number' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/^Invalid environment:/);
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('PORT');
  });
});

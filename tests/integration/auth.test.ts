import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../helpers/app.js';

const CONTRACTOR = 'alice@contractor.test';

describe('authentication', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
    await app.resetDatabase();
  });

  afterAll(() => app.close());

  it('serves the health query without authentication', async () => {
    const result = await app.graphql<{ health: string }>('{ health }');

    expect(result.errors).toBeUndefined();
    expect(result.data?.health).toBe('ok');
  });

  it('logs a seeded user in and returns a usable token', async () => {
    const login = await app.graphql<{
      login: { token: string; user: { email: string; role: string } };
    }>(
      'mutation { login(email: "alice@contractor.test", password: "contractor123") { token user { email role } } }',
    );

    expect(login.errors).toBeUndefined();
    expect(login.data?.login.user).toEqual({ email: CONTRACTOR, role: 'CONTRACTOR' });

    const me = await app.graphql<{ me: { email: string; name: string } }>('{ me { email name } }', {
      token: login.data?.login.token,
    });

    expect(me.data?.me).toEqual({ email: CONTRACTOR, name: 'Alice Contractor' });
  });

  it('rejects a wrong password with UNAUTHENTICATED and no data', async () => {
    const result = await app.graphql(
      'mutation { login(email: "alice@contractor.test", password: "wrong") { token } }',
    );

    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    expect(result.errors?.[0]?.message).toBe('Invalid email or password');
  });

  it('rejects invalid login input with VALIDATION and the offending field', async () => {
    const result = await app.graphql(
      'mutation { login(email: "not-an-email", password: "x") { token } }',
    );

    expect(result.errors?.[0]?.extensions?.code).toBe('VALIDATION');
    expect(result.errors?.[0]?.extensions?.issues).toEqual([
      expect.objectContaining({ path: 'email' }),
    ]);
  });

  it('requires authentication for me', async () => {
    const result = await app.graphql('{ me { id } }');

    expect(result.data).toBeNull();
    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed Authorization header and a bad token', async () => {
    const malformed = await app.graphql('{ me { id } }', {
      headers: { authorization: 'Token abc' },
    });
    const invalid = await app.graphql('{ me { id } }', { token: 'not.a.jwt' });

    expect(malformed.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    expect(invalid.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });
});

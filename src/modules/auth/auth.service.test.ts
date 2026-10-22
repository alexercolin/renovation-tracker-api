import { hash } from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { type Db } from '../../db/client.js';
import { UnauthenticatedError, ValidationError } from '../../shared/errors.js';
import { FakeUsersRepository, userRow } from '../users/users.repository.fake.js';
import { AuthService } from './auth.service.js';

const noDb = {} as Db;
const config = { jwtSecret: 'unit-test-secret-with-enough-length', jwtExpiresIn: '1h' };

describe('AuthService', () => {
  let service: AuthService;

  beforeAll(async () => {
    const alice = userRow({
      id: 'u-alice',
      email: 'alice@contractor.test',
      passwordHash: await hash('contractor123', 4),
    });
    service = new AuthService(noDb, new FakeUsersRepository([alice]), config);
  });

  it('returns a token and the user for valid credentials', async () => {
    const result = await service.login({
      email: 'alice@contractor.test',
      password: 'contractor123',
    });

    expect(result.user).toMatchObject({ id: 'u-alice', role: 'CONTRACTOR' });
    await expect(service.verifyToken(result.token)).resolves.toEqual({
      id: 'u-alice',
      role: 'CONTRACTOR',
    });
  });

  it('normalises the email before looking it up', async () => {
    const result = await service.login({
      email: '  Alice@Contractor.TEST ',
      password: 'contractor123',
    });

    expect(result.user.id).toBe('u-alice');
  });

  it('rejects an unknown email and a wrong password with the same message', async () => {
    const unknown = service.login({ email: 'nobody@example.test', password: 'contractor123' });
    const wrong = service.login({ email: 'alice@contractor.test', password: 'nope' });

    await expect(unknown).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(wrong).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(unknown).rejects.toThrow('Invalid email or password');
    await expect(wrong).rejects.toThrow('Invalid email or password');
  });

  it('rejects malformed input before touching the repository', async () => {
    await expect(service.login({ email: 'not-an-email', password: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a tampered token', async () => {
    const { token } = await service.login({
      email: 'alice@contractor.test',
      password: 'contractor123',
    });
    const tampered = `${token.slice(0, -2)}xx`;

    await expect(service.verifyToken(tampered)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects a token signed with another secret', async () => {
    const other = new AuthService(noDb, new FakeUsersRepository(), {
      ...config,
      jwtSecret: 'a-different-secret-with-enough-length',
    });
    const token = await other.issueToken({ id: 'u-alice', role: 'CONTRACTOR' });

    await expect(service.verifyToken(token)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('rejects an expired token', async () => {
    const shortLived = new AuthService(noDb, new FakeUsersRepository(), {
      ...config,
      jwtExpiresIn: '-1s',
    });
    const token = await shortLived.issueToken({ id: 'u-alice', role: 'CONTRACTOR' });

    await expect(service.verifyToken(token)).rejects.toThrow('Invalid or expired token');
  });
});

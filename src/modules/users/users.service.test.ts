import { describe, expect, it } from 'vitest';

import { type Db } from '../../db/client.js';
import { NotFoundError } from '../../shared/errors.js';
import { FakeUsersRepository, userRow } from './users.repository.fake.js';
import { UsersService } from './users.service.js';

const noDb = {} as Db;

describe('UsersService', () => {
  const alice = userRow({ id: 'u-alice', email: 'alice@contractor.test', name: 'Alice' });
  const bob = userRow({ id: 'u-bob', email: 'bob@homeowner.test', role: 'HOMEOWNER' });
  const service = new UsersService(noDb, new FakeUsersRepository([alice, bob]));

  it('maps a row to the public user shape', async () => {
    await expect(service.getById('u-alice')).resolves.toEqual({
      id: 'u-alice',
      email: 'alice@contractor.test',
      name: 'Alice',
      role: 'CONTRACTOR',
    });
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(service.getById('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns a map keyed by id for batch lookups', async () => {
    const found = await service.findManyByIds(['u-bob', 'missing', 'u-alice']);

    expect([...found.keys()].sort()).toEqual(['u-alice', 'u-bob']);
    expect(found.get('u-bob')?.role).toBe('HOMEOWNER');
  });
});

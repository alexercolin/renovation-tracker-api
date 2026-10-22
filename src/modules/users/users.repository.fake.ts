import { type DbExecutor } from '../../db/client.js';
import { type UserRow } from '../../db/schema/index.js';
import { type UsersRepository } from './users.repository.js';

export class FakeUsersRepository implements UsersRepository {
  private readonly rows = new Map<string, UserRow>();

  constructor(rows: readonly UserRow[] = []) {
    for (const row of rows) this.rows.set(row.id, row);
  }

  findById(_db: DbExecutor, id: string): Promise<UserRow | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  findByEmail(_db: DbExecutor, email: string): Promise<UserRow | undefined> {
    return Promise.resolve([...this.rows.values()].find((row) => row.email === email));
  }

  findManyByIds(_db: DbExecutor, ids: readonly string[]): Promise<UserRow[]> {
    return Promise.resolve(ids.flatMap((id) => this.rows.get(id) ?? []));
  }
}

export function userRow(overrides: Partial<UserRow> & Pick<UserRow, 'id' | 'email'>): UserRow {
  return {
    name: 'Test User',
    role: 'CONTRACTOR',
    passwordHash: '',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

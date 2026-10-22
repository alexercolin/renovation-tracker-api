import { type Db } from '../../db/client.js';
import { type UserRole, type UserRow } from '../../db/schema/index.js';
import { NotFoundError } from '../../shared/errors.js';
import { type UsersRepository } from './users.repository.js';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export class UsersService {
  constructor(
    private readonly db: Db,
    private readonly usersRepository: UsersRepository,
  ) {}

  async getById(id: string): Promise<User> {
    const row = await this.usersRepository.findById(this.db, id);
    if (!row) throw new NotFoundError('User', id);
    return toUser(row);
  }

  async findManyByIds(ids: readonly string[]): Promise<Map<string, User>> {
    const rows = await this.usersRepository.findManyByIds(this.db, ids);
    return new Map(rows.map((row) => [row.id, toUser(row)]));
  }
}

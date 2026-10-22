import { eq, inArray } from 'drizzle-orm';

import { type DbExecutor } from '../../db/client.js';
import { type UserRow, users } from '../../db/schema/index.js';

export class UsersRepository {
  async findById(db: DbExecutor, id: string): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  async findByEmail(db: DbExecutor, email: string): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  }

  async findManyByIds(db: DbExecutor, ids: readonly string[]): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(users)
      .where(inArray(users.id, [...ids]));
  }
}

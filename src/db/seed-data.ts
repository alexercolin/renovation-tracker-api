import { hash } from 'bcryptjs';

import { type Db } from './client.js';
import { type UserRole, users } from './schema/index.js';

export interface SeedUser {
  email: string;
  name: string;
  role: UserRole;
  password: string;
}

export const seedUsers: readonly SeedUser[] = [
  {
    email: 'alice@contractor.test',
    name: 'Alice Contractor',
    role: 'CONTRACTOR',
    password: 'contractor123',
  },
  {
    email: 'dave@contractor.test',
    name: 'Dave Contractor',
    role: 'CONTRACTOR',
    password: 'contractor123',
  },
  {
    email: 'bob@homeowner.test',
    name: 'Bob Homeowner',
    role: 'HOMEOWNER',
    password: 'homeowner123',
  },
  {
    email: 'carol@homeowner.test',
    name: 'Carol Homeowner',
    role: 'HOMEOWNER',
    password: 'homeowner123',
  },
];

const BCRYPT_ROUNDS = 10;

export async function seedDatabase(db: Db): Promise<void> {
  for (const seedUser of seedUsers) {
    const passwordHash = await hash(seedUser.password, BCRYPT_ROUNDS);
    await db
      .insert(users)
      .values({ email: seedUser.email, name: seedUser.name, role: seedUser.role, passwordHash })
      .onConflictDoUpdate({
        target: users.email,
        set: { name: seedUser.name, role: seedUser.role, passwordHash },
      });
  }
}

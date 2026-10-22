import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { idColumn, timestamps } from './columns.js';
import { userRole } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: idColumn(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    name: text().notNull(),
    role: userRole().notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

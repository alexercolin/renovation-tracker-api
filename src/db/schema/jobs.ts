import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { idColumn, timestamps } from './columns.js';
import { jobStatus } from './enums.js';
import { users } from './users.js';

export const jobs = pgTable(
  'jobs',
  {
    id: idColumn(),
    contractorId: uuid()
      .notNull()
      .references(() => users.id),
    description: text().notNull(),
    addressLine1: text().notNull(),
    addressLine2: text(),
    city: text().notNull(),
    state: text().notNull(),
    postalCode: text().notNull(),
    country: text().notNull().default('US'),
    status: jobStatus().notNull().default('PLANNING'),
    costCents: integer().notNull().default(0),
    version: integer().notNull().default(1),
    historyCursor: integer().notNull().default(0),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('jobs_contractor_id_idx').on(table.contractorId),
    check('jobs_cost_cents_non_negative', sql`${table.costCents} >= 0`),
    check('jobs_version_positive', sql`${table.version} >= 1`),
    check('jobs_history_cursor_non_negative', sql`${table.historyCursor} >= 0`),
  ],
);

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;

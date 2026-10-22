import { index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { jobs } from './jobs.js';
import { users } from './users.js';

export const jobHomeowners = pgTable(
  'job_homeowners',
  {
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    homeownerId: uuid()
      .notNull()
      .references(() => users.id),
    addedBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.homeownerId] }),
    index('job_homeowners_homeowner_id_idx').on(table.homeownerId),
  ],
);

export type JobHomeownerRow = typeof jobHomeowners.$inferSelect;

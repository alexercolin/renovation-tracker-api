import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { idColumn } from './columns.js';
import { reportStatus } from './enums.js';
import { jobs } from './jobs.js';
import { users } from './users.js';

export const reports = pgTable(
  'reports',
  {
    id: idColumn(),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    requestedBy: uuid()
      .notNull()
      .references(() => users.id),
    status: reportStatus().notNull().default('PENDING'),
    s3Key: text(),
    error: text(),
    attempts: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('reports_job_id_created_at_idx').on(table.jobId, table.createdAt)],
);

export type ReportRow = typeof reports.$inferSelect;
export type NewReportRow = typeof reports.$inferInsert;

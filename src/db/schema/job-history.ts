import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idColumn } from './columns.js';
import { historyKind } from './enums.js';
import { jobs } from './jobs.js';
import { users } from './users.js';

export interface RecordedChange {
  before: unknown;
  after: unknown;
}

export type RecordedChanges = Record<string, RecordedChange>;

export const jobHistory = pgTable(
  'job_history',
  {
    id: idColumn(),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    seq: integer().notNull(),
    kind: historyKind().notNull(),
    changes: jsonb().$type<RecordedChanges>().notNull(),
    targetSeq: integer(),
    supersededAt: timestamp({ withTimezone: true }),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('job_history_job_id_seq_unique').on(table.jobId, table.seq),
    check('job_history_seq_positive', sql`${table.seq} >= 1`),
    check(
      'job_history_target_seq_matches_kind',
      sql`(${table.kind} in ('UNDONE', 'REDONE')) = (${table.targetSeq} is not null)`,
    ),
    check(
      'job_history_superseded_only_undoable',
      sql`${table.supersededAt} is null or ${table.kind} in ('UPDATED', 'DELETED')`,
    ),
  ],
);

export type JobHistoryRow = typeof jobHistory.$inferSelect;
export type NewJobHistoryRow = typeof jobHistory.$inferInsert;

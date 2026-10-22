import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idColumn } from './columns.js';
import { jobs } from './jobs.js';
import { users } from './users.js';

export const messages = pgTable(
  'messages',
  {
    id: idColumn(),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id),
    senderId: uuid()
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    clientMessageId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('messages_job_id_created_at_idx').on(table.jobId, table.createdAt, table.id),
    uniqueIndex('messages_sender_client_message_unique')
      .on(table.senderId, table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    check('messages_body_not_blank', sql`length(trim(${table.body})) > 0`),
  ],
);

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

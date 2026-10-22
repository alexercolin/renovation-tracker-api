import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { type DbExecutor } from '../../db/client.js';
import { type MessageRow, messages, type NewMessageRow } from '../../db/schema/index.js';
import { type MessagePageQuery } from './messages.types.js';

export class MessagesRepository {
  async insert(db: DbExecutor, values: NewMessageRow): Promise<MessageRow | undefined> {
    const [row] = await db
      .insert(messages)
      .values(values)
      .onConflictDoNothing({
        target: [messages.senderId, messages.clientMessageId],
        where: sql`${messages.clientMessageId} is not null`,
      })
      .returning();
    return row;
  }

  async findById(db: DbExecutor, id: string): Promise<MessageRow | undefined> {
    const [row] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
    return row;
  }

  async findByClientMessageId(
    db: DbExecutor,
    senderId: string,
    clientMessageId: string,
  ): Promise<MessageRow | undefined> {
    const [row] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.senderId, senderId), eq(messages.clientMessageId, clientMessageId)))
      .limit(1);
    return row;
  }

  async listPage(
    db: DbExecutor,
    jobId: string,
    { afterId, beforeId, limit, inverted }: MessagePageQuery,
  ): Promise<MessageRow[]> {
    const cursorRow = alias(messages, 'cursor_row');
    const positionOf = (id: string) =>
      db
        .select({ createdAt: cursorRow.createdAt, id: cursorRow.id })
        .from(cursorRow)
        .where(eq(cursorRow.id, id));

    const conditions = [eq(messages.jobId, jobId)];
    if (afterId) {
      conditions.push(sql`(${messages.createdAt}, ${messages.id}) > (${positionOf(afterId)})`);
    }
    if (beforeId) {
      conditions.push(sql`(${messages.createdAt}, ${messages.id}) < (${positionOf(beforeId)})`);
    }

    const direction = inverted ? desc : asc;
    return db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(direction(messages.createdAt), direction(messages.id))
      .limit(limit);
  }
}

import { type DbExecutor } from '../../db/client.js';
import { type MessageRow, type NewMessageRow } from '../../db/schema/index.js';
import { newId } from '../../shared/ids.js';
import { type MessagesRepository } from './messages.repository.js';
import { type MessagePageQuery } from './messages.types.js';

export class FakeMessagesRepository implements MessagesRepository {
  readonly rows: MessageRow[] = [];
  private clock = 0;

  insert(_db: DbExecutor, values: NewMessageRow): Promise<MessageRow | undefined> {
    const clientMessageId = values.clientMessageId ?? null;
    const duplicate =
      clientMessageId !== null &&
      this.rows.some(
        (row) => row.senderId === values.senderId && row.clientMessageId === clientMessageId,
      );
    if (duplicate) return Promise.resolve(undefined);

    this.clock += 1;
    const row: MessageRow = {
      id: values.id ?? newId(),
      jobId: values.jobId,
      senderId: values.senderId,
      body: values.body,
      clientMessageId,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)),
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findById(_db: DbExecutor, id: string): Promise<MessageRow | undefined> {
    return Promise.resolve(this.rows.find((row) => row.id === id));
  }

  findByClientMessageId(
    _db: DbExecutor,
    senderId: string,
    clientMessageId: string,
  ): Promise<MessageRow | undefined> {
    return Promise.resolve(
      this.rows.find((row) => row.senderId === senderId && row.clientMessageId === clientMessageId),
    );
  }

  listPage(
    _db: DbExecutor,
    jobId: string,
    { afterId, beforeId, limit, inverted }: MessagePageQuery,
  ): Promise<MessageRow[]> {
    const ordered = this.rows
      .filter((row) => row.jobId === jobId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const position = (id: string) => ordered.findIndex((row) => row.id === id);

    let window = ordered;
    if (afterId) window = window.filter((row) => position(row.id) > position(afterId));
    if (beforeId) window = window.filter((row) => position(row.id) < position(beforeId));
    if (inverted) window = [...window].reverse();

    return Promise.resolve(window.slice(0, limit));
  }
}

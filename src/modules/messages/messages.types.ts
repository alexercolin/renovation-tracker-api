import { z } from 'zod';

import { type MessageRow } from '../../db/schema/index.js';

export interface Message {
  id: string;
  jobId: string;
  senderId: string;
  body: string;
  clientMessageId: string | null;
  createdAt: Date;
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    jobId: row.jobId,
    senderId: row.senderId,
    body: row.body,
    clientMessageId: row.clientMessageId,
    createdAt: row.createdAt,
  };
}

export const sendMessageInputSchema = z.object({
  jobId: z.uuid(),
  body: z.string().trim().min(1).max(5000),
  clientMessageId: z
    .uuid()
    .nullish()
    .transform((value) => value ?? null),
});

export interface MessagePageQuery {
  afterId?: string;
  beforeId?: string;
  limit: number;
  inverted: boolean;
}

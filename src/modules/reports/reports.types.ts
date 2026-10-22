import { z } from 'zod';

import { type ReportRow, type ReportStatus } from '../../db/schema/index.js';

export interface Report {
  id: string;
  jobId: string;
  requestedBy: string;
  status: ReportStatus;
  s3Key: string | null;
  error: string | null;
  attempts: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    jobId: row.jobId,
    requestedBy: row.requestedBy,
    status: row.status,
    s3Key: row.s3Key,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

export const reportQueueMessageSchema = z.object({
  reportId: z.uuid(),
});

export type ReportQueueMessage = z.infer<typeof reportQueueMessageSchema>;

export const REPORT_MAX_ATTEMPTS = 3;
export const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;
export const REPORT_MESSAGE_BATCH_SIZE = 500;

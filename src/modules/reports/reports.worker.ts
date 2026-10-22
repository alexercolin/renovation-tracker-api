import { setTimeout as sleep } from 'node:timers/promises';

import { type Logger } from 'pino';

import { type MessageQueue, type QueueMessage } from '../../infra/queue/queue.js';
import { NotFoundError } from '../../shared/errors.js';
import { type ReportsService } from './reports.service.js';
import { reportQueueMessageSchema } from './reports.types.js';

export interface ReportWorkerDeps {
  queue: MessageQueue;
  reports: ReportsService;
  logger: Logger;
}

export type MessageOutcome = 'processed' | 'skipped' | 'failed';

export interface PollOptions {
  maxMessages?: number;
  waitSeconds?: number;
  signal?: AbortSignal;
}

const RECEIVE_ERROR_BACKOFF_MS = 5_000;

export async function handleQueueMessage(
  deps: ReportWorkerDeps,
  message: QueueMessage,
): Promise<MessageOutcome> {
  const parsed = reportQueueMessageSchema.safeParse(parseJson(message.body));
  if (!parsed.success) {
    deps.logger.warn({ messageId: message.id }, 'dropping malformed report message');
    await deps.queue.delete(message.receiptHandle);
    return 'skipped';
  }

  const { reportId } = parsed.data;
  try {
    const report = await deps.reports.processReport(reportId);
    await deps.queue.delete(message.receiptHandle);
    deps.logger.info({ reportId, status: report.status }, 'report message handled');
    return report.status === 'COMPLETED' ? 'processed' : 'skipped';
  } catch (error) {
    if (error instanceof NotFoundError) {
      deps.logger.warn({ reportId }, 'report no longer exists; dropping message');
      await deps.queue.delete(message.receiptHandle);
      return 'skipped';
    }
    deps.logger.error({ err: error, reportId }, 'report generation failed; left for retry');
    return 'failed';
  }
}

export async function pollOnce(
  deps: ReportWorkerDeps,
  { maxMessages = 5, waitSeconds = 20, signal }: PollOptions = {},
): Promise<MessageOutcome[]> {
  const messages = await deps.queue.receive({ maxMessages, waitSeconds, signal });
  const outcomes: MessageOutcome[] = [];
  for (const message of messages) {
    outcomes.push(await handleQueueMessage(deps, message));
  }
  return outcomes;
}

export async function runReportWorker(deps: ReportWorkerDeps, signal: AbortSignal): Promise<void> {
  deps.logger.info('report worker polling for messages');
  while (!signal.aborted) {
    try {
      await pollOnce(deps, { signal });
    } catch (error) {
      if (signal.aborted) break;
      deps.logger.error({ err: error }, 'receiving from the queue failed');
      await sleep(RECEIVE_ERROR_BACKOFF_MS, undefined, { signal }).catch(() => undefined);
    }
  }
  deps.logger.info('report worker stopped');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

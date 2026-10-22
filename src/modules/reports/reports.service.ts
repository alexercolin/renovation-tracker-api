import { type Db } from '../../db/client.js';
import {
  formatAddress,
  type ReportDocument,
  type ReportHistoryEntry,
  type ReportMessage,
  type ReportWriter,
} from '../../infra/pdf/report-pdf.js';
import { type MessageQueue } from '../../infra/queue/queue.js';
import { type ObjectStorage } from '../../infra/storage/storage.js';
import { type Actor } from '../../shared/actor.js';
import { errorMessage, NotFoundError } from '../../shared/errors.js';
import { formatUsd } from '../../shared/money.js';
import { parseId } from '../../shared/ids.js';
import { type HistoryService } from '../history/history.service.js';
import { type FieldChange, type HistoryEntry } from '../history/history.types.js';
import { type JobsService } from '../jobs/jobs.service.js';
import { type MessagesService } from '../messages/messages.service.js';
import { type UsersService } from '../users/users.service.js';
import { type ReportsRepository } from './reports.repository.js';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  type Report,
  REPORT_MAX_ATTEMPTS,
  REPORT_MESSAGE_BATCH_SIZE,
  type ReportQueueMessage,
  toReport,
} from './reports.types.js';

export interface ReportsServiceDeps {
  db: Db;
  reportsRepository: ReportsRepository;
  jobsService: JobsService;
  usersService: UsersService;
  messagesService: MessagesService;
  historyService: HistoryService;
  queue: MessageQueue;
  storage: ObjectStorage;
  writer: ReportWriter;
}

export class ReportsService {
  constructor(private readonly deps: ReportsServiceDeps) {}

  async requestReport(actor: Actor, id: string): Promise<Report> {
    const jobId = parseId(id, 'jobId');
    const job = await this.deps.jobsService.getJob(actor, jobId);
    if (job.contractorId !== actor.id) throw new NotFoundError('Job', jobId);

    const row = await this.deps.reportsRepository.insert(this.deps.db, {
      jobId: job.id,
      requestedBy: actor.id,
    });

    const message: ReportQueueMessage = { reportId: row.id };
    try {
      await this.deps.queue.send(JSON.stringify(message));
      return toReport(row);
    } catch (error) {
      const failed = await this.deps.reportsRepository.update(this.deps.db, row.id, {
        status: 'FAILED',
        error: `Could not enqueue report: ${errorMessage(error)}`,
      });
      return toReport(failed);
    }
  }

  async getReport(actor: Actor, id: string): Promise<Report> {
    const reportId = parseId(id);
    const row = await this.deps.reportsRepository.findById(this.deps.db, reportId);
    if (!row) throw new NotFoundError('Report', reportId);

    const job = (await this.deps.jobsService.findManyByIds([row.jobId])).get(row.jobId);
    if (!job || job.contractorId !== actor.id) throw new NotFoundError('Report', reportId);

    return toReport(row);
  }

  downloadUrl(report: Report): Promise<string | null> {
    if (report.status !== 'COMPLETED' || !report.s3Key) return Promise.resolve(null);
    return this.deps.storage.presignedGetUrl(report.s3Key, DOWNLOAD_URL_TTL_SECONDS);
  }

  async processReport(reportId: string): Promise<Report> {
    const existing = await this.deps.reportsRepository.findById(this.deps.db, reportId);
    if (!existing) throw new NotFoundError('Report', reportId);
    if (existing.status === 'COMPLETED' || existing.status === 'FAILED') return toReport(existing);

    const attempt = await this.deps.reportsRepository.startAttempt(this.deps.db, reportId);
    try {
      const document = await this.buildDocument(attempt.jobId);
      const key = `jobs/${attempt.jobId}/reports/${attempt.id}.pdf`;
      await this.deps.storage.upload(key, this.deps.writer.write(document), 'application/pdf');

      const completed = await this.deps.reportsRepository.update(this.deps.db, reportId, {
        status: 'COMPLETED',
        s3Key: key,
        completedAt: new Date(),
        error: null,
      });
      return toReport(completed);
    } catch (error) {
      const exhausted = attempt.attempts >= REPORT_MAX_ATTEMPTS;
      await this.deps.reportsRepository.update(this.deps.db, reportId, {
        status: exhausted ? 'FAILED' : 'PENDING',
        error: errorMessage(error),
      });
      throw error;
    }
  }

  private async buildDocument(jobId: string): Promise<ReportDocument> {
    const job = (await this.deps.jobsService.findManyByIds([jobId])).get(jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    const [contractor, homeownersByJob] = await Promise.all([
      this.deps.usersService.getById(job.contractorId),
      this.deps.jobsService.homeownersByJobIds([jobId]),
    ]);

    return {
      generatedAt: new Date(),
      job: {
        id: job.id,
        description: job.description,
        status: job.status,
        costCents: job.costCents,
        location: job.location,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        deletedAt: job.deletedAt,
      },
      contractor: { name: contractor.name, email: contractor.email },
      homeowners: (homeownersByJob.get(jobId) ?? []).map((user) => ({
        name: user.name,
        email: user.email,
      })),
      history: this.iterateHistory(jobId),
      messages: this.iterateMessages(jobId),
    };
  }

  private async *iterateHistory(jobId: string): AsyncGenerator<ReportHistoryEntry> {
    let afterSeq: number | undefined;
    for (;;) {
      const page = await this.deps.historyService.listJobHistory(jobId, {
        afterSeq,
        limit: REPORT_MESSAGE_BATCH_SIZE,
        inverted: false,
      });
      if (page.length === 0) return;

      const actorIds = [...new Set(page.map((entry) => entry.actorId))];
      const actors = await this.deps.usersService.findManyByIds(actorIds);
      for (const entry of page) {
        yield {
          seq: entry.seq,
          kind: entry.kind,
          actorName: actors.get(entry.actorId)?.name ?? 'Unknown user',
          createdAt: entry.createdAt,
          details: describeEntry(entry),
        };
      }

      if (page.length < REPORT_MESSAGE_BATCH_SIZE) return;
      afterSeq = page[page.length - 1]!.seq;
    }
  }

  private async *iterateMessages(jobId: string): AsyncGenerator<ReportMessage> {
    let afterId: string | undefined;
    for (;;) {
      const page = await this.deps.messagesService.listJobMessages(jobId, {
        afterId,
        limit: REPORT_MESSAGE_BATCH_SIZE,
        inverted: false,
      });
      if (page.length === 0) return;

      const senderIds = [...new Set(page.map((message) => message.senderId))];
      const senders = await this.deps.usersService.findManyByIds(senderIds);
      for (const message of page) {
        yield {
          createdAt: message.createdAt,
          senderName: senders.get(message.senderId)?.name ?? 'Unknown user',
          body: message.body,
        };
      }

      if (page.length < REPORT_MESSAGE_BATCH_SIZE) return;
      afterId = page[page.length - 1]!.id;
    }
  }
}

function describeEntry(entry: HistoryEntry): string[] {
  const lines = entry.changes.map(describeChange);
  if (entry.targetSeq !== null) lines.unshift(`applies to entry #${entry.targetSeq}`);
  if (entry.supersededAt) lines.push(`superseded at ${entry.supersededAt.toISOString()}`);
  return lines;
}

function describeChange({ field, before, after }: FieldChange): string {
  if (before === null || before === undefined) return `${field}: ${describeValue(field, after)}`;
  return `${field}: ${describeValue(field, before)} -> ${describeValue(field, after)}`;
}

function describeValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (field === 'costCents' && typeof value === 'number') return formatUsd(value);
  if (field === 'location' && typeof value === 'object') {
    return formatAddress(value as Parameters<typeof formatAddress>[0]);
  }
  if (field === 'homeowner' && typeof value === 'object') {
    const person = value as { name?: string; email?: string };
    return `${person.name ?? 'unknown'} <${person.email ?? 'unknown'}>`;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

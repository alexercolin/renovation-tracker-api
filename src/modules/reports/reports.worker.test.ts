import { Readable } from 'node:stream';

import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { PdfKitReportWriter, type ReportWriter } from '../../infra/pdf/report-pdf.js';
import { InMemoryQueue } from '../../infra/queue/in-memory-queue.js';
import { InMemoryStorage } from '../../infra/storage/in-memory-storage.js';
import { type Actor } from '../../shared/actor.js';
import { fakeDb, FakeJobsRepository } from '../jobs/jobs.repository.fake.js';
import { JobsService } from '../jobs/jobs.service.js';
import { FakeMessagesRepository } from '../messages/messages.repository.fake.js';
import { MessagesService } from '../messages/messages.service.js';
import { FakeUsersRepository, userRow } from '../users/users.repository.fake.js';
import { UsersService } from '../users/users.service.js';
import { FakeReportsRepository } from './reports.repository.fake.js';
import { ReportsService, type ReportsServiceDeps } from './reports.service.js';
import { handleQueueMessage, pollOnce, type ReportWorkerDeps } from './reports.worker.js';

const alice: Actor = { id: '019a0000-0000-7000-8000-00000000000a', role: 'CONTRACTOR' };

const failingWriter: ReportWriter = {
  write: () =>
    new Readable({
      read() {
        this.destroy(new Error('disk full'));
      },
    }),
};

describe('report worker', () => {
  let queue: InMemoryQueue;
  let serviceDeps: ReportsServiceDeps;
  let deps: ReportWorkerDeps;
  let jobId: string;

  beforeEach(async () => {
    const usersRepository = new FakeUsersRepository([
      userRow({ id: alice.id, email: 'alice@contractor.test' }),
    ]);
    const jobsService = new JobsService(fakeDb(), new FakeJobsRepository(), usersRepository);
    queue = new InMemoryQueue();
    serviceDeps = {
      db: fakeDb(),
      reportsRepository: new FakeReportsRepository(),
      jobsService,
      usersService: new UsersService(fakeDb(), usersRepository),
      messagesService: new MessagesService(fakeDb(), new FakeMessagesRepository(), jobsService),
      queue,
      storage: new InMemoryStorage(),
      writer: new PdfKitReportWriter(),
    };
    deps = { queue, reports: new ReportsService(serviceDeps), logger: pino({ level: 'silent' }) };

    const job = await jobsService.createJob(alice, {
      description: 'Deck',
      location: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
    });
    jobId = job.id;
  });

  it('processes a queued report and deletes the message', async () => {
    const report = await deps.reports.requestReport(alice, jobId);

    const outcomes = await pollOnce(deps, { maxMessages: 5, waitSeconds: 0 });

    expect(outcomes).toEqual(['processed']);
    expect(queue.inFlight.size).toBe(0);
    await expect(deps.reports.getReport(alice, report.id)).resolves.toMatchObject({
      status: 'COMPLETED',
    });
  });

  it('drops malformed messages and messages for unknown reports', async () => {
    await queue.send('not json');
    await queue.send(JSON.stringify({ reportId: '019a0000-0000-7000-8000-0000000000ee' }));

    const outcomes = await pollOnce(deps, { maxMessages: 5, waitSeconds: 0 });

    expect(outcomes).toEqual(['skipped', 'skipped']);
    expect(queue.inFlight.size).toBe(0);
  });

  it('leaves the message in flight when generation fails so the queue can retry', async () => {
    const broken: ReportWorkerDeps = {
      ...deps,
      reports: new ReportsService({ ...serviceDeps, writer: failingWriter }),
    };
    await broken.reports.requestReport(alice, jobId);
    const [message] = await queue.receive({ maxMessages: 1, waitSeconds: 0 });

    const outcome = await handleQueueMessage(broken, message!);

    expect(outcome).toBe('failed');
    expect(queue.inFlight.has(message!.receiptHandle)).toBe(true);
  });
});

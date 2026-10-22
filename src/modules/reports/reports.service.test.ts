import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PdfKitReportWriter, type ReportWriter } from '../../infra/pdf/report-pdf.js';
import { InMemoryQueue } from '../../infra/queue/in-memory-queue.js';
import { InMemoryStorage } from '../../infra/storage/in-memory-storage.js';
import { type Actor } from '../../shared/actor.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { fakeDb, FakeJobsRepository } from '../jobs/jobs.repository.fake.js';
import { JobsService } from '../jobs/jobs.service.js';
import { FakeMessagesRepository } from '../messages/messages.repository.fake.js';
import { MessagesService } from '../messages/messages.service.js';
import { FakeUsersRepository, userRow } from '../users/users.repository.fake.js';
import { UsersService } from '../users/users.service.js';
import { FakeReportsRepository } from './reports.repository.fake.js';
import { ReportsService, type ReportsServiceDeps } from './reports.service.js';
import { REPORT_MESSAGE_BATCH_SIZE } from './reports.types.js';

const alice: Actor = { id: '019a0000-0000-7000-8000-00000000000a', role: 'CONTRACTOR' };
const dave: Actor = { id: '019a0000-0000-7000-8000-00000000000d', role: 'CONTRACTOR' };
const bob: Actor = { id: '019a0000-0000-7000-8000-00000000000b', role: 'HOMEOWNER' };

const failingWriter: ReportWriter = {
  write: () =>
    new Readable({
      read() {
        this.destroy(new Error('font cache corrupted'));
      },
    }),
};

describe('ReportsService', () => {
  let deps: ReportsServiceDeps;
  let queue: InMemoryQueue;
  let storage: InMemoryStorage;
  let service: ReportsService;
  let jobId: string;

  beforeEach(async () => {
    const usersRepository = new FakeUsersRepository([
      userRow({ id: alice.id, email: 'alice@contractor.test', name: 'Alice Contractor' }),
      userRow({ id: dave.id, email: 'dave@contractor.test', name: 'Dave Contractor' }),
      userRow({
        id: bob.id,
        email: 'bob@homeowner.test',
        name: 'Bob Homeowner',
        role: 'HOMEOWNER',
      }),
    ]);
    const jobsService = new JobsService(fakeDb(), new FakeJobsRepository(), usersRepository);
    const messagesService = new MessagesService(
      fakeDb(),
      new FakeMessagesRepository(),
      jobsService,
    );
    queue = new InMemoryQueue();
    storage = new InMemoryStorage();
    deps = {
      db: fakeDb(),
      reportsRepository: new FakeReportsRepository(),
      jobsService,
      usersService: new UsersService(fakeDb(), usersRepository),
      messagesService,
      queue,
      storage,
      writer: new PdfKitReportWriter(),
    };
    service = new ReportsService(deps);

    const job = await jobsService.createJob(alice, {
      description: 'Kitchen remodel',
      location: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' },
      costCents: 2_500_000,
    });
    jobId = job.id;
    await jobsService.addHomeowner(alice, jobId, 'bob@homeowner.test');
    await messagesService.sendMessage(alice, { jobId, body: 'Demolition starts Monday.' });
    await messagesService.sendMessage(bob, { jobId, body: 'Great, thanks!' });
  });

  describe('requestReport', () => {
    it('stores a PENDING report and enqueues its id', async () => {
      const report = await service.requestReport(alice, jobId);

      expect(report).toMatchObject({
        jobId,
        requestedBy: alice.id,
        status: 'PENDING',
        attempts: 0,
      });
      expect(queue.pending).toHaveLength(1);
      expect(JSON.parse(queue.pending[0]!.body)).toEqual({ reportId: report.id });
    });

    it('is limited to the contractor who owns the job', async () => {
      await expect(service.requestReport(dave, jobId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.requestReport(bob, jobId)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('marks the report FAILED when the queue is unavailable', async () => {
      queue.sendError = new Error('queue unreachable');

      const report = await service.requestReport(alice, jobId);

      expect(report.status).toBe('FAILED');
      expect(report.error).toContain('queue unreachable');
      expect(queue.pending).toHaveLength(0);
    });
  });

  describe('processReport', () => {
    it('renders a PDF into storage and completes the report', async () => {
      const requested = await service.requestReport(alice, jobId);

      const completed = await service.processReport(requested.id);

      expect(completed).toMatchObject({ status: 'COMPLETED', attempts: 1, error: null });
      expect(completed.s3Key).toBe(`jobs/${jobId}/reports/${requested.id}.pdf`);
      expect(completed.startedAt).toBeInstanceOf(Date);
      expect(completed.completedAt).toBeInstanceOf(Date);

      const stored = storage.objects.get(completed.s3Key!);
      expect(stored?.contentType).toBe('application/pdf');
      expect(stored?.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(stored!.body.length).toBeGreaterThan(1_000);
    });

    it('is idempotent once completed', async () => {
      const requested = await service.requestReport(alice, jobId);
      await service.processReport(requested.id);

      const again = await service.processReport(requested.id);

      expect(again.status).toBe('COMPLETED');
      expect(again.attempts).toBe(1);
    });

    it('returns to PENDING on failure and gives up as FAILED on the third attempt', async () => {
      const broken = new ReportsService({ ...deps, writer: failingWriter });
      const requested = await broken.requestReport(alice, jobId);

      for (const expected of ['PENDING', 'PENDING', 'FAILED'] as const) {
        await expect(broken.processReport(requested.id)).rejects.toThrow('font cache corrupted');
        const current = await broken.getReport(alice, requested.id);
        expect(current.status).toBe(expected);
        expect(current.error).toBe('font cache corrupted');
      }

      const final = await broken.getReport(alice, requested.id);
      expect(final.attempts).toBe(3);
      await expect(broken.processReport(requested.id)).resolves.toMatchObject({ status: 'FAILED' });
    });

    it('streams messages in batches', async () => {
      const total = REPORT_MESSAGE_BATCH_SIZE * 2 + 1;
      for (let index = 0; index < total - 2; index += 1) {
        await deps.messagesService.sendMessage(alice, { jobId, body: `Update ${index}` });
      }
      const listSpy = vi.spyOn(deps.messagesService, 'listJobMessages');
      const requested = await service.requestReport(alice, jobId);

      const completed = await service.processReport(requested.id);

      expect(completed.status).toBe('COMPLETED');
      expect(listSpy).toHaveBeenCalledTimes(3);
    });

    it('rejects unknown report ids', async () => {
      await expect(
        service.processReport('019a0000-0000-7000-8000-0000000000ee'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('getReport and downloadUrl', () => {
    it('is visible only to the owning contractor', async () => {
      const requested = await service.requestReport(alice, jobId);

      await expect(service.getReport(alice, requested.id)).resolves.toMatchObject({
        id: requested.id,
      });
      await expect(service.getReport(dave, requested.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.getReport(alice, 'nope')).rejects.toBeInstanceOf(ValidationError);
    });

    it('exposes a download URL only once completed', async () => {
      const requested = await service.requestReport(alice, jobId);
      await expect(service.downloadUrl(requested)).resolves.toBeNull();

      const completed = await service.processReport(requested.id);

      await expect(service.downloadUrl(completed)).resolves.toMatch(/^memory:\/\/jobs\//);
    });
  });
});
